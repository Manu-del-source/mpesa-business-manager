/**
 * RBAC unit tests — importing the PRODUCTION permission registry
 * (src/lib/permissions.ts), the single source of truth consumed by the
 * runtime RBAC resolver, the seed, and API-key scope validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PERMISSIONS,
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  TENANT_ROLES,
  isValidPermission,
  invalidPermissions,
  filterValidPermissions,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  tenantRoleForOrgRole,
} from "@/lib/permissions";

describe("PERMISSIONS registry (production)", () => {
  it("has 28 permissions", () => assert.equal(ALL_PERMISSIONS.length, 28));

  it("every entry is its own key (no aliasing)", () => {
    for (const name of ALL_PERMISSIONS) {
      assert.equal(PERMISSIONS[name], name);
    }
  });

  it("all follow domain:action format", () => {
    for (const name of ALL_PERMISSIONS) {
      assert.match(name, /^[a-z-]+:[a-z-]+$/);
    }
  });

  it("covers the critical financial permissions", () => {
    for (const p of [
      "payments:create",
      "payments:refund",
      "payouts:create",
      "payouts:approve",
      "ledger:post",
      "reconciliation:run",
      "api-keys:manage",
      "audit:read",
    ]) {
      assert.ok(isValidPermission(p), `missing ${p}`);
    }
  });
});

describe("Validation helpers (production)", () => {
  it("isValidPermission accepts known, rejects unknown", () => {
    assert.ok(isValidPermission("payments:read"));
    assert.ok(!isValidPermission("payments:delete"));
    assert.ok(!isValidPermission(""));
    assert.ok(!isValidPermission("admin"));
  });

  it("invalidPermissions lists exactly the unknown entries", () => {
    assert.deepEqual(
      invalidPermissions(["payments:read", "bogus:scope", "also-bogus"]),
      ["bogus:scope", "also-bogus"],
    );
    assert.deepEqual(invalidPermissions([]), []);
  });

  it("filterValidPermissions never lets unknown strings through", () => {
    assert.deepEqual(
      filterValidPermissions(["payments:read", "EVIL:*", "ledger:post"]),
      ["payments:read", "ledger:post"],
    );
  });
});

describe("DEFAULT_ROLE_PERMISSIONS (production role grants)", () => {
  it("every role grant is a valid permission (no typos granting nothing)", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) {
        assert.ok(
          isValidPermission(p),
          `role ${role} references unknown permission ${p}`,
        );
      }
    }
  });

  it("no duplicate grants within a role", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      assert.equal(
        new Set(perms).size,
        perms.length,
        `role ${role} has duplicate grants`,
      );
    }
  });

  it("OWNER has all 28 permissions", () => {
    assert.equal(DEFAULT_ROLE_PERMISSIONS.OWNER.length, 28);
  });

  it("every role is a subset of OWNER", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (role === "OWNER") continue;
      for (const perm of perms) {
        assert.ok(
          DEFAULT_ROLE_PERMISSIONS.OWNER.includes(perm as never),
          `OWNER missing ${perm} granted to ${role}`,
        );
      }
    }
  });

  it("ADMIN has all except members:manage", () => {
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.ADMIN.includes("members:manage"));
    assert.ok(DEFAULT_ROLE_PERMISSIONS.ADMIN.includes("payments:create"));
  });

  it("DEVELOPER cannot manage settings or members", () => {
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.DEVELOPER.includes("settings:manage"));
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.DEVELOPER.includes("members:manage"));
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.DEVELOPER.includes("payments:refund"));
  });

  it("FINANCE cannot manage webhooks or API keys", () => {
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.FINANCE.includes("webhooks:manage"));
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.FINANCE.includes("api-keys:manage"));
    assert.ok(DEFAULT_ROLE_PERMISSIONS.FINANCE.includes("payouts:approve"));
  });

  it("VIEWER is read-only (no mutating permissions)", () => {
    const viewer = DEFAULT_ROLE_PERMISSIONS.VIEWER;
    assert.ok(viewer.includes("payments:read"));
    assert.ok(!viewer.includes("payments:create"));
    assert.ok(!viewer.includes("payments:refund"));
    assert.ok(!viewer.includes("payouts:create"));
    assert.ok(!viewer.includes("ledger:post"));
    assert.ok(!viewer.includes("api-keys:manage"));
    for (const p of viewer) {
      assert.ok(!p.endsWith(":create") && !p.endsWith(":manage") && !p.endsWith(":post") && !p.endsWith(":run") && !p.endsWith(":approve") && !p.endsWith(":refund") && !p.endsWith(":cancel"), `VIEWER has mutating permission ${p}`);
    }
  });

  it("TENANT_ROLES matches DEFAULT_ROLE_PERMISSIONS keys", () => {
    assert.deepEqual(
      [...TENANT_ROLES].sort(),
      Object.keys(DEFAULT_ROLE_PERMISSIONS).sort(),
    );
  });
});

describe("Permission-set checks (production)", () => {
  it("hasPermission", () => {
    assert.ok(hasPermission(["payments:read"], "payments:read"));
    assert.ok(!hasPermission(["payments:read"], "payments:create"));
  });

  it("hasAllPermissions requires every permission", () => {
    assert.ok(hasAllPermissions(["a", "b"] as never, ["a" as never, "b" as never]));
    assert.ok(!hasAllPermissions(["a"] as never, ["a" as never, "b" as never]));
    assert.ok(hasAllPermissions(["a"] as never, []));
  });

  it("hasAnyPermission requires at least one", () => {
    assert.ok(hasAnyPermission(["a", "b"] as never, ["b" as never]));
    assert.ok(!hasAnyPermission(["a"] as never, ["b" as never, "c" as never]));
    assert.ok(!hasAnyPermission([] as never, ["a" as never]));
  });
});

describe("tenantRoleForOrgRole (production mapping)", () => {
  it("maps legacy org roles onto tenant roles", () => {
    assert.equal(tenantRoleForOrgRole("OWNER"), "OWNER");
    assert.equal(tenantRoleForOrgRole("ADMIN"), "ADMIN");
    assert.equal(tenantRoleForOrgRole("STAFF"), "VIEWER");
  });
});
