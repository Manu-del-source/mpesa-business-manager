/**
 * INTEGRATION: refund idempotency, over-refund protection and concurrency —
 * exercising the PRODUCTION createRefund / transitionRefund
 * (src/lib/refunds.ts) against a real PostgreSQL database.
 *
 * Required scenarios: replay, conflict, concurrent duplicates, concurrent
 * partial refunds that would over-refund, refundability checks, guarded
 * transitions, provider-call non-duplication.
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
  db = await createIntegrationDb("refunds");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

/** Create a SUCCEEDED payment to refund against. */
async function succeededPayment(label: string) {
  const { createTestApp } = await import("../helpers/fixtures.js");
  const { createPayment, transitionPayment } = await import("@/lib/payments");
  const app = await createTestApp(label);
  const created = await createPayment({
    applicationId: app.application.id,
    environment: "SANDBOX",
    amountMinor: 10000n,
  });
  if (!created.ok) throw new Error("payment creation failed");
  await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });
  await transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" });
  return { app, paymentId: created.payment.id };
}

describe("Refund idempotency (production createRefund)", { skip: !!skipReason }, () => {
  it("creates a PENDING refund against a SUCCEEDED payment", async () => {
    const { createRefund } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rf1");

    const result = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 4000n,
      reason: "damaged goods",
      idempotencyKey: "rf-first",
    });
    assert.ok(result.ok);
    assert.equal(result.refund.status, "PENDING");
    assert.equal(result.refund.amountMinor, "4000");
  });

  it("exact retry replays the ORIGINAL refund", async () => {
    const { createRefund } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rf2");

    const input = {
      applicationId: app.application.id,
      environment: "SANDBOX" as const,
      paymentId,
      amountMinor: 2500n,
      reason: "partial",
      idempotencyKey: "rf-retry",
    };
    const first = await createRefund(input);
    assert.ok(first.ok);

    const retry = await createRefund(input);
    assert.ok(retry.ok);
    assert.equal(retry.replayed, true);
    assert.equal(retry.refund.id, first.refund.id);
  });

  it("same key + different payload → IDEMPOTENCY_CONFLICT", async () => {
    const { createRefund } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rf3");

    const first = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 1000n,
      idempotencyKey: "rf-conflict",
    });
    assert.ok(first.ok);

    const conflict = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 2000n, // different amount
      idempotencyKey: "rf-conflict",
    });
    assert.ok(!conflict.ok);
    assert.equal(conflict.code, "IDEMPOTENCY_CONFLICT");
  });

  it("concurrent duplicate refunds → exactly ONE refund row", async () => {
    const { createRefund } = await import("@/lib/refunds");
    const { prisma } = await import("@/lib/prisma");
    const { app, paymentId } = await succeededPayment("rf4");

    const input = {
      applicationId: app.application.id,
      environment: "SANDBOX" as const,
      paymentId,
      amountMinor: 3000n,
      idempotencyKey: "rf-concurrent",
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createRefund(input)),
    );

    assert.equal(results.filter((r) => r.ok && r.replayed !== true).length, 1);
    const ids = new Set(
      results.filter((r) => r.ok).map((r) => (r.ok ? r.refund.id : "")),
    );
    assert.equal(ids.size, 1);

    const dbCount = await prisma.refund.count({
      where: { applicationId: app.application.id, idempotencyKey: "rf-concurrent" },
    });
    assert.equal(dbCount, 1);
  });

  it("CONCURRENT partial refunds can never over-refund a payment (row lock)", async () => {
    // Payment of 10000; two concurrent refunds of 6000 each — only one can win.
    const { createRefund } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rf5");

    const results = await Promise.all([
      createRefund({
        applicationId: app.application.id,
        environment: "SANDBOX",
        paymentId,
        amountMinor: 6000n,
        reason: "r1",
        idempotencyKey: "rf-over-1",
      }),
      createRefund({
        applicationId: app.application.id,
        environment: "SANDBOX",
        paymentId,
        amountMinor: 6000n,
        reason: "r2",
        idempotencyKey: "rf-over-2",
      }),
    ]);

    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assert.equal(winners.length, 1, "exactly one 6000 refund fits");
    assert.equal(losers.length, 1);
    if (!losers[0].ok) {
      assert.equal(losers[0].code, "AMOUNT_EXCEEDS_REFUNDABLE");
    }
  });

  it("sequential refunds stop at the payment amount exactly", async () => {
    const { createRefund } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rf6");

    const first = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 6000n,
      idempotencyKey: "rf-seq-1",
    });
    assert.ok(first.ok);

    const second = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 4000n,
      idempotencyKey: "rf-seq-2",
    });
    assert.ok(second.ok);

    const third = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 1n,
      idempotencyKey: "rf-seq-3",
    });
    assert.ok(!third.ok);
    if (!third.ok) assert.equal(third.code, "AMOUNT_EXCEEDS_REFUNDABLE");
  });

  it("only SUCCEEDED payments are refundable", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment } = await import("@/lib/payments");
    const { createRefund } = await import("@/lib/refunds");
    const app = await createTestApp("rf7");

    const pending = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
    });
    assert.ok(pending.ok);

    const result = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId: pending.payment.id,
      amountMinor: 100n,
      idempotencyKey: "rf-pending",
    });
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.code, "NOT_REFUNDABLE");
  });

  it("payments of ANOTHER application cannot be refunded (IDOR)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createRefund } = await import("@/lib/refunds");
    const { paymentId } = await succeededPayment("rf8a");
    const other = await createTestApp("rf8b");

    const result = await createRefund({
      applicationId: other.application.id, // different app
      environment: "SANDBOX",
      paymentId, // …refunding app A's payment
      amountMinor: 100n,
      idempotencyKey: "rf-idor",
    });
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  it("refundability errors are cached under the key (deterministic replay)", async () => {
    const { createRefund } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rf9");

    // Refund the full amount.
    const full = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 10000n,
      idempotencyKey: "rf-cache",
    });
    assert.ok(full.ok);

    // A second refund with the same key replays the ORIGINAL success…
    const replay = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 10000n,
      idempotencyKey: "rf-cache",
    });
    assert.ok(replay.ok && replay.replayed === true);

    // …and a new key trying to over-refund deterministically fails.
    const over = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 1n,
      idempotencyKey: "rf-cache-2",
    });
    assert.ok(!over.ok);
    if (!over.ok) assert.equal(over.code, "AMOUNT_EXCEEDS_REFUNDABLE");

    // Replaying the over-refund key replays the cached error (same code).
    const overReplay = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 1n,
      idempotencyKey: "rf-cache-2",
    });
    assert.ok(!overReplay.ok);
    if (!overReplay.ok) assert.equal(overReplay.code, "AMOUNT_EXCEEDS_REFUNDABLE");
  });
});

describe("Refund state machine (production transitionRefund)", { skip: !!skipReason }, () => {
  it("happy path: PENDING → PROCESSING → SUCCEEDED; terminal afterwards", async () => {
    const { createRefund, transitionRefund, InvalidTransitionError } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rft1");

    const created = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 1000n,
      idempotencyKey: "rft-1",
    });
    assert.ok(created.ok);

    const processing = await transitionRefund(created.refund.id, "PROCESSING");
    assert.ok(processing);
    const succeeded = await transitionRefund(created.refund.id, "SUCCEEDED");
    assert.ok(succeeded);
    assert.equal(succeeded.status, "SUCCEEDED");

    // A completed refund can never be refunded/re-run again.
    await assert.rejects(transitionRefund(created.refund.id, "PROCESSING"), InvalidTransitionError);
    await assert.rejects(transitionRefund(created.refund.id, "SUCCEEDED"), InvalidTransitionError);
  });

  it("provider failure: PROCESSING → FAILED records the error, terminal", async () => {
    const { createRefund, transitionRefund, InvalidTransitionError } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rft2");

    const created = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 500n,
      idempotencyKey: "rft-2",
    });
    assert.ok(created.ok);
    await transitionRefund(created.refund.id, "PROCESSING");

    const failed = await transitionRefund(created.refund.id, "FAILED", {
      errorCode: "DARAJA_REVERSAL_FAILED",
      errorMessage: "Reversal request rejected by provider",
    });
    assert.ok(failed);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.errorCode, "DARAJA_REVERSAL_FAILED");

    await assert.rejects(transitionRefund(created.refund.id, "SUCCEEDED"), InvalidTransitionError);
  });

  it("concurrent terminal transitions: exactly one wins", async () => {
    const { createRefund, transitionRefund, TransitionConflictError } = await import("@/lib/refunds");
    const { app, paymentId } = await succeededPayment("rft3");

    const created = await createRefund({
      applicationId: app.application.id,
      environment: "SANDBOX",
      paymentId,
      amountMinor: 100n,
      idempotencyKey: "rft-3",
    });
    assert.ok(created.ok);
    await transitionRefund(created.refund.id, "PROCESSING");

    const results = await Promise.allSettled([
      transitionRefund(created.refund.id, "SUCCEEDED"),
      transitionRefund(created.refund.id, "FAILED", { errorCode: "X" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const loser = results.find((r) => r.status === "rejected");
    assert.ok(loser?.reason instanceof TransitionConflictError);
  });
});
