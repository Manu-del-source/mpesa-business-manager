/**
 * API key unit tests — importing the PRODUCTION functions from
 * src/lib/api-keys.ts (scope validation, prefixes, hashing) and the
 * permission registry.
 *
 * DB-backed lifecycle tests (create/verify/rotate/revoke) live in
 * tests/integration/api-keys.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  KEY_PREFIXES,
  sha256Hash,
  validateRequestedScopes,
  defaultScopesForRole,
  AUTHENTICATING_KEY_TYPES,
} from "@/lib/api-keys";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "@/lib/permissions";

// ---------------------------------------------------------------------------
// Prefixes (production table)
// ---------------------------------------------------------------------------

describe("API key prefixes (production KEY_PREFIXES)", () => {
  it("SANDBOX keys use _test_ prefix", () => {
    assert.equal(KEY_PREFIXES.SECRET.SANDBOX, "sk_test");
    assert.equal(KEY_PREFIXES.PUBLIC.SANDBOX, "pk_test");
    assert.equal(KEY_PREFIXES.WEBHOOK_SECRET.SANDBOX, "whsec_test");
  });

  it("LIVE keys use _live_ prefix", () => {
    assert.equal(KEY_PREFIXES.SECRET.LIVE, "sk_live");
    assert.equal(KEY_PREFIXES.PUBLIC.LIVE, "pk_live");
    assert.equal(KEY_PREFIXES.WEBHOOK_SECRET.LIVE, "whsec_live");
  });

  it("public keys start with pk_", () => assert.match(KEY_PREFIXES.PUBLIC.SANDBOX, /^pk_/));
  it("secret keys start with sk_", () => assert.match(KEY_PREFIXES.SECRET.SANDBOX, /^sk_/));
  it("webhook signing keys start with whsec_", () => assert.match(KEY_PREFIXES.WEBHOOK_SECRET.SANDBOX, /^whsec_/));

  it("only SECRET keys authenticate /v1 requests (PUBLIC never authorizes)", () => {
    assert.deepEqual([...AUTHENTICATING_KEY_TYPES], ["SECRET"]);
  });
});

// ---------------------------------------------------------------------------
// Hashing (production sha256Hash — the at-rest form)
// ---------------------------------------------------------------------------

describe("Key hashing (production sha256Hash)", () => {
  it("produces a 64-char hex string", () => {
    assert.match(sha256Hash("sk_test_abc"), /^[0-9a-f]{64}$/);
  });

  it("same key produces same hash (lookup stability)", () => {
    assert.equal(sha256Hash("sk_test_abc"), sha256Hash("sk_test_abc"));
  });

  it("different keys produce different hashes", () => {
    assert.notEqual(sha256Hash("sk_test_abc"), sha256Hash("sk_test_abd"));
  });
});

// ---------------------------------------------------------------------------
// Scope validation (production validateRequestedScopes)
// ---------------------------------------------------------------------------

describe("validateRequestedScopes (production — no privilege escalation)", () => {
  it("accepts registry scopes the caller holds", () => {
    const r = validateRequestedScopes(
      ["payments:create", "payments:read"],
      ["payments:create", "payments:read", "ledger:read"],
    );
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.scopes, ["payments:create", "payments:read"]);
  });

  it("rejects unknown scopes (registry validation)", () => {
    const r = validateRequestedScopes(["payments:create", "totally:bogus"], ALL_PERMISSIONS);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.code, "INVALID_SCOPES");
      assert.match(r.error, /totally:bogus/);
    }
  });

  it("rejects scopes the caller does not hold (no escalation)", () => {
    const r = validateRequestedScopes(["payments:refund"], ["payments:read"]);
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.code, "UNAUTHORIZED_SCOPES");
      assert.match(r.error, /payments:refund/);
    }
  });

  it("an api-keys:manage-only caller cannot mint a payments key", () => {
    const r = validateRequestedScopes(["payments:create"], ["api-keys:manage"]);
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.code, "UNAUTHORIZED_SCOPES");
  });

  it("deduplicates requested scopes", () => {
    const r = validateRequestedScopes(["payments:read", "payments:read"], ["payments:read"]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.scopes, ["payments:read"]);
  });

  it("empty scope list is valid", () => {
    const r = validateRequestedScopes([], []);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.scopes, []);
  });
});

describe("defaultScopesForRole (production)", () => {
  it("returns the registry defaults for each role", () => {
    for (const role of ["OWNER", "ADMIN", "DEVELOPER", "FINANCE", "VIEWER"] as const) {
      assert.deepEqual(
        defaultScopesForRole(role),
        [...DEFAULT_ROLE_PERMISSIONS[role]],
      );
    }
  });
});
