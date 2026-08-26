import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isDemoMode } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import type { Environment, TenantRole } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isDemo: boolean;
};

export type AppContext = {
  user: SessionUser;
  orgId: string;
  org: {
    id: string;
    name: string;
    slug: string;
    tier: "FREE" | "PRO";
    businessType: string;
  };
  role: "OWNER" | "ADMIN" | "STAFF";
};

/**
 * Extended context that adds infrastructure-tenant information on top of
 * the existing AppContext. Phase 1 introduces the Tenant → Application
 * hierarchy; later phases will add permissions, API keys, etc.
 *
 * Existing code continues to work with `AppContext` alone. New code should
 * prefer `TenantContext` when it needs tenant-scoped infrastructure access.
 */
export type TenantContext = AppContext & {
  /** Infrastructure tenant (the platform customer). */
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  /** Default application for this tenant. Created on first access. */
  application: {
    id: string;
    name: string;
    slug: string;
  };
  /** Active environment. Defaults to SANDBOX for safety. */
  environment: Environment;
  /** Tenant-level role mapped from TenantMember.role. */
  tenantRole: TenantRole;
};

// ---------------------------------------------------------------------------
// Demo-mode constants
// ---------------------------------------------------------------------------

export const DEMO_SESSION_COOKIE = "mbm_demo_session";
export const DEMO_USER_ID = "demo-user";
export const DEMO_ORG_SLUG = "kijani-fresh-foods";
export const ACTIVE_TENANT_COOKIE = "mbm_active_tenant";
export const ACTIVE_ENVIRONMENT_COOKIE = "mbm_active_environment";
const DEMO_APP_SLUG = "default-app";

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
// Tenant + Application auto-provisioning
// ---------------------------------------------------------------------------

/**
 * Ensure a Tenant exists for the given Organization and return it.
 * Creates a Tenant + default Application if the org has no tenantId yet
 * (happens during the transition from single-tenant to multi-tenant).
 */
async function ensureTenantForOrg(
  orgId: string,
  orgName: string,
  orgSlug: string,
): Promise<{
  tenant: { id: string; name: string; slug: string };
  application: { id: string; name: string; slug: string };
}> {
  // Check if org already has a tenant
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { tenantId: true },
  });

  if (org?.tenantId) {
    // Tenant exists — ensure a default application exists
    let app = await prisma.application.findFirst({
      where: { tenantId: org.tenantId },
    });
    if (!app) {
      app = await prisma.application.create({
        data: {
          tenantId: org.tenantId,
          name: `${orgName} App`,
          slug: DEMO_APP_SLUG,
          description: "Default application",
        },
      });
    }
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: org.tenantId },
      select: { id: true, name: true, slug: true },
    });
    return { tenant, application: app };
  }

  // No tenant yet — create one (1:1 with org during transition)
  const tenant = await prisma.tenant.create({
    data: {
      name: orgName,
      slug: orgSlug,
    },
    select: { id: true, name: true, slug: true },
  });

  // Link org to tenant
  await prisma.organization.update({
    where: { id: orgId },
    data: { tenantId: tenant.id },
  });

  // Create default application
  const app = await prisma.application.create({
    data: {
      tenantId: tenant.id,
      name: `${orgName} App`,
      slug: DEMO_APP_SLUG,
      description: "Default application",
    },
  });

  return { tenant, application: app };
}

/**
 * Ensure a TenantMember exists for the given user in the tenant.
 * Returns the tenant role (defaults to OWNER for the org creator).
 */
async function ensureTenantMember(
  tenantId: string,
  userId: string,
  orgRole: "OWNER" | "ADMIN" | "STAFF",
): Promise<TenantRole> {
  // Map legacy org role → tenant role
  const tenantRole: TenantRole =
    orgRole === "OWNER" ? "OWNER" : orgRole === "ADMIN" ? "ADMIN" : "VIEWER";

  await prisma.tenantMember.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    create: { tenantId, userId, role: tenantRole },
    update: {}, // Don't downgrade role on subsequent calls
  });

  return tenantRole;
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
// TenantContext (new — Phase 1)
// ---------------------------------------------------------------------------

/**
 * Resolve the full TenantContext: user → org → tenant → application.
 *
 * This extends `requireAppContext()` with infrastructure-tenant information.
 * For new code that needs tenant-scoped infrastructure access (API keys,
 * provider connections, etc.), use this instead of `requireAppContext()`.
 *
 * During the transition period this auto-provisions Tenant + Application
 * for existing Orgs that don't have one yet.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const appCtx = await requireAppContext();
  const store = await cookies();

  // Check for explicit tenant selection via cookie (for multi-tenant users)
  const activeTenantSlug = store.get(ACTIVE_TENANT_COOKIE)?.value;
  const activeEnv = store.get(ACTIVE_ENVIRONMENT_COOKIE)?.value as Environment | undefined;

  let tenantResult: { tenant: { id: string; name: string; slug: string }; application: { id: string; name: string; slug: string } };

  if (activeTenantSlug) {
    // Resolve by slug from cookie — user explicitly chose this tenant
    const tenant = await prisma.tenant.findUnique({
      where: { slug: activeTenantSlug },
      select: { id: true, name: true, slug: true },
    });
    if (tenant) {
      let app = await prisma.application.findFirst({ where: { tenantId: tenant.id } });
      if (!app) {
        app = await prisma.application.create({
          data: { tenantId: tenant.id, name: `${tenant.name} App`, slug: DEMO_APP_SLUG },
        });
      }
      tenantResult = { tenant, application: app };
    } else {
      // Cookie points to a deleted tenant — fall back to org-based resolution
      tenantResult = await ensureTenantForOrg(appCtx.orgId, appCtx.org.name, appCtx.org.slug);
    }
  } else {
    // Default: resolve from org (auto-provisions if needed)
    tenantResult = await ensureTenantForOrg(appCtx.orgId, appCtx.org.name, appCtx.org.slug);
  }

  const tenantRole = await ensureTenantMember(
    tenantResult.tenant.id,
    appCtx.user.id,
    appCtx.role,
  );

  return {
    ...appCtx,
    ...tenantResult,
    environment: activeEnv ?? "SANDBOX" as Environment,
    tenantRole,
  };
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

/**
 * Lightweight tenant resolution for internal/server code that already
 * has an orgId and doesn't need the full auth flow.
 */
export async function resolveTenantForOrg(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { tenantId: true, name: true, slug: true },
  });

  if (!org?.tenantId) {
    return ensureTenantForOrg(orgId, org?.name ?? "Unknown", org?.slug ?? "unknown");
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: org.tenantId },
    select: { id: true, name: true, slug: true },
  });

  let app = await prisma.application.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!app) {
    app = await prisma.application.create({
      data: {
        tenantId: tenant.id,
        name: `${org.name} App`,
        slug: DEMO_APP_SLUG,
        description: "Default application",
      },
    });
  }

  return { tenant, application: app };
}
