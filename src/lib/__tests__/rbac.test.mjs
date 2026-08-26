import { describe, it } from "node:test";
import assert from "node:assert/strict";

const PERMISSIONS = {
  "payments:create": 1, "payments:read": 1, "payments:refund": 1, "payments:cancel": 1,
  "payouts:create": 1, "payouts:read": 1, "payouts:approve": 1,
  "ledger:read": 1, "ledger:post": 1,
  "reconciliation:read": 1, "reconciliation:run": 1,
  "webhooks:read": 1, "webhooks:manage": 1,
  "api-keys:read": 1, "api-keys:manage": 1,
  "providers:read": 1, "providers:manage": 1,
  "settings:read": 1, "settings:manage": 1,
  "members:read": 1, "members:manage": 1,
  "audit:read": 1, "usage:read": 1,
  "pos:sales": 1, "pos:inventory": 1, "pos:customers": 1, "pos:expenses": 1, "pos:reports": 1,
};

const DEFAULT_ROLE_PERMISSIONS = {
  OWNER: Object.keys(PERMISSIONS),
  ADMIN: Object.keys(PERMISSIONS).filter((p) => p !== "members:manage"),
  DEVELOPER: ["payments:create", "payments:read", "ledger:read", "reconciliation:read", "webhooks:read", "webhooks:manage", "api-keys:read", "api-keys:manage", "providers:read", "audit:read", "pos:sales", "pos:inventory", "pos:customers"],
  FINANCE: ["payments:create", "payments:read", "payments:refund", "payouts:create", "payouts:read", "payouts:approve", "ledger:read", "ledger:post", "reconciliation:read", "reconciliation:run", "audit:read", "usage:read", "pos:sales", "pos:reports"],
  VIEWER: ["payments:read", "ledger:read", "reconciliation:read", "audit:read", "usage:read", "pos:sales", "pos:inventory", "pos:customers", "pos:reports"],
};

function hasPermission(perms, required) { return perms.includes(required); }
function hasAllPermissions(perms, required) { return required.every((p) => perms.includes(p)); }
function hasAnyPermission(perms, required) { return required.some((p) => perms.includes(p)); }

describe("PERMISSIONS", () => {
  it("has 28 permissions", () => assert.equal(Object.keys(PERMISSIONS).length, 28));
  it("all follow domain:action format", () => {
    for (const name of Object.keys(PERMISSIONS)) assert.match(name, /^[a-z-]+:[a-z-]+$/);
  });
});

describe("DEFAULT_ROLE_PERMISSIONS", () => {
  it("OWNER has all 28 permissions", () => assert.equal(DEFAULT_ROLE_PERMISSIONS.OWNER.length, 28));
  it("ADMIN has all except members:manage", () => {
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.ADMIN.includes("members:manage"));
    assert.ok(DEFAULT_ROLE_PERMISSIONS.ADMIN.includes("payments:create"));
  });
  it("DEVELOPER cannot manage settings or members", () => {
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.DEVELOPER.includes("settings:manage"));
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.DEVELOPER.includes("members:manage"));
  });
  it("FINANCE cannot manage webhooks or API keys", () => {
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.FINANCE.includes("webhooks:manage"));
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.FINANCE.includes("api-keys:manage"));
  });
  it("VIEWER has read-only access plus POS basics", () => {
    assert.ok(DEFAULT_ROLE_PERMISSIONS.VIEWER.includes("payments:read"));
    assert.ok(!DEFAULT_ROLE_PERMISSIONS.VIEWER.includes("payments:create"));
  });
  it("every role is a subset of OWNER", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (role === "OWNER") continue;
      for (const perm of perms) {
        assert.ok(DEFAULT_ROLE_PERMISSIONS.OWNER.includes(perm), `OWNER missing ${perm} from ${role}`);
      }
    }
  });
  it("OWNER is strictly the largest role", () => {
    const ownerCount = DEFAULT_ROLE_PERMISSIONS.OWNER.length;
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (role === "OWNER") continue;
      assert.ok(ownerCount > perms.length, `OWNER (${ownerCount}) should be > ${role} (${perms.length})`);
    }
  });
});

describe("hasPermission", () => {
  it("returns true when present", () => assert.ok(hasPermission(["payments:create", "payments:read"], "payments:create")));
  it("returns false when absent", () => assert.ok(!hasPermission(["payments:read"], "payments:create")));
});

describe("hasAllPermissions", () => {
  it("returns true when all present", () => assert.ok(hasAllPermissions(["a", "b", "c"], ["a", "b"])));
  it("returns false when one missing", () => assert.ok(!hasAllPermissions(["a"], ["a", "b"])));
  it("returns true for empty required", () => assert.ok(hasAllPermissions(["a"], [])));
});

describe("hasAnyPermission", () => {
  it("returns true when at least one present", () => assert.ok(hasAnyPermission(["a", "b"], ["a", "c"])));
  it("returns false when none match", () => assert.ok(!hasAnyPermission(["a"], ["b", "c"])));
  it("returns false for empty required", () => assert.ok(!hasAnyPermission(["a"], [])));
});
