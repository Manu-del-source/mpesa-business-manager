import "server-only";
import { prisma } from "@/lib/prisma";
import {
  ensureTenantApplication,
  ensureTenantMember,
  provisionTenantForOrg,
} from "@/lib/provisioning";
import { tenantRoleForOrgRole } from "@/lib/permissions";
import type { Environment, TenantRole } from "@/generated/prisma/client";

/**
 * Tenant-context authorization core.
 *
 * This module deliberately has NO dependency on Next.js request primitives
 * (cookies/redirect/Supabase) so that the authorization boundary itself is
 * directly importable — and testable — from node --test. The request-layer
 * wrappers (cookies, redirects, session resolution) live in
 * src/lib/tenant.ts; the provisioning primitives live in
 * src/lib/provisioning.ts.
 */

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
// Environment cookie handling
// ---------------------------------------------------------------------------

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
// Tenant-context resolution (authorization-critical)
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
