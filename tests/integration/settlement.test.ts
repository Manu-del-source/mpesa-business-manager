/**
 * INTEGRATION: retryable, idempotent settlement — the financial heart of the
 * platform. Exercises the PRODUCTION outbox worker (src/lib/events.ts),
 * ledger settlement (src/lib/settlement.ts) and the real M-Pesa callback
 * applier (src/lib/mpesa/callback.ts) against a real PostgreSQL database.
 *
 * THE REQUIRED SCENARIO (both settlement paths):
 *   1. successful M-Pesa callback / payment success
 *   2. settlement processing FAILS (forced via realistic data faults)
 *   3. the failure is RETRYABLE — work stays queued with backoff, nothing
 *      half-applied (sale stays PENDING / no journal exists)
 *   4. retry after the fault is fixed → SUCCESS
 *   5. exactly ONE financial posting — a replayed callback or re-run worker
 *      can never double-post or double-decrement stock
 *
 * Outbox mechanics covered along the way: PENDING → PROCESSING → DISPATCHED,
 * exponential backoff via the real markFailed, terminal FAILED after
 * maxAttempts, nextRetryAt deferral of claims.
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
  db = await createIntegrationDb("settlement");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

/** The settlement accounts auto-provisioned per application+environment. */
const FLOAT_CODE = "MPESA-FLOAT";
const REVENUE_CODE = "SETTLEMENT";


/**
 * Provision the settlement accounts for an app (via the PRODUCTION
 * ensureSettlementAccountsTx used by settlePaymentToLedger) so tests can
 * deactivate/reactivate them deterministically.
 */
async function ensureSettlementAccounts(applicationId: string) {
  const { prisma } = await import("@/lib/prisma");
  for (const code of [FLOAT_CODE, REVENUE_CODE]) {
    await prisma.account.upsert({
      where: { applicationId_environment_code: { applicationId, environment: "SANDBOX", code } },
      create: { applicationId, environment: "SANDBOX", code, name: code, type: code === FLOAT_CODE ? "ASSET" : "REVENUE", currency: "KES" },
      update: {},
    });
  }
}

describe("Payment settlement (retryable outbox worker → double-entry ledger)", { skip: !!skipReason }, () => {
  it("1. SUCCEEDED payment settles to exactly ONE balanced journal", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment } = await import("@/lib/payments");
    const { processPendingSettlements, paymentSettlementReference } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("set1");

    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 2500n,
    });
    assert.ok(created.ok);
    await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });
    await transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" });

    const result = await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    assert.equal(result.failed, 0);
    assert.ok(result.succeeded >= 1);

    // Exactly ONE journal for this payment, under the deterministic reference.
    const reference = paymentSettlementReference(created.payment.id);
    const journals = await prisma.journalTransaction.findMany({
      where: { applicationId: app.application.id, reference },
      include: { entries: true },
    });
    assert.equal(journals.length, 1);
    const journal = journals[0];
    assert.equal(journal.entries.length, 2);

    // Balanced: float DEBIT, revenue CREDIT, same minor amount as the payment.
    const float = await prisma.account.findUniqueOrThrow({
      where: {
        applicationId_environment_code: {
          applicationId: app.application.id,
          environment: "SANDBOX",
          code: FLOAT_CODE,
        },
      },
    });
    const revenue = await prisma.account.findUniqueOrThrow({
      where: {
        applicationId_environment_code: {
          applicationId: app.application.id,
          environment: "SANDBOX",
          code: REVENUE_CODE,
        },
      },
    });
    const debits = journal.entries.filter((e) => e.type === "DEBIT");
    const credits = journal.entries.filter((e) => e.type === "CREDIT");
    assert.equal(debits.length, 1);
    assert.equal(credits.length, 1);
    assert.equal(debits[0].accountId, float.id);
    assert.equal(credits[0].accountId, revenue.id);
    assert.equal(debits[0].amountMinor, 2500n);
    assert.equal(credits[0].amountMinor, 2500n);

    // The whole ledger balances.
    const { verifyLedgerBalance, getAccountBalance } = await import("@/lib/ledger");
    const check = await verifyLedgerBalance(app.application.id, "SANDBOX");
    assert.ok(check.balanced);
    const floatBalance = await getAccountBalance(float.id);
    assert.ok(floatBalance);
    assert.equal(floatBalance.balanceMinor, 2500n);

    // Outbox record dispatched.
    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { applicationId: app.application.id, eventType: "settlement.payment" },
    });
    assert.equal(record.status, "DISPATCHED");
  });

  it("2. forced failure (inactive float account) is RETRYABLE — no journal, payment intact", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment } = await import("@/lib/payments");
    const { processPendingSettlements } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("set2");

    // First settle once so the accounts exist, then deactivate the float.
    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
    });
    assert.ok(created.ok);
    await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });
    await transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" });
    await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    await prisma.account.update({
      where: {
        applicationId_environment_code: {
          applicationId: app.application.id,
          environment: "SANDBOX",
          code: FLOAT_CODE,
        },
      },
      data: { active: false },
    });

    // A SECOND payment now cannot settle — the failure must be retryable.
    const second = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 700n,
    });
    assert.ok(second.ok);
    await transitionPayment(second.payment.id, "PROCESSING", { provider: "daraja" });
    await transitionPayment(second.payment.id, "SUCCEEDED", { provider: "daraja" });

    const result = await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    assert.ok(result.failed >= 1, "settlement must fail while the float account is inactive");
    assert.equal(result.permanentlyFailed, 0, "first failure must be retryable, not terminal");

    // NOTHING was posted for the second payment.
    const journals = await prisma.journalTransaction.count({
      where: {
        applicationId: app.application.id,
        reference: { contains: second.payment.id },
      },
    });
    assert.equal(journals, 0);

    // The payment itself is untouched and the work is durably queued.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: second.payment.id } });
    assert.equal(payment.status, "SUCCEEDED");

    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { applicationId: app.application.id, payload: { equals: { paymentId: second.payment.id } } as never },
    });
    assert.equal(record.status, "PENDING");
    assert.equal(record.attempts, 1);
    assert.match(record.lastError ?? "", /inactive/i);
    assert.ok(record.nextRetryAt && record.nextRetryAt.getTime() > Date.now(), "retry must be scheduled in the future");

    // An immediate re-run defers to the backoff schedule — nothing claimed.
    const immediate = await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    assert.equal(immediate.claimed, 0, "must not claim a record whose nextRetryAt is in the future");
  });

  it("3. retry after the fault is fixed → success, exactly ONE journal (idempotent)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment } = await import("@/lib/payments");
    const { processPendingSettlements, settlePaymentToLedger, paymentSettlementReference } =
      await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("set3");
    await ensureSettlementAccounts(app.application.id);

    // Force the failure first (inactive float account).
    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 3300n,
    });
    assert.ok(created.ok);
    await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });
    await transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" });
    await prisma.account.update({
      where: {
        applicationId_environment_code: {
          applicationId: app.application.id,
          environment: "SANDBOX",
          code: FLOAT_CODE,
        },
      },
      data: { active: false },
    });
    const failedRun = await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    assert.ok(failedRun.failed >= 1);

    // FIX the fault and let the retry run now (clear the backoff timer).
    await prisma.account.update({
      where: {
        applicationId_environment_code: {
          applicationId: app.application.id,
          environment: "SANDBOX",
          code: FLOAT_CODE,
        },
      },
      data: { active: true },
    });
    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { applicationId: app.application.id, payload: { equals: { paymentId: created.payment.id } } as never },
    });
    await prisma.outboxRecord.update({ where: { id: record.id }, data: { nextRetryAt: null } });

    const retried = await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    assert.equal(retried.failed, 0);
    assert.ok(retried.succeeded >= 1);

    // Exactly ONE journal — the failed attempt posted nothing.
    const reference = paymentSettlementReference(created.payment.id);
    const count = await prisma.journalTransaction.count({
      where: { applicationId: app.application.id, reference },
    });
    assert.equal(count, 1);

    // Re-running the settlement DIRECTLY (e.g. a manual reconciliation sweep)
    // recognizes the existing posting instead of doubling it.
    const again = await settlePaymentToLedger(created.payment.id);
    assert.equal(again.posted, false);
    if (!again.posted) assert.equal(again.reason, "already_settled");

    const countAfter = await prisma.journalTransaction.count({
      where: { applicationId: app.application.id, reference },
    });
    assert.equal(countAfter, 1, "re-run must not add a second journal");

    // And the worker no longer claims the dispatched record.
    const idle = await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    assert.equal(idle.claimed, 0);
  });

  it("4. exponential backoff schedule via the real markFailed (1s→2s→4s…)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment } = await import("@/lib/payments");
    const { processPendingSettlements } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("set4");
    await ensureSettlementAccounts(app.application.id);

    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 500n,
    });
    assert.ok(created.ok);
    await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });
    await transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" });
    await prisma.account.update({
      where: {
        applicationId_environment_code: {
          applicationId: app.application.id,
          environment: "SANDBOX",
          code: FLOAT_CODE,
        },
      },
      data: { active: false },
    });

    // Failure #1 → attempts 1 → backoff 1000 * 2^1 = 2s.
    await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    let record = await prisma.outboxRecord.findFirstOrThrow({
      where: { applicationId: app.application.id, payload: { equals: { paymentId: created.payment.id } } as never },
    });
    assert.equal(record.attempts, 1);
    const delay1 = record.nextRetryAt!.getTime() - Date.now();
    assert.ok(delay1 > 500 && delay1 < 3500, `first backoff ~2s, got ${delay1}ms`);

    // Failure #2 → attempts 2 → backoff 1000 * 2^2 = 4s (strictly larger).
    await prisma.outboxRecord.update({ where: { id: record.id }, data: { nextRetryAt: null } });
    await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    record = await prisma.outboxRecord.findFirstOrThrow({ where: { id: record.id } });
    assert.equal(record.attempts, 2);
    const delay2 = record.nextRetryAt!.getTime() - Date.now();
    assert.ok(delay2 > 2500 && delay2 < 5500, `second backoff ~4s, got ${delay2}ms`);
    assert.ok(delay2 > delay1, "backoff must grow exponentially");
  });

  it("5. permanent failure after maxAttempts → terminal FAILED (no silent retry)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, transitionPayment } = await import("@/lib/payments");
    const { processPendingSettlements } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("set5");
    await ensureSettlementAccounts(app.application.id);

    const created = await createPayment({
      applicationId: app.application.id,
      environment: "SANDBOX",
      amountMinor: 900n,
    });
    assert.ok(created.ok);
    await transitionPayment(created.payment.id, "PROCESSING", { provider: "daraja" });
    await transitionPayment(created.payment.id, "SUCCEEDED", { provider: "daraja" });
    await prisma.account.update({
      where: {
        applicationId_environment_code: {
          applicationId: app.application.id,
          environment: "SANDBOX",
          code: FLOAT_CODE,
        },
      },
      data: { active: false },
    });

    // Fast-forward: simulate four earlier failed attempts.
    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { applicationId: app.application.id, payload: { equals: { paymentId: created.payment.id } } as never },
    });
    await prisma.outboxRecord.update({
      where: { id: record.id },
      data: { attempts: 4, nextRetryAt: null },
    });

    // Fifth failure exhausts maxAttempts (default 5) → terminal FAILED.
    const result = await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    assert.ok(result.failed >= 1);
    assert.ok(result.permanentlyFailed >= 1);

    const terminal = await prisma.outboxRecord.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(terminal.status, "FAILED");
    assert.equal(terminal.attempts, 5);
    assert.equal(terminal.nextRetryAt, null, "terminal failure must not schedule further retries");
    assert.match(terminal.lastError ?? "", /inactive/i);

    // Even after the fault is fixed, the FAILED record is NOT retried
    // automatically — it requires manual reconciliation.
    await prisma.account.update({
      where: {
        applicationId_environment_code: {
          applicationId: app.application.id,
          environment: "SANDBOX",
          code: FLOAT_CODE,
        },
      },
      data: { active: true },
    });
    const after = await processPendingSettlements({ limit: 10, applicationId: app.application.id, environment: "SANDBOX" });
    assert.equal(after.claimed, 0, "FAILED records must not be auto-claimed");
  });
});

describe("Legacy POS sale settlement (real applyStkCallback → outbox → stock)", { skip: !!skipReason }, () => {
  /**
   * Fixture: org A (the seller) with its own product, org B with a FOREIGN
   * product, and a PENDING MPESA sale in org A whose (single) line item
   * references org B's product. The cross-org reference is a realistic
   * data-integrity fault that must FAIL settlement — never silently
   * decrement another organization's stock.
   */
  async function fixture(label: string) {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { prisma } = await import("@/lib/prisma");
    const appA = await createTestApp(label + "a");
    const appB = await createTestApp(label + "b");

    const productA = await prisma.product.create({
      data: {
        organizationId: appA.orgId,
        name: "Own product",
        costPrice: "10.00",
        sellingPrice: "15.00",
        stock: 10,
      },
      select: { id: true },
    });
    const productB = await prisma.product.create({
      data: {
        organizationId: appB.orgId,
        name: "Foreign product",
        costPrice: "10.00",
        sellingPrice: "15.00",
        stock: 10,
      },
      select: { id: true },
    });

    const receiptNo = `R-${label}-${Date.now()}`;
    const sale = await prisma.sale.create({
      data: {
        organizationId: appA.orgId,
        receiptNo,
        status: "PENDING",
        paymentMethod: "MPESA",
        subtotal: "30.00",
        total: "30.00",
        items: {
          create: {
            productId: productB.id, // the fault: foreign organization
            productName: "Foreign product",
            quantity: 2,
            unitPrice: "15.00",
            lineTotal: "30.00",
          },
        },
      },
      include: { items: true },
    });

    const checkoutRequestId = `ws_CO-${label}-${Date.now()}`;
    await prisma.mpesaTransaction.create({
      data: {
        organizationId: appA.orgId,
        direction: "INCOMING",
        phone: "254712345678",
        amount: "30.00",
        status: "PENDING",
        reference: receiptNo,
        checkoutRequestId,
        transactionType: "STK_PUSH",
      },
    });

    return { appA, appB, productA, productB, sale, receiptNo, checkoutRequestId };
  }

  function successPayload(checkoutRequestId: string) {
    return {
      merchantRequestId: "29115-34620561-1",
      checkoutRequestId,
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
      amount: 30,
      receiptNumber: "SFL7XXXXXXXX",
      phone: "254712345678",
      transactionDate: new Date("2024-06-01T07:21:15Z"),
    };
  }

  it("6. successful callback applies the transaction result AND enqueues settlement durably", async () => {
    const { applyStkCallback } = await import("@/lib/mpesa/callback");
    const { prisma } = await import("@/lib/prisma");
    const fx = await fixture("cb6");

    const outcome = await applyStkCallback(successPayload(fx.checkoutRequestId));
    assert.equal(outcome.outcome, "applied");

    const tx = await prisma.mpesaTransaction.findFirstOrThrow({
      where: { checkoutRequestId: fx.checkoutRequestId },
    });
    assert.equal(tx.status, "SUCCESS");
    assert.equal(tx.receiptNo, "SFL7XXXXXXXX");
    assert.ok(tx.completedAt);

    // The settlement work for the linked sale is queued in the same tx.
    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { eventType: "settlement.mpesa_sale", applicationId: fx.appA.application.id },
    });
    assert.equal(record.status, "PENDING");
    const payload = record.payload as Record<string, unknown>;
    assert.equal(payload.receiptNo, fx.receiptNo);
    assert.equal(payload.organizationId, fx.appA.orgId);
    assert.equal(payload.status, "SUCCESS");
    assert.equal(payload.transactionId, tx.id);
  });

  it("7. forced settlement failure (cross-org product) rolls back EVERYTHING and stays retryable", async () => {
    const { applyStkCallback } = await import("@/lib/mpesa/callback");
    const { processPendingSettlements } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const fx = await fixture("cb7");
    await applyStkCallback(successPayload(fx.checkoutRequestId));

    const result = await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" });
    assert.ok(result.failed >= 1, "settlement must fail on a cross-organization product");
    assert.equal(result.permanentlyFailed, 0);

    // The whole settlement transaction rolled back — nothing half-applied.
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: fx.sale.id } });
    assert.equal(sale.status, "PENDING", "a failed settlement must leave the sale PENDING");
    assert.equal(sale.mpesaReference, null);

    const stockA = await prisma.product.findUniqueOrThrow({ where: { id: fx.productA.id } });
    const stockB = await prisma.product.findUniqueOrThrow({ where: { id: fx.productB.id } });
    assert.equal(stockA.stock, 10);
    assert.equal(stockB.stock, 10, "the foreign organization's stock must never be touched");

    // The transaction result itself is durable — the callback is done; only
    // the settlement is pending retry.
    const tx = await prisma.mpesaTransaction.findFirstOrThrow({
      where: { checkoutRequestId: fx.checkoutRequestId },
    });
    assert.equal(tx.status, "SUCCESS");

    // The work is queued for retry with the failure recorded.
    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { eventType: "settlement.mpesa_sale", applicationId: fx.appA.application.id },
    });
    assert.equal(record.status, "PENDING");
    assert.equal(record.attempts, 1);
    assert.match(record.lastError ?? "", /belong/i);
    assert.ok(record.nextRetryAt && record.nextRetryAt.getTime() > Date.now());

    // Backoff defers an immediate retry.
    const immediate = await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" });
    assert.equal(immediate.claimed, 0);
  });

  it("8. retry after the fault is fixed → sale COMPLETED, stock decremented EXACTLY once", async () => {
    const { applyStkCallback } = await import("@/lib/mpesa/callback");
    const { processPendingSettlements } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const fx = await fixture("cb8");
    await applyStkCallback(successPayload(fx.checkoutRequestId));
    await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" }); // fails (cross-org)

    // FIX the data fault: point the line item at the seller's own product.
    await prisma.saleItem.updateMany({
      where: { saleId: fx.sale.id },
      data: { productId: fx.productA.id },
    });
    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { eventType: "settlement.mpesa_sale", applicationId: fx.appA.application.id },
    });
    await prisma.outboxRecord.update({ where: { id: record.id }, data: { nextRetryAt: null } });

    const retried = await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" });
    assert.equal(retried.failed, 0);
    assert.ok(retried.succeeded >= 1);

    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: fx.sale.id } });
    assert.equal(sale.status, "COMPLETED");
    assert.equal(sale.mpesaReference, "SFL7XXXXXXXX");

    const stockA = await prisma.product.findUniqueOrThrow({ where: { id: fx.productA.id } });
    assert.equal(stockA.stock, 8, "quantity 2 decremented exactly once");

    const done = await prisma.outboxRecord.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(done.status, "DISPATCHED");
  });

  it("9. replayed callback is a DUPLICATE — no re-enqueue, no double decrement", async () => {
    const { applyStkCallback } = await import("@/lib/mpesa/callback");
    const { processPendingSettlements } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const fx = await fixture("cb9");
    await applyStkCallback(successPayload(fx.checkoutRequestId));
    await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" }); // fails
    await prisma.saleItem.updateMany({ where: { saleId: fx.sale.id }, data: { productId: fx.productA.id } });
    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { eventType: "settlement.mpesa_sale", applicationId: fx.appA.application.id },
    });
    await prisma.outboxRecord.update({ where: { id: record.id }, data: { nextRetryAt: null } });
    await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" }); // succeeds

    // Safaricom retries the callback — must be a no-op duplicate.
    const replay = await applyStkCallback(successPayload(fx.checkoutRequestId));
    assert.equal(replay.outcome, "duplicate");

    const outboxCount = await prisma.outboxRecord.count({
      where: { eventType: "settlement.mpesa_sale", applicationId: fx.appA.application.id },
    });
    assert.equal(outboxCount, 1, "a replayed callback must not enqueue new settlement work");

    const stockA = await prisma.product.findUniqueOrThrow({ where: { id: fx.productA.id } });
    assert.equal(stockA.stock, 8, "stock still decremented exactly once");
  });

  it("10. worker re-run after completion is a no-op (no_pending_sale)", async () => {
    const { applyStkCallback } = await import("@/lib/mpesa/callback");
    const { processPendingSettlements, settleLinkedSale } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const fx = await fixture("cb10");
    await applyStkCallback(successPayload(fx.checkoutRequestId));
    await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" }); // fails
    await prisma.saleItem.updateMany({ where: { saleId: fx.sale.id }, data: { productId: fx.productA.id } });
    const record = await prisma.outboxRecord.findFirstOrThrow({
      where: { eventType: "settlement.mpesa_sale", applicationId: fx.appA.application.id },
    });
    await prisma.outboxRecord.update({ where: { id: record.id }, data: { nextRetryAt: null } });
    await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" }); // succeeds

    // Nothing left to claim…
    const idle = await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" });
    assert.equal(idle.claimed, 0);

    // …and a direct settlement attempt finds no pending sale.
    const direct = await settleLinkedSale({
      organizationId: fx.appA.orgId,
      receiptNo: fx.receiptNo,
      status: "SUCCESS",
      mpesaReceipt: "SFL7XXXXXXXX",
      transactionId: "tx",
    });
    assert.equal(direct.settled, false);
    if (!direct.settled) assert.equal(direct.reason, "no_pending_sale");

    const stockA = await prisma.product.findUniqueOrThrow({ where: { id: fx.productA.id } });
    assert.equal(stockA.stock, 8, "stock unchanged by the no-op");
  });

  it("11. cancelled callback cancels the pending sale without touching stock", async () => {
    const { applyStkCallback } = await import("@/lib/mpesa/callback");
    const { processPendingSettlements } = await import("@/lib/settlement");
    const { prisma } = await import("@/lib/prisma");
    const fx = await fixture("cb11");

    // 1032 = cancelled by the user.
    const outcome = await applyStkCallback({
      merchantRequestId: "29115-34620561-1",
      checkoutRequestId: fx.checkoutRequestId,
      resultCode: 1032,
      resultDesc: "Request cancelled by user",
      amount: null,
      receiptNumber: null,
      phone: "254712345678",
      transactionDate: new Date("2024-06-01T07:21:15Z"),
    });
    assert.equal(outcome.outcome, "applied");

    const tx = await prisma.mpesaTransaction.findFirstOrThrow({
      where: { checkoutRequestId: fx.checkoutRequestId },
    });
    assert.equal(tx.status, "CANCELLED");

    await processPendingSettlements({ limit: 10, applicationId: fx.appA.application.id, environment: "SANDBOX" });
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: fx.sale.id } });
    assert.equal(sale.status, "CANCELLED");

    const stockB = await prisma.product.findUniqueOrThrow({ where: { id: fx.productB.id } });
    assert.equal(stockB.stock, 10, "no stock movement for a cancelled payment");
  });

  it("12. callback for an unknown checkoutRequestId → unknown_transaction, nothing written", async () => {
    const { applyStkCallback } = await import("@/lib/mpesa/callback");
    const { prisma } = await import("@/lib/prisma");
    const before = await prisma.outboxRecord.count();
    const beforeTx = await prisma.mpesaTransaction.count();

    const outcome = await applyStkCallback(successPayload("ws_CO-NOT-A-REAL-REQUEST"));
    assert.equal(outcome.outcome, "unknown_transaction");

    assert.equal(await prisma.outboxRecord.count(), before);
    assert.equal(await prisma.mpesaTransaction.count(), beforeTx);
  });
});
