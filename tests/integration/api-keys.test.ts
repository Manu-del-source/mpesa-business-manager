/**
 * INTEGRATION: API key lifecycle — exercising the PRODUCTION
 * src/lib/api-keys.ts (generateApiKey / verifyApiKey / revokeApiKey /
 * rotateApiKey / listApiKeys) against a real PostgreSQL database.
 *
 * Required scenarios:
 *   1. secrets are hashed (SHA-256) — the raw key is NEVER stored
 *   2. verification round-trip + lastUsedAt touch
 *   3. unknown / revoked / expired keys fail CLOSED
 *   4. environment scoping (sandbox key ≠ live key)
 *   5. scope enforcement (least privilege)
 *   6. key-type enforcement (PUBLIC keys identify, never authorize)
 *   7. rotation revokes the old key atomically, app-scoped
 *   8. listing is redacted (no hashes, no secrets)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

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
  db = await createIntegrationDb("apikeys");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

describe("API key generation & storage (hash-only)", { skip: !!skipReason }, () => {
  it("1. stores ONLY the SHA-256 hash + preview — never the raw secret", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, sha256Hash } = await import("@/lib/api-keys");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("ak1");

    const result = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "integration key",
      scopes: ["payments:read", "payments:create"],
    });
    assert.ok(result.ok);

    const record = await prisma.apiKey.findUniqueOrThrow({ where: { id: result.id } });
    // The hash matches the returned secret…
    assert.equal(record.keyHash, sha256Hash(result.secretKey));
    // …and the raw secret appears NOWHERE in the stored row.
    assert.notEqual(record.keyHash, result.secretKey);
    assert.ok(!JSON.stringify(record).includes(result.secretKey));
    // Wire-format prefix + preview.
    assert.ok(result.secretKey.startsWith("sk_test_"));
    assert.ok(record.keyPreview.startsWith("sk_test_..."));
    assert.deepEqual(record.scopes, ["payments:read", "payments:create"]);
  });

  it("2. rejects scopes outside the permission registry", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey } = await import("@/lib/api-keys");
    const app = await createTestApp("ak2");

    const result = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "bad scopes",
      scopes: ["payments:read", "admin:*"],
    });
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.code, "INVALID_SCOPES");
  });

  it("3. the same secret never generates two rows (hash is unique)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, sha256Hash } = await import("@/lib/api-keys");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("ak3");

    const a = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "a",
    });
    assert.ok(a.ok);
    const dupes = await prisma.apiKey.count({ where: { keyHash: sha256Hash(a.secretKey) } });
    assert.equal(dupes, 1);
  });
});

describe("API key verification (fail closed)", { skip: !!skipReason }, () => {
  it("4. valid key verifies, returns app/env/scopes, touches lastUsedAt", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, verifyApiKey } = await import("@/lib/api-keys");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("ak4");

    const created = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "verify me",
      scopes: ["payments:read"],
    });
    assert.ok(created.ok);

    const verified = await verifyApiKey(created.secretKey);
    assert.ok(verified, "a freshly generated key must verify");
    assert.equal(verified.applicationId, app.application.id);
    assert.equal(verified.environment, "SANDBOX");
    assert.equal(verified.keyType, "SECRET");
    assert.deepEqual(verified.scopes, ["payments:read"]);

    // lastUsedAt is updated (fire-and-forget — give it a moment).
    await new Promise((r) => setTimeout(r, 150));
    const record = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(record.lastUsedAt, "verification must touch lastUsedAt");
  });

  it("5. unknown key → null (no oracle)", async () => {
    const { verifyApiKey } = await import("@/lib/api-keys");
    assert.equal(await verifyApiKey("sk_test_totally-made-up-key"), null);
  });

  it("6. revoked key fails immediately; revoke is idempotent-by-count", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, verifyApiKey, revokeApiKey } = await import("@/lib/api-keys");
    const app = await createTestApp("ak6");

    const created = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "revoke me",
    });
    assert.ok(created.ok);
    assert.ok(await verifyApiKey(created.secretKey));

    assert.equal(await revokeApiKey(created.id), true);
    assert.equal(await verifyApiKey(created.secretKey), null, "revoked key must fail closed");
    assert.equal(await revokeApiKey(created.id), false, "second revoke touches nothing");
  });

  it("7. expired key fails closed", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, verifyApiKey } = await import("@/lib/api-keys");
    const app = await createTestApp("ak7");

    const created = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "expired",
      expiresAt: new Date(Date.now() - 60_000),
    });
    assert.ok(created.ok);
    assert.equal(await verifyApiKey(created.secretKey), null);
  });

  it("8. environment scoping: a SANDBOX key cannot authenticate as LIVE", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, verifyApiKey } = await import("@/lib/api-keys");
    const app = await createTestApp("ak8");

    const created = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "sandbox only",
    });
    assert.ok(created.ok);

    assert.ok(await verifyApiKey(created.secretKey, { requiredEnvironment: "SANDBOX" }));
    assert.equal(
      await verifyApiKey(created.secretKey, { requiredEnvironment: "LIVE" }),
      null,
      "cross-environment use must fail",
    );
  });

  it("9. scope enforcement: missing scope → null", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, verifyApiKey } = await import("@/lib/api-keys");
    const app = await createTestApp("ak9");

    const created = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "least privilege",
      scopes: ["payments:read"],
    });
    assert.ok(created.ok);

    assert.ok(await verifyApiKey(created.secretKey, { requiredScopes: ["payments:read"] }));
    assert.equal(
      await verifyApiKey(created.secretKey, { requiredScopes: ["payments:refund"] }),
      null,
      "a key must not authorize scopes it was never granted",
    );
  });

  it("10. PUBLIC keys identify but never authorize as Bearer credentials", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, verifyApiKey } = await import("@/lib/api-keys");
    const app = await createTestApp("ak10");

    const created = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "PUBLIC",
      name: "publishable",
    });
    assert.ok(created.ok);
    assert.ok(created.secretKey.startsWith("pk_test_"));

    assert.equal(await verifyApiKey(created.secretKey), null, "PUBLIC keys must not authenticate");
    // …unless the caller explicitly opts into identification-only use.
    assert.ok(await verifyApiKey(created.secretKey, { allowedKeyTypes: ["PUBLIC"] }));
  });
});

describe("API key rotation & listing", { skip: !!skipReason }, () => {
  it("11. rotation revokes the old secret and issues a working replacement", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, verifyApiKey, rotateApiKey } = await import("@/lib/api-keys");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("ak11");

    const created = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "rotating",
      scopes: ["payments:read", "payouts:read"],
    });
    assert.ok(created.ok);

    const rotated = await rotateApiKey({ keyId: created.id, applicationId: app.application.id });
    assert.ok(rotated);
    assert.equal(rotated.revokedKeyId, created.id);
    assert.notEqual(rotated.secretKey, created.secretKey);
    assert.deepEqual(rotated.scopes, ["payments:read", "payouts:read"]);

    // Old secret dead, new secret live.
    assert.equal(await verifyApiKey(created.secretKey), null);
    const verified = await verifyApiKey(rotated.secretKey);
    assert.ok(verified);
    assert.equal(verified.id, rotated.id);

    const old = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    assert.ok(old.revokedAt);
  });

  it("12. rotation is application-scoped — another app cannot rotate my key", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, rotateApiKey } = await import("@/lib/api-keys");
    const appA = await createTestApp("ak12a");
    const appB = await createTestApp("ak12b");

    const created = await generateApiKey({
      applicationId: appA.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "not yours",
    });
    assert.ok(created.ok);

    const hostile = await rotateApiKey({ keyId: created.id, applicationId: appB.application.id });
    assert.equal(hostile, null, "cross-application rotation must be refused");
  });

  it("13. listApiKeys is redacted — no hashes, no secrets, revoked flagged", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { generateApiKey, revokeApiKey, listApiKeys } = await import("@/lib/api-keys");
    const app = await createTestApp("ak13");

    const live = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "live key",
    });
    assert.ok(live.ok);
    const dead = await generateApiKey({
      applicationId: app.application.id,
      environment: "SANDBOX",
      keyType: "SECRET",
      name: "dead key",
    });
    assert.ok(dead.ok);
    await revokeApiKey(dead.id);

    const keys = await listApiKeys(app.application.id);
    assert.equal(keys.length, 2);
    const serialized = JSON.stringify(keys);
    assert.ok(!serialized.includes("keyHash"), "listing must not expose hashes");
    assert.ok(!serialized.includes(live.secretKey), "listing must not expose secrets");
    assert.ok(!serialized.includes(sha256Of(live.secretKey)), "listing must not expose hashes");

    const revokedView = keys.find((k) => k.id === dead.id);
    assert.ok(revokedView?.revokedAt, "revoked keys must be flagged in the listing");
  });
});

function sha256Of(value: string): string {
  // Cross-check that the raw hash never leaks through the listing either.
  return createHash("sha256").update(value).digest("hex");
}
