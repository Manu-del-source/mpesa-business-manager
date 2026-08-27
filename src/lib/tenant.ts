import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isDemoMode } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// The authorization core (directly testable, no request primitives) and the
// provisioning primitives are re-exported so every existing
// `import ... from "@/lib/tenant"` keeps working unchanged.
export {
  type SessionUser,
  type AppContext,
  type TenantContext,
  TenantAccessDeniedError,
  parseEnvironmentCookie,
  resolveTenantContext,
} from "@/lib/tenant-context";
export { resolveTenantForOrg } from "@/lib/provisioning";

import { resolveTenantContext, parseEnvironmentCookie } from "@/lib/tenant-context";
import type { AppContext, SessionUser, TenantContext } from "@/lib/tenant-context";
import type { Environment } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Request-layer constants
// ---------------------------------------------------------------------------

export const DEMO_SESSION_COOKIE = "mbm_demo_session";
export const DEMO_USER_ID = "demo-user";
export const DEMO_ORG_SLUG = "kijani-fresh-foods";
export const ACTIVE_TENANT_COOKIE = "mbm_active_tenant";
export const ACTIVE_ENVIRONMENT_COOKIE = "mbm_active_environment";

// ---------------------------------------------------------------------------
// User resolution
// ---------------------------------------------------------------------------

export function getDemoUser(): SessionUser {
  return {
    id: DEMO_USER_ID,
    email: "demo@kijani.local",
    name: "Demo Owner",
    isDemo: true,
  };
}

/** Resolve the signed-in user from Supabase Auth or the demo session cookie. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  if (isDemoMode()) {
    const store = await cookies();
    const hasSession = store.has(DEMO_SESSION_COOKIE);
    return hasSession ? getDemoUser() : null;
  }

  const supabase = await createSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return {
    id: user.id,
    email: user.email ?? "",
    name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
    isDemo: false,
  };
}

/** Like getCurrentUser but redirects to /signin when unauthenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  return user;
}

// ---------------------------------------------------------------------------
// AppContext (backward-compatible)
// ---------------------------------------------------------------------------

/**
 * Resolve the current user's organization membership.
 *
 * In demo mode this returns the seeded demo business (Kijani Fresh Foods).
 * If the user has no organization yet (fresh Supabase sign-up), a personal
 * organization is provisioned automatically so the first sign-in lands on a
 * working dashboard.
 */
export async function requireAppContext(): Promise<AppContext> {
  const user = await requireUser();

  // Demo mode: resolve the seeded demo organization by slug.
  if (isDemoMode()) {
    const org = await prisma.organization.findUnique({
      where: { slug: DEMO_ORG_SLUG },
    });
    if (org) {
      const demoMember = await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: { organizationId: org.id, userId: user.id },
        },
        create: {
          organizationId: org.id,
          userId: user.id,
          role: "OWNER",
          firstName: "Demo",
          lastName: "Owner",
        },
        update: {},
      });
      return {
        user,
        orgId: org.id,
        org: org,
        role: demoMember.role,
      };
    }
  }

  const member = await prisma.organizationMember.findFirst({
    where: { userId: user.id },
    include: { organization: true },
  });

  if (!member) {
    // Self-provisioning for a brand-new user's own organization.
    const org = await prisma.organization.create({
      data: {
        name: user.name ? `${user.name.split(" ")[0]}'s Business` : "My Business",
        slug: `${user.id.slice(0, 8)}-business`,
        businessType: "Retail",
      },
    });
    const owner = await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: "OWNER",
        firstName: user.name.split(" ")[0] ?? null,
        lastName: user.name.split(" ")[1] ?? null,
      },
    });
    return { user, orgId: org.id, org, role: owner.role };
  }

  return { user, orgId: member.organizationId, org: member.organization, role: member.role };
}

// ---------------------------------------------------------------------------
// TenantContext request wrappers
// ---------------------------------------------------------------------------

/**
 * Resolve the full TenantContext for the current request.
 *
 * Reads the active-tenant / active-environment cookies, then delegates to
 * resolveTenantContext() which verifies membership. Throws
 * TenantAccessDeniedError (→ 403) when the cookie names a tenant the user
 * does not belong to.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const appCtx = await requireAppContext();
  const store = await cookies();

  const activeTenantSlug = store.get(ACTIVE_TENANT_COOKIE)?.value || null;
  const activeEnvironment = parseEnvironmentCookie(
    store.get(ACTIVE_ENVIRONMENT_COOKIE)?.value,
  );

  return resolveTenantContext({
    appCtx,
    activeTenantSlug,
    activeEnvironment,
  });
}

/**
 * Resolve TenantContext with an explicit environment override.
 * Use this when the caller knows they're operating in LIVE mode
 * (e.g., provider callback processing).
 */
export async function requireTenantContextWithEnvironment(
  env: Environment,
): Promise<TenantContext> {
  const ctx = await requireTenantContext();
  return { ...ctx, environment: env };
}
