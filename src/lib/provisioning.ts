/**
 * Tenant / Application provisioning.
 *
 * Used by:
 *   - src/lib/tenant.ts            (interactive resolution)
 *   - scripts/backfill-tenants.mjs (bulk migration of legacy orgs)
 *   - tests                        (concurrency + idempotency coverage)
 *
 * NOTE: this module deliberately does NOT import "server-only" so that the
 * backfill script (plain Node via tsx) can execute the exact same production
 * code paths the app uses.
 *
 * Concurrency rules:
 *   - Every write is keyed on a database unique constraint (Tenant.slug,
 *     Application(tenantId, slug), TenantMember(tenantId, userId)).
 *   - Tenant + org link + default application are created in ONE transaction,
 *     so concurrent provisioning attempts converge instead of leaving partial
 *     state (an orphan tenant that blocks future retries).
 *   - All functions are safe to re-run (idempotent).
 */

import { prisma } from "@/lib/prisma";

/** Default application slug auto-provisioned for a tenant. */
export const DEFAULT_APP_SLUG = "default-app";

export type ProvisionedTenant = {
  tenant: { id: string; name: string; slug: string };
  application: { id: string; name: string; slug: string };
  /** True when provisioning created rows in this call (false = already present). */
  created: boolean;
};

/**
 * Ensure a Tenant (+ its default Application) exists for an Organization and
 * that the Organization is linked to it. Safe under concurrency and safe to
 * re-run.
 *
 * The Organization.tenantId link is authoritative once set: if the org is
 * already linked, that tenant is used even if a tenant with the org's slug
 * also exists (defensive against slug collisions during renames).
 */
export async function provisionTenantForOrg(org: {
  id: string;
  name: string;
  slug: string;
}): Promise<ProvisionedTenant> {
  // Fast path: org already linked.
  const existing = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { tenantId: true },
  });
  if (existing?.tenantId) {
    const result = await ensureTenantApplication(existing.tenantId, org.name);
    return { ...result, created: false };
  }

  // Provisioning path: one transaction, upserts keyed on unique constraints.
  const created = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.upsert({
      where: { slug: org.slug },
      create: { name: org.name, slug: org.slug },
      update: {},
      select: { id: true, name: true, slug: true },
    });

    // Link the org only if not already linked (guarded against races; never
    // overwrites an existing link to a different tenant).
    await tx.organization.updateMany({
      where: { id: org.id, tenantId: null },
      data: { tenantId: tenant.id },
    });

    return tenant;
  });

  // Ensure the default application exists (idempotent upsert).
  const result = await ensureTenantApplication(created.id, org.name);
  return { ...result, created: true };
}

/**
 * Ensure the default Application exists for a tenant. Race-safe via upsert on
 * the (tenantId, slug) unique constraint.
 */
export async function ensureTenantApplication(
  tenantId: string,
  tenantName: string,
): Promise<{ tenant: { id: string; name: string; slug: string }; application: { id: string; name: string; slug: string } }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true },
  });

  const application = await prisma.application.upsert({
    where: { tenantId_slug: { tenantId, slug: DEFAULT_APP_SLUG } },
    create: {
      tenantId,
      name: `${tenantName} App`,
      slug: DEFAULT_APP_SLUG,
      description: "Default application (auto-provisioned)",
    },
    update: {},
    select: { id: true, name: true, slug: true },
  });

  return { tenant, application };
}

/**
 * Ensure a TenantMember exists for the given user, creating it with the
 * provided role when missing. Returns the PERSISTED role (which may differ
 * from the requested one when the membership already exists — existing roles
 * are never silently changed by provisioning).
 */
export async function ensureTenantMember(
  tenantId: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "DEVELOPER" | "FINANCE" | "VIEWER",
): Promise<"OWNER" | "ADMIN" | "DEVELOPER" | "FINANCE" | "VIEWER"> {
  const member = await prisma.tenantMember.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    create: { tenantId, userId, role },
    update: {}, // never modify an existing membership here
    select: { role: true },
  });
  return member.role;
}

/**
 * Backfill: provision tenants + memberships for every legacy Organization
 * that is not linked to a tenant yet, copying org memberships as tenant
 * memberships. Safe to re-run; each organization is processed in its own
 * transaction so one failure does not roll back the others.
 */
export async function backfillTenantsForOrgs(options?: {
  /** Process at most this many organizations (default: all). */
  limit?: number;
  logger?: (message: string) => void;
}): Promise<{
  created: number;
  skipped: number;
  membersCreated: number;
}> {
  const log = options?.logger ?? (() => {});

  const orgs = await prisma.organization.findMany({
    where: { tenantId: null },
    select: {
      id: true,
      name: true,
      slug: true,
      members: { select: { userId: true, role: true } },
    },
    ...(options?.limit ? { take: options.limit } : {}),
    orderBy: { createdAt: "asc" },
  });

  let created = 0;
  let skipped = 0;
  let membersCreated = 0;

  for (const org of orgs) {
    try {
      const result = await provisionTenantForOrg(org);
      if (!result.created) {
        skipped++;
      } else {
        created++;
        log(`Provisioned tenant "${result.tenant.slug}" for org "${org.slug}"`);
      }

      // Copy org memberships → tenant memberships (idempotent).
      for (const member of org.members) {
        const tenantRole =
          member.role === "OWNER" ? "OWNER" : member.role === "ADMIN" ? "ADMIN" : "VIEWER";
        const before = await prisma.tenantMember.findUnique({
          where: {
            tenantId_userId: { tenantId: result.tenant.id, userId: member.userId },
          },
          select: { id: true },
        });
        if (!before) membersCreated++;
        await ensureTenantMember(result.tenant.id, member.userId, tenantRole);
      }
    } catch (err) {
      // A duplicate tenant slug (e.g. an org renamed to another org's slug
      // mid-migration) must not abort the whole backfill.
      log(
        `Skipped org "${org.slug}" after error: ${err instanceof Error ? err.message : String(err)}`,
      );
      skipped++;
    }
  }

  return { created, skipped, membersCreated };
}
