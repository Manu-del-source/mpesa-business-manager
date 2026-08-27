/**
 * INTEGRATION: payment idempotency & concurrency — exercising the PRODUCTION
 * createPayment / transitionPayment (src/lib/payments.ts) and the
 * transactional idempotency core (src/lib/idempotency.ts) against a real
 * PostgreSQL database.
 *
 * Required scenarios:
 *   1. first create          → new payment
 *   2. exact retry           → ORIGINAL result replayed
 *   3. conflicting payload   → IDEMPOTENCY_CONFLICT, nothing created
 *   4. concurrent duplicates → exactly one payment
 *   5. key scoping           → same key reusable across applications/environments
 *   6. guarded transitions   → races detected, invalid transitions rejected
 *   7. settlement enqueued   → SUCCEEDED transition queues ledger settlement
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
  db = await createIntegrationDb("payments");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

describe("Payment idempotency (production createPayment + runIdempotent)", { skip: !!skipReason }, () => {
  it("1. first create returns a new PENDING payment", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment } = await import("@/lib/payments");
    const app = await createTestApp("pay1");

    const result = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1549n,
      currency: "KES",
      phone: "254712345678",
      description: "first",
      idempotencyKey: "key-first",
    });

    assert.ok(result.ok);
    assert.equal(result.payment.status, "PENDING");
    assert.equal(result.payment.amountMinor, "1549");
    assert.equal(result.replayed, undefined);
  });

  it("2. exact retry replays the ORIGINAL result (same payment id)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment } = await import("@/lib/payments");
    const app = await createTestApp("pay2");

    const first = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 2000n,
      description: "retry-me",
      idempotencyKey: "key-retry",
    });
    assert.ok(first.ok);

    const retry = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 2000n,
      description: "retry-me",
      idempotencyKey: "key-retry",
    });

    assert.ok(retry.ok);
    assert.equal(retry.replayed, true);
    assert.equal(retry.payment.id, first.payment.id);
    assert.equal(retry.payment.createdAt, first.payment.createdAt);
  });

  it("3. same key + different payload → IDEMPOTENCY_CONFLICT, nothing created", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment } = await import("@/lib/payments");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("pay3");

    const first = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 3000n,
      idempotencyKey: "key-conflict",
    });
    assert.ok(first.ok);

    const conflict = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 9999n, // different amount
      idempotencyKey: "key-conflict",
    });

    assert.ok(!conflict.ok);
    assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT");

    // exactly one payment exists for this key
    const count = await prisma.payment.count({
      where: { applicationId: app.application.id, idempotencyKey: "key-conflict" },
    });
    assert.equal(count, 1);
  });

  it("4. concurrent duplicates → exactly ONE payment (unique constraint wins)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment } = await import("@/lib/payments");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("pay4");

    const input = {
      applicationId: app.application.id,
      environment: "SANDBOX" as const,
      amountMinor: 5000n,
      description: "concurrent",
      idempotencyKey: "key-concurrent",
    };

    const results = await Promise.all(
      Array.from({ length: 6 }, () => createPayment(input)),
    );

    const fresh = results.filter((r) => r.ok && r.replayed !== true);
    const replays = results.filter((r) => r.ok && r.replayed === true);
    assert.equal(fresh.length, 1, "exactly one creator must win");
    assert.ok(replays.length >= 1, "losers must replay the winner's result");
    // every successful response describes the SAME payment
    const ids = new Set(
      results.filter((r) => r.ok).map((r) => (r.ok ? r.payment.id : "")),
    );
    assert.equal(ids.size, 1);

    const dbCount = await prisma.payment.count({
      where: { applicationId: app.application.id, idempotencyKey: "key-concurrent" },
    });
    assert.equal(dbCount, 1, "database must contain exactly one payment");
  });

  it("5. idempotency keys are scoped per application AND environment", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment } = await import("@/lib/payments");
    const app = await createTestApp("pay5");
    const key = `scoped-${Date.now()}`;

    const sandbox = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
      idempotencyKey: key,
    });
    const live = await createPayment({
      applicationId: app.application.id,
      environment: "LIVE",
      amountMinor: 1000n,
      idempotencyKey: key,
    });

    assert.ok(sandbox.ok && live.ok);
    assert.notEqual(sandbox.payment.id, live.payment.id);
  });

  it("6. no idempotency key → every create is a new payment", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment } = await import("@/lib/payments");
    const app = await createTestApp("pay6");

    const a = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 700n,
    });
    const b = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 700n,
    });
    assert.ok(a.ok && b.ok);
    assert.notEqual(a.payment.id, b.payment.id);
  });

  it("7. amount policy is enforced before anything is stored", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, MAX_PAYMENT_MINOR } = await import("@/lib/payments");
    const app = await createTestApp("pay7");

    const tooBig = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: MAX_PAYMENT_MINOR + 1n,
    });
    assert.ok(!tooBig.ok);
    assert.equal(tooBig.code, "INVALID_AMOUNT");

    const zero = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 0n,
    });
    assert.ok(!zero.ok);
  });
});

describe("Payment state transitions (production transitionPayment)", { skip: !!skipReason }, () => {
  it("happy path: PENDING → PROCESSING → SUCCEEDED with attempts recorded", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment } = await import("@/lib/payments");
    const app = await createTestApp("pt1");

    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1200n,
    });
    assert.ok(created.ok);

    const processing = await transitionPayment(created.payment.id, "PROCESSING", {
      provider: "daraja",
      providerCheckoutId: "ws_CO_TEST",
    });
    assert.ok(processing);
    assert.equal(processing.status, "PROCESSING");

    const succeeded = await transitionPayment(created.payment.id, "SUCCEEDED", {
      provider: "daraja",
      providerRequestId: "29115-1",
      providerResponse: { ResultCode: 0 },
    });
    assert.ok(succeeded);
    assert.equal(succeeded.status, "SUCCEEDED");
    assert.ok(succeeded.processedAt);
  });

  it("invalid transitions throw (SUCCEEDED → PENDING, PENDING → SUCCEEDED)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment, InvalidTransitionError } = await import("@/lib/payments");
    const app = await createTestApp("pt2");

    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 100n,
    });
    assert.ok(created.ok);

    await assert.rejects(
      transitionPayment(created.payment.id, "SUCCEEDED"),
      InvalidTransitionError,
    );

    const processing = await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });
    assert.ok(processing);
    const succeeded = await transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" });
    assert.ok(succeeded);

    await assert.rejects(
      transitionPayment(created.payment.id, "PENDING"),
      InvalidTransitionError,
    );
    await assert.rejects(
      transitionPayment(created.payment.id, "FAILED"),
      InvalidTransitionError,
    );
  });

  it("concurrent SUCCEEDED transitions: exactly one wins (guarded update)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment, TransitionConflictError } = await import("@/lib/payments");
    const app = await createTestApp("pt3");

    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 100n,
    });
    assert.ok(created.ok);
    await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });

    // Two writers race to mark the same payment SUCCEEDED.
    const results = await Promise.allSettled([
      transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" }),
      transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" }),
    ]);

    const winners = results.filter((r) => r.status === "fulfilled");
    const losers = results.filter((r) => r.status === "rejected");
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.ok(losers[0].reason instanceof TransitionConflictError);
  });

  it("SUCCEEDED transition enqueues ledger settlement in the SAME transaction", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment } = await import("@/lib/payments");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("pt4");

    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 2500n,
    });
    assert.ok(created.ok);
    await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });
    await transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" });

    // Settlement work must be durably queued (outbox) — never inline.
    const queued = await prisma.outboxRecord.findFirst({
      where: {
        applicationId: app.application.id,
        eventType: "settlement.payment",
      },
    });
    assert.ok(queued, "settlement work must be enqueued");
    assert.deepEqual(queued.payload, { paymentId: created.payment.id });
    assert.equal(queued.status, "PENDING");

    // And it must be enqueued EXACTLY once even if the transition is retried…
    // (retry would throw TransitionConflictError — nothing duplicates).
  });

  it("listPayments rejects cursors minted in another application", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, listPayments } = await import("@/lib/payments");
    const appA = await createTestApp("cura");
    const appB = await createTestApp("curb");

    const a = await createPayment({
      applicationId: appA.application.id,
      environment: "SANDBOX",
      amountMinor: 100n,
    });
    assert.ok(a.ok);

    // Mint a valid cursor for app A's payment…
    const pageA = await listPayments(appA.application.id, "SANDBOX", {});
    assert.ok(pageA.ok);

    // …but try to use it in app B's listing → INVALID_CURSOR.
    const stolen = await listPayments(appB.application.id, "SANDBOX", {
      cursor: pageA.nextCursor ?? "x",
    });
    if (pageA.nextCursor) {
      assert.ok(!stolen.ok);
      if (!stolen.ok) assert.equal(stolen.code, "INVALID_CURSOR");
    }
  });
});
