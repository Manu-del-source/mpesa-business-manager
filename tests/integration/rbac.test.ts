/**
 * INTEGRATION: RBAC permission resolution — exercising the PRODUCTION
 * src/lib/rbac.ts (resolvePermissions / requirePermissions /
 * seedRolesAndPermissions) against a real PostgreSQL database.
 *
 * Required scenarios:
 *   1. bootstrap fallback to built-in defaults when Role tables are empty
 *   2. seeded database serves permissions from the DB
 *   3. role hierarchy enforced (OWNER ⊃ ADMIN ⊃ … ; VIEWER read-only)
 *   4. least privilege: FINANCE has refunds, VIEWER does not
 *   5. fail-closed: unknown role → NO permissions
 *   6. re-seeding REPLACES stale grants (revocation actually revokes)
 *   7. unknown permission names in the DB can never leak into grants
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  createIntegrationDb,
  dropIntegrationDb,
  integrationTestsAvailable,
  type IntegrationDb,
} from "../helpers/integration-db.js";

const skipReason = integrationTestsAvailable()
  ? undefined
  : "integration tests need TEST_DATABASE_ADMIN_URL (or DATABASE_URL) pointing at a PostgreSQL server";

let db: IntegrationDb | null = null;

before(async () => {
  if (skipReason) return;
  db = await createIntegrationDb("rbac");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

describe("RBAC permission resolution (production rbac.ts)", { skip: !!skipReason }, () => {
  it("1. before seeding: built-in defaults serve (bootstrap fallback)", async () => {
    const { resolvePermissions } = await import("@/lib/rbac");
    const { DEFAULT_ROLE_PERMISSIONS } = await import("@/lib/permissions");

    const owner = await resolvePermissions("OWNER");
    assert.deepEqual([...owner].sort(), [...DEFAULT_ROLE_PERMISSIONS.OWNER].sort());
  });

  it("2. unknown role → NO permissions (fail closed)", async () => {
    const { resolvePermissions } = await import("@/lib/rbac");
    assert.deepEqual(await resolvePermissions("SUPERUSER" as never), []);
  });

  it("3. least privilege: FINANCE can refund, VIEWER cannot", async () => {
    const { resolvePermissions, requirePermissions, PermissionDeniedError } = await import("@/lib/rbac");

    const finance = await resolvePermissions("FINANCE");
    assert.ok(finance.includes("payments:refund"));
    await requirePermissions("FINANCE", "payments:refund"); // does not throw

    assert.ok(!(await resolvePermissions("VIEWER")).includes("payments:refund"));
    await assert.rejects(requirePermissions("VIEWER", "payments:refund"), PermissionDeniedError);
  });

  it("4. VIEWER is read-only across the money surfaces", async () => {
    const { resolvePermissions } = await import("@/lib/rbac");
    const viewer = await resolvePermissions("VIEWER");
    for (const write of ["payments:create", "payments:refund", "payouts:create", "ledger:post"] as const) {
      assert.ok(!viewer.includes(write), `VIEWER must not hold ${write}`);
    }
    for (const read of ["payments:read", "ledger:read", "audit:read"] as const) {
      assert.ok(viewer.includes(read), `VIEWER must hold ${read}`);
    }
  });

  it("5. seedRolesAndPermissions populates the DB and resolution then serves from it", async () => {
    const { seedRolesAndPermissions, resolvePermissions } = await import("@/lib/rbac");
    const { prisma } = await import("@/lib/prisma");
    const { DEFAULT_ROLE_PERMISSIONS, ALL_PERMISSIONS, TENANT_ROLES } = await import("@/lib/permissions");

    const summary = await seedRolesAndPermissions();
    assert.equal(summary.permissions, ALL_PERMISSIONS.length);
    assert.equal(summary.roles, TENANT_ROLES.length);

    const roleCount = await prisma.role.count();
    assert.equal(roleCount, TENANT_ROLES.length);
    const permissionCount = await prisma.permission.count();
    assert.equal(permissionCount, ALL_PERMISSIONS.length);

    // Resolution now comes from the DB — identical to the canonical defaults.
    const admin = await resolvePermissions("ADMIN");
    assert.deepEqual([...admin].sort(), [...DEFAULT_ROLE_PERMISSIONS.ADMIN].sort());
  });

  it("6. re-seeding REPLACES grants — manually-added stale grants are revoked", async () => {
    const { seedRolesAndPermissions, resolvePermissions } = await import("@/lib/rbac");
    const { prisma } = await import("@/lib/prisma");
    await seedRolesAndPermissions();

    // Hostile grant: give VIEWER payout approval directly in the DB.
    const viewer = await prisma.role.findUniqueOrThrow({ where: { name: "VIEWER" } });
    const payoutApprove = await prisma.permission.findUniqueOrThrow({ where: { name: "payouts:approve" } });
    await prisma.role.update({
      where: { id: viewer.id },
      data: { permissions: { connect: { id: payoutApprove.id } } },
    });
    const escalated = await resolvePermissions("VIEWER");
    assert.ok(escalated.includes("payouts:approve"), "setup: stale grant is live before re-seed");

    // Re-seeding converges the role back to the canonical (least-privilege) set.
    await seedRolesAndPermissions();
    const healed = await resolvePermissions("VIEWER");
    assert.ok(!healed.includes("payouts:approve"), "re-seed must revoke stale grants");
  });

  it("7. unknown permission names in the DB never leak into grants", async () => {
    const { seedRolesAndPermissions, resolvePermissions } = await import("@/lib/rbac");
    const { prisma } = await import("@/lib/prisma");
    await seedRolesAndPermissions();

    // A rogue permission row + grant to DEVELOPER.
    const rogue = await prisma.permission.create({ data: { name: "god-mode" } });
    const developer = await prisma.role.findUniqueOrThrow({ where: { name: "DEVELOPER" } });
    await prisma.role.update({
      where: { id: developer.id },
      data: { permissions: { connect: { id: rogue.id } } },
    });

    const perms = await resolvePermissions("DEVELOPER");
    assert.ok(!perms.includes("god-mode" as never), "non-registry permissions must be filtered out");
    // The role still resolves its legitimate grants.
    assert.ok(perms.includes("webhooks:manage"));
  });

  it("8. OWNER holds every registry permission; roles cover the full enum", async () => {
    const { resolvePermissions } = await import("@/lib/rbac");
    const { ALL_PERMISSIONS, TENANT_ROLES, DEFAULT_ROLE_PERMISSIONS } = await import("@/lib/permissions");

    const owner = await resolvePermissions("OWNER");
    for (const p of ALL_PERMISSIONS) assert.ok(owner.includes(p), `OWNER must hold ${p}`);

    for (const role of TENANT_ROLES) {
      assert.ok(Array.isArray(DEFAULT_ROLE_PERMISSIONS[role]), `defaults must exist for ${role}`);
    }
  });
});
