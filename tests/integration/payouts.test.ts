/**
 * INTEGRATION: payout idempotency, state machine and concurrency — exercising
 * the PRODUCTION createPayout / transitionPayout (src/lib/payouts.ts) against
 * a real PostgreSQL database.
 *
 * Required scenarios: first payout, exact retry, conflicting retry, concurrent
 * requests, failed-request retry determinism, provider failure semantics,
 * concurrent transition protection.
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
  db = await createIntegrationDb("payouts");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

describe("Payout idempotency (production createPayout)", { skip: !!skipReason }, () => {
  it("first payout creates a PENDING payout", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout } = await import("@/lib/payouts");
    const app = await createTestApp("po1");

    const result = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 50000n,
      recipientPhone: "254712345678",
      recipientName: "Jane Supplier",
      idempotencyKey: "po-first",
    });

    assert.ok(result.ok);
    assert.equal(result.payout.status, "PENDING");
    assert.equal(result.payout.amountMinor, "50000");
    assert.equal(result.payout.recipientPhone, "254712345678");
  });

  it("exact retry replays the ORIGINAL payout", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout } = await import("@/lib/payouts");
    const app = await createTestApp("po2");

    const input = {
      applicationId: app.application.id,
      environment: "SANDBOX" as const,
      amountMinor: 20000n,
      recipientPhone: "254712345678",
      idempotencyKey: "po-retry",
    };
    const first = await createPayout(input);
    assert.ok(first.ok);

    const retry = await createPayout(input);
    assert.ok(retry.ok);
    assert.equal(retry.replayed, true);
    assert.equal(retry.payout.id, first.payout.id);
  });

  it("conflicting retry (different amount) → IDEMPOTENCY_CONFLICT, nothing created", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout } = await import("@/lib/payouts");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("po3");

    const first = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 10000n,
      recipientPhone: "254712345678",
      idempotencyKey: "po-conflict",
    });
    assert.ok(first.ok);

    const conflict = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 20000n, // different amount — same key
      recipientPhone: "254712345678",
      idempotencyKey: "po-conflict",
    });
    assert.ok(!conflict.ok);
    assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT");

    const count = await prisma.payout.count({
      where: { applicationId: app.application.id, idempotencyKey: "po-conflict" },
    });
    assert.equal(count, 1);
  });

  it("concurrent duplicate requests → exactly ONE payout (DB unique constraint)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout } = await import("@/lib/payouts");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("po4");

    const input = {
      applicationId: app.application.id,
      environment: "SANDBOX" as const,
      amountMinor: 30000n,
      recipientPhone: "254712345678",
      idempotencyKey: "po-concurrent",
    };

    const results = await Promise.all(
      Array.from({ length: 6 }, () => createPayout(input)),
    );

    assert.equal(results.filter((r) => r.ok && r.replayed !== true).length, 1);
    const ids = new Set(
      results.filter((r) => r.ok).map((r) => (r.ok ? r.payout.id : "")),
    );
    assert.equal(ids.size, 1);

    const dbCount = await prisma.payout.count({
      where: { applicationId: app.application.id, idempotencyKey: "po-concurrent" },
    });
    assert.equal(dbCount, 1, "never duplicate a real-world payout operation");
  });

  it("validation failures are deterministic and burn no keys", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout } = await import("@/lib/payouts");
    const app = await createTestApp("po5");

    // Invalid phone is rejected BEFORE idempotency — the key is not consumed.
    const badPhone = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
      recipientPhone: "0712345678", // local format not accepted here
      idempotencyKey: "po-invalid",
    });
    assert.ok(!badPhone.ok);
    assert.equal(badPhone.code, "INVALID_PHONE");

    // The same key can still be used for a valid request.
    const valid = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
      recipientPhone: "254712345678",
      idempotencyKey: "po-invalid",
    });
    assert.ok(valid.ok);
  });

  it("environment-scoped keys: same key in SANDBOX and LIVE are separate payouts", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout } = await import("@/lib/payouts");
    const app = await createTestApp("po6");
    const key = `po-env-${Date.now()}`;

    const sandbox = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
      recipientPhone: "254712345678",
      idempotencyKey: key,
    });
    const live = await createPayout({
      applicationId: app.application.id,
      environment: "LIVE",
      amountMinor: 1000n,
      recipientPhone: "254712345678",
      idempotencyKey: key,
    });
    assert.ok(sandbox.ok && live.ok);
    assert.notEqual(sandbox.payout.id, live.payout.id);
  });
});

describe("Payout state machine (production transitionPayout)", { skip: !!skipReason }, () => {
  it("happy path: PENDING → PROCESSING → SUCCEEDED", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout, transitionPayout } = await import("@/lib/payouts");
    const app = await createTestApp("pot1");

    const created = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 15000n,
      recipientPhone: "254712345678",
    });
    assert.ok(created.ok);

    const processing = await transitionPayout(created.payout.id, "PROCESSING");
    assert.ok(processing);
    assert.equal(processing.status, "PROCESSING");

    const succeeded = await transitionPayout(created.payout.id, "SUCCEEDED");
    assert.ok(succeeded);
    assert.equal(succeeded.status, "SUCCEEDED");
    assert.ok(succeeded.processedAt);
  });

  it("provider failure: PROCESSING → FAILED records the error and is TERMINAL", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout, transitionPayout, InvalidTransitionError } = await import("@/lib/payouts");
    const app = await createTestApp("pot2");

    const created = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 15000n,
      recipientPhone: "254712345678",
    });
    assert.ok(created.ok);
    await transitionPayout(created.payout.id, "PROCESSING");

    const failed = await transitionPayout(created.payout.id, "FAILED", {
      errorCode: "INSUFFICIENT_FLOAT",
      errorMessage: "B2C float account has insufficient funds",
    });
    assert.ok(failed);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.errorCode, "INSUFFICIENT_FLOAT");

    // FAILED is terminal — no resurrection, no COMPLETED→PENDING rollback.
    await assert.rejects(
      transitionPayout(created.payout.id, "SUCCEEDED"),
      InvalidTransitionError,
    );
    await assert.rejects(
      transitionPayout(created.payout.id, "PENDING"),
      InvalidTransitionError,
    );
  });

  it("invalid direct transitions throw (PENDING → SUCCEEDED, SUCCEEDED → FAILED)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout, transitionPayout, InvalidTransitionError } = await import("@/lib/payouts");
    const app = await createTestApp("pot3");

    const created = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
      recipientPhone: "254712345678",
    });
    assert.ok(created.ok);

    await assert.rejects(
      transitionPayout(created.payout.id, "SUCCEEDED"),
      InvalidTransitionError, // cannot skip PROCESSING
    );

    await transitionPayout(created.payout.id, "PROCESSING");
    await transitionPayout(created.payout.id, "SUCCEEDED");

    await assert.rejects(
      transitionPayout(created.payout.id, "FAILED"),
      InvalidTransitionError, // SUCCEEDED is terminal
    );
  });

  it("concurrent terminal transitions: exactly one wins (guarded update)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout, transitionPayout, TransitionConflictError } = await import("@/lib/payouts");
    const app = await createTestApp("pot4");

    const created = await createPayout({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
      recipientPhone: "254712345678",
    });
    assert.ok(created.ok);
    await transitionPayout(created.payout.id, "PROCESSING");

    const results = await Promise.allSettled([
      transitionPayout(created.payout.id, "SUCCEEDED"),
      transitionPayout(created.payout.id, "FAILED", { errorCode: "X" }),
    ]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const loser = results.find((r) => r.status === "rejected");
    assert.ok(loser);
    assert.ok(loser.reason instanceof TransitionConflictError);
  });

  it("getPayout is application-scoped (no cross-tenant reads)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayout, getPayout } = await import("@/lib/payouts");
    const appA = await createTestApp("poida");
    const appB = await createTestApp("poidb");

    const created = await createPayout({
      applicationId: appA.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
      recipientPhone: "254712345678",
    });
    assert.ok(created.ok);

    assert.equal(await getPayout(created.payout.id, appB.application.id), null);
    assert.ok(await getPayout(created.payout.id, appA.application.id));
  });
});
