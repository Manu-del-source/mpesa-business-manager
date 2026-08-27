import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isDemoMode } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import {
  ensureTenantApplication,
  ensureTenantMember,
  provisionTenantForOrg,
} from "@/lib/provisioning";
import { tenantRoleForOrgRole } from "@/lib/permissions";
import type { Environment, TenantRole } from "@/generated/prisma/client";

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
 * the existing AppContext.
 *
 * Existing code continues to work with `AppContext` alone. New code should
 * prefer `TenantContext` when it needs tenant-scoped infrastructure access.
 */
export type TenantContext = AppContext & {
  /** Infrastructure tenant (the platform customer), authorized via TenantMember. */
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  /** Default application for this tenant. */
  application: {
    id: string;
    name: string;
    slug: string;
  };
  /** Active environment. Defaults to SANDBOX for safety. */
  environment: Environment;
  /** Tenant-level role loaded from the persisted TenantMember row. */
  tenantRole: TenantRole;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The authenticated user has no membership relationship with the requested
 * tenant. Mapped to HTTP 403 by API routes.
 */
export class TenantAccessDeniedError extends Error {
  constructor(
    public readonly userId: string,
    public readonly tenantSlug: string,
  ) {
    super(
      "You are not a member of the requested tenant. Access denied.",
    );
    this.name = "TenantAccessDeniedError";
  }
}

// ---------------------------------------------------------------------------
// Demo-mode constants
// ---------------------------------------------------------------------------

export const DEMO_SESSION_COOKIE = "mbm_demo_session";
export const DEMO_USER_ID = "demo-user";
export const DEMO_ORG_SLUG = "kijani-fresh-foods";
export const ACTIVE_TENANT_COOKIE = "mbm_active_tenant";
export const ACTIVE_ENVIRONMENT_COOKIE = "mbm_active_environment";

const VALID_ENVIRONMENTS: readonly Environment[] = ["SANDBOX", "LIVE"];

/**
 * Validate a raw cookie value as an Environment. Anything other than the
 * exact enum members is ignored (treated as unset) so a tampered cookie can
 * never leak an arbitrary string into Prisma where clauses.
 */
export function parseEnvironmentCookie(
  raw: string | undefined | null,
): Environment | undefined {
  if (!raw) return undefined;
  return VALID_ENVIRONMENTS.includes(raw as Environment)
    ? (raw as Environment)
    : undefined;
}

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
// TenantContext (authorization-critical)
// ---------------------------------------------------------------------------

/**
 * Core tenant-context resolution — no cookies, no redirects. This function is
 * the authorization boundary for tenant-scoped access and is covered directly
 * by regression tests.
 *
 * Flow:
 *   authenticated user (appCtx)
 *     ↓
 *   requested tenant (activeTenantSlug when present, else the user's org)
 *     ↓
 *   verify TenantMember for (user, tenant)  ← NEVER created as a side effect
 *     ↓
 *   resolve tenant context (tenant + default application + environment)
 *
 * Failure modes:
 *   - TenantAccessDeniedError: the requested tenant exists but the user has
 *     no membership. Callers map this to HTTP 403.
 *   - Stale/unknown tenant slug: falls back to the user's own organization's
 *     tenant (no information leak — the fallback only ever uses the org the
 *     user is already a member of).
 */
export async function resolveTenantContext(input: {
  appCtx: AppContext;
  activeTenantSlug?: string | null;
  activeEnvironment?: Environment | null;
}): Promise<TenantContext> {
  const { appCtx } = input;
  const environment = input.activeEnvironment ?? "SANDBOX";

  if (input.activeTenantSlug) {
    const requested = await prisma.tenant.findUnique({
      where: { slug: input.activeTenantSlug },
      select: { id: true, name: true, slug: true },
    });

    if (requested) {
      // CRITICAL: verify an existing membership. Never create one here —
      // selecting a tenant must never grant access to it.
      const member = await prisma.tenantMember.findUnique({
        where: {
          tenantId_userId: { tenantId: requested.id, userId: appCtx.user.id },
        },
        select: { role: true },
      });

      if (!member) {
        throw new TenantAccessDeniedError(appCtx.user.id, requested.slug);
      }

      const { application } = await ensureTenantApplication(
        requested.id,
        requested.name,
      );
      return {
        ...appCtx,
        tenant: requested,
        application,
        environment,
        tenantRole: member.role,
      };
    }
    // Unknown/stale slug → fall through to the user's own org tenant.
  }

  // Org-based resolution: the user is an OrganizationMember (guaranteed by
  // requireAppContext), so provisioning a TenantMember for the org's own
  // tenant is legitimate provisioning — the role is mapped from the org role
  // on first creation and never modified afterwards.
  const tenant = (await provisionTenantForOrg(appCtx.org)).tenant;
  const tenantRole = await ensureTenantMember(
    tenant.id,
    appCtx.user.id,
    tenantRoleForOrgRole(appCtx.role),
  );
  const { application } = await ensureTenantApplication(tenant.id, tenant.name);

  return {
    ...appCtx,
    tenant,
    application,
    environment,
    tenantRole,
  };
}

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

/**
 * Lightweight tenant resolution for internal/server code that already
 * has an orgId and doesn't need the full auth flow. Provisioning only —
 * never grants cross-tenant access.
 */
export async function resolveTenantForOrg(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true },
  });

  if (!org) {
    throw new Error(`Organization ${orgId} not found.`);
  }

  const result = await provisionTenantForOrg(org);
  return { tenant: result.tenant, application: result.application };
}
