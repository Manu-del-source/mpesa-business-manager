import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PREFIXES = {
  PUBLIC: { SANDBOX: "pk_test", LIVE: "pk_live" },
  SECRET: { SANDBOX: "sk_test", LIVE: "sk_live" },
  WEBHOOK_SECRET: { SANDBOX: "whsec_test", LIVE: "whsec_live" },
};

function sha256Hash(data) { return createHash("sha256").update(data).digest("hex"); }

function generateKey(keyType, environment) {
  const prefix = KEY_PREFIXES[keyType][environment];
  const rawSecret = randomBytes(32).toString("base64url");
  const fullKey = `${prefix}_${rawSecret}`;
  const hash = sha256Hash(fullKey);
  const preview = `${prefix}_...${rawSecret.slice(-4)}`;
  return { fullKey, hash, prefix, preview };
}

function constantTimeCompare(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

describe("API key prefixes", () => {
  it("SANDBOX keys use _test_ prefix", () => {
    assert.equal(KEY_PREFIXES.PUBLIC.SANDBOX, "pk_test");
    assert.equal(KEY_PREFIXES.SECRET.SANDBOX, "sk_test");
    assert.equal(KEY_PREFIXES.WEBHOOK_SECRET.SANDBOX, "whsec_test");
  });
  it("LIVE keys use _live_ prefix", () => {
    assert.equal(KEY_PREFIXES.PUBLIC.LIVE, "pk_live");
    assert.equal(KEY_PREFIXES.SECRET.LIVE, "sk_live");
    assert.equal(KEY_PREFIXES.WEBHOOK_SECRET.LIVE, "whsec_live");
  });
  it("public keys start with pk_", () => assert.match(KEY_PREFIXES.PUBLIC.SANDBOX, /^pk_/));
  it("secret keys start with sk_", () => assert.match(KEY_PREFIXES.SECRET.SANDBOX, /^sk_/));
  it("webhook signing keys start with whsec_", () => assert.match(KEY_PREFIXES.WEBHOOK_SECRET.SANDBOX, /^whsec_/));
});

describe("key generation", () => {
  it("generates a full key with correct prefix", () => {
    const { fullKey, prefix } = generateKey("SECRET", "SANDBOX");
    assert.match(fullKey, /^sk_test_/);
    assert.equal(prefix, "sk_test");
  });
  it("generates different keys each time", () => {
    const k1 = generateKey("SECRET", "SANDBOX");
    const k2 = generateKey("SECRET", "SANDBOX");
    assert.notEqual(k1.fullKey, k2.fullKey);
  });
  it("generates a preview that hides most of the secret", () => {
    const { fullKey, preview } = generateKey("SECRET", "LIVE");
    assert.match(preview, /^sk_live_\.\.\./);
    assert.notEqual(preview, fullKey);
    assert.ok(preview.length < fullKey.length);
  });
  it("hash is a 64-char hex string (SHA-256)", () => {
    assert.match(generateKey("SECRET", "SANDBOX").hash, /^[a-f0-9]{64}$/);
  });
  it("same key produces same hash", () => {
    const key = "sk_test_abc123def456";
    assert.equal(sha256Hash(key), sha256Hash(key));
  });
  it("different keys produce different hashes", () => {
    assert.notEqual(sha256Hash("sk_test_abc"), sha256Hash("sk_test_xyz"));
  });
});

describe("timing-safe comparison", () => {
  it("returns true for identical strings", () => assert.ok(constantTimeCompare("abc", "abc")));
  it("returns false for different strings", () => assert.ok(!constantTimeCompare("abc", "abd")));
  it("returns false for different lengths", () => assert.ok(!constantTimeCompare("abc", "abcd")));
});

describe("key format validation", () => {
  it("keys contain only base64url-safe characters after prefix", () => {
    const { fullKey, prefix } = generateKey("SECRET", "SANDBOX");
    const secretPart = fullKey.slice(prefix.length + 1);
    assert.match(secretPart, /^[A-Za-z0-9_-]+$/);
  });
  it("all 12 key type × environment combinations work", () => {
    for (const kt of ["PUBLIC", "SECRET", "WEBHOOK_SECRET"]) {
      for (const env of ["SANDBOX", "LIVE"]) {
        const { fullKey, prefix } = generateKey(kt, env);
        assert.ok(fullKey.startsWith(`${prefix}_`));
      }
    }
  });
});
