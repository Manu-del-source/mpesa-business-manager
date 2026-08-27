import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Prisma as PrismaNamespace } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  claimDueOutboxRecords,
  markDispatched,
  markFailed,
} from "@/lib/events";
import { logMpesa, logMpesaError } from "@/lib/mpesa/log";
import type { Environment, MpesaStatus } from "@/generated/prisma/client";

/**
 * Durable, idempotent, retryable settlement.
 *
 * THE INVARIANT THIS MODULE ENFORCES:
 *
 *   A successful provider callback (or reconciliation result) persists the
 *   provider outcome IMMEDIATELY, but never performs financial settlement
 *   inline-and-irreversibly. Settlement work is enqueued as an outbox record
 *   in the SAME database transaction as the provider-result write, then
 *   executed by a worker (invoked inline on a best-effort basis AND via the
 *   reconciliation sweep / cron).
 *
 *   - If settlement succeeds → the outbox record is DISPATCHED.
 *   - If settlement fails   → the outbox record stays PENDING with a retry
 *     timestamp (exponential backoff, maxAttempts → FAILED for manual
 *     investigation). Nothing is ever "marked complete" while its financial
 *     effects are missing.
 *   - Every settlement operation is IDEMPOTENT: a retry (or a concurrent
 *     worker) can never double-post the ledger or double-decrement stock —
 *     each operation is a guarded conditional update keyed on the previous
 *     state, or a journal whose reference is unique to the payment.
 *
 * Event types:
 *   settlement.payment     — post an infrastructure Payment to the ledger.
 *   settlement.mpesa_sale  — settle a legacy POS sale linked to an M-Pesa
 *                            transaction (complete the sale, decrement stock).
 */

// ---------------------------------------------------------------------------
// Event types & payload shapes
// ---------------------------------------------------------------------------

export const SETTLEMENT_EVENT_TYPES = {
  payment: "settlement.payment",
  mpesaSale: "settlement.mpesa_sale",
} as const;

type Tx = PrismaNamespace.TransactionClient;

export type PaymentSettlementPayload = {
  paymentId: string;
};

export type SaleSettlementPayload = {
  organizationId: string;
  /** Sale receipt number the M-Pesa transaction was created for. */
  receiptNo: string;
  status: MpesaStatus;
  mpesaReceipt: string | null;
  transactionId: string;
};

// ---------------------------------------------------------------------------
// Enqueue helpers (call INSIDE the transaction that persists the provider
// result, so the work can never be lost)
// ---------------------------------------------------------------------------

/** Enqueue ledger settlement for a payment that just reached SUCCEEDED. */
export function enqueuePaymentSettlementTx(
  tx: Tx,
  payment: { id: string; applicationId: string; environment: Environment },
): Promise<unknown> {
  const payload: PaymentSettlementPayload = { paymentId: payment.id };
  return tx.outboxRecord.create({
    data: {
      applicationId: payment.applicationId,
      environment: payment.environment,
      eventType: SETTLEMENT_EVENT_TYPES.payment,
      payload: payload as unknown as Prisma.InputJsonValue,
      status: "PENDING",
      nextRetryAt: new Date(),
    },
  });
}

/** Enqueue legacy POS sale settlement (called from the M-Pesa callback). */
export function enqueueSaleSettlementTx(
  tx: Tx,
  applicationId: string,
  payload: SaleSettlementPayload,
): Promise<unknown> {
  return tx.outboxRecord.create({
    data: {
      applicationId,
      // The legacy POS flow predates platform environments; it settles via
      // the org's default (SANDBOX) application context.
      environment: "SANDBOX",
      eventType: SETTLEMENT_EVENT_TYPES.mpesaSale,
      payload: payload as unknown as Prisma.InputJsonValue,
      status: "PENDING",
      nextRetryAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Payment → ledger settlement (idempotent)
// ---------------------------------------------------------------------------

/** Chart-of-accounts codes used by the automatic settlement posting. */
export const SETTLEMENT_ACCOUNTS = {
  float: { code: "MPESA-FLOAT", name: "M-Pesa Settlement Float", type: "ASSET" as const },
  revenue: { code: "SETTLEMENT", name: "Payment Settlement Revenue", type: "REVENUE" as const },
};

/** Journal reference uniquely identifying a payment's settlement posting. */
export function paymentSettlementReference(paymentId: string): string {
  return `payment-settlement:${paymentId}`;
}

async function ensureSettlementAccountsTx(
  tx: Tx,
  applicationId: string,
  environment: Environment,
): Promise<{ floatId: string; revenueId: string }> {
  const [float, revenue] = await Promise.all([
    tx.account.upsert({
      where: {
        applicationId_environment_code: {
          applicationId,
          environment,
          code: SETTLEMENT_ACCOUNTS.float.code,
        },
      },
      create: {
        applicationId,
        environment,
        code: SETTLEMENT_ACCOUNTS.float.code,
        name: SETTLEMENT_ACCOUNTS.float.name,
        type: SETTLEMENT_ACCOUNTS.float.type,
        currency: "KES",
        description: "Auto-provisioned: provider settlement float",
      },
      update: {},
      select: { id: true },
    }),
    tx.account.upsert({
      where: {
        applicationId_environment_code: {
          applicationId,
          environment,
          code: SETTLEMENT_ACCOUNTS.revenue.code,
        },
      },
      create: {
        applicationId,
        environment,
        code: SETTLEMENT_ACCOUNTS.revenue.code,
        name: SETTLEMENT_ACCOUNTS.revenue.name,
        type: SETTLEMENT_ACCOUNTS.revenue.type,
        currency: "KES",
        description: "Auto-provisioned: revenue recognized on settlement",
      },
      update: {},
      select: { id: true },
    }),
  ]);
  return { floatId: float.id, revenueId: revenue.id };
}

export type PaymentSettlementResult =
  | { posted: true; journalId: string }
  | { posted: false; journalId: string; reason: "already_settled" };

/**
 * Post a SUCCEEDED payment to the double-entry ledger.
 *
 * IDEMPOTENT BY CONSTRUCTION:
 *   1. The payment row is locked (SELECT … FOR UPDATE), serializing all
 *      settlement attempts for that payment.
 *   2. A journal whose reference is `payment-settlement:<paymentId>` is
 *      searched first — an existing journal means this payment was already
 *      settled, and the call returns it instead of posting again.
 *   3. The journal and its two balanced entries are created in one
 *      transaction, so a crash can never leave a half-posted settlement.
 *
 * Posting: debit the M-Pesa settlement float (asset in), credit settlement
 * revenue — balanced in the payment's minor-unit amount, in the payment's
 * currency. The float account is KES; a non-KES payment is rejected loudly
 * (retryable failure) rather than posted in the wrong currency.
 */
export async function settlePaymentToLedger(
  paymentId: string,
): Promise<PaymentSettlementResult> {
  return prisma.$transaction(async (tx) => {
    // Serialize concurrent settlement attempts for this payment.
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;

    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      throw new Error(`Cannot settle payment ${paymentId}: not found.`);
    }
    if (payment.status !== "SUCCEEDED") {
      throw new Error(
        `Cannot settle payment ${paymentId}: status is ${payment.status}, ` +
          "only SUCCEEDED payments settle to the ledger.",
      );
    }
    if (payment.currency !== "KES") {
      // Retryable-looking but deterministic: surface clearly for operations.
      throw new Error(
        `Cannot settle payment ${paymentId}: currency ${payment.currency} is ` +
          "not supported by the automatic settlement accounts (KES only).",
      );
    }

    // Idempotency check — the reference is unique to this payment.
    const reference = paymentSettlementReference(paymentId);
    const existing = await tx.journalTransaction.findFirst({
      where: { applicationId: payment.applicationId, reference },
      select: { id: true },
    });
    if (existing) {
      return { posted: false, journalId: existing.id, reason: "already_settled" as const };
    }

    const { floatId, revenueId } = await ensureSettlementAccountsTx(
      tx,
      payment.applicationId,
      payment.environment,
    );

    // An inactive settlement account is a retryable configuration error —
    // posting onto a deactivated account would hide its balance from
    // reporting.
    const [floatAccount, revenueAccount] = await Promise.all([
      tx.account.findUnique({ where: { id: floatId }, select: { active: true } }),
      tx.account.findUnique({ where: { id: revenueId }, select: { active: true } }),
    ]);
    if (!floatAccount?.active || !revenueAccount?.active) {
      throw new Error(
        `Cannot settle payment ${paymentId}: a settlement account is inactive ` +
          `(${SETTLEMENT_ACCOUNTS.float.code}/${SETTLEMENT_ACCOUNTS.revenue.code}).`,
      );
    }

    const journal = await tx.journalTransaction.create({
      data: {
        applicationId: payment.applicationId,
        environment: payment.environment,
        description: `Settlement of payment ${payment.id}`,
        reference,
      },
    });

    await tx.ledgerEntry.createMany({
      data: [
        {
          journalTransactionId: journal.id,
          accountId: floatId,
          type: "DEBIT",
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          description: `M-Pesa collection ${payment.id}`,
        },
        {
          journalTransactionId: journal.id,
          accountId: revenueId,
          type: "CREDIT",
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          description: `Revenue for payment ${payment.id}`,
        },
      ],
    });

    // Audit event in the same transaction.
    await tx.event.create({
      data: {
        applicationId: payment.applicationId,
        environment: payment.environment,
        type: "payment.settled",
        aggregateType: "Payment",
        aggregateId: payment.id,
        payload: {
          paymentId: payment.id,
          journalId: journal.id,
          amountMinor: payment.amountMinor.toString(),
          currency: payment.currency,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { posted: true, journalId: journal.id };
  });
}

// ---------------------------------------------------------------------------
// Legacy POS sale settlement (idempotent)
// ---------------------------------------------------------------------------

export type SaleSettlementResult =
  | { settled: true; saleId: string }
  | { settled: false; reason: "no_pending_sale" };

/**
 * Reflect an M-Pesa outcome on its linked POS sale.
 *
 * IDEMPOTENT: the sale is flipped out of PENDING with a guarded conditional
 * update (`WHERE status = 'PENDING'`), and stock is decremented ONLY inside
 * the transaction that won that flip — a retry, a concurrent worker, or a
 * replayed callback can never complete the sale twice or double-decrement
 * stock. A missing product row fails the whole transaction (rollback) so the
 * outbox retry re-attempts with complete data instead of silently skipping.
 */
export async function settleLinkedSale(
  payload: SaleSettlementPayload,
): Promise<SaleSettlementResult> {
  const sale = await prisma.sale.findFirst({
    where: {
      organizationId: payload.organizationId,
      receiptNo: payload.receiptNo,
      status: "PENDING",
      paymentMethod: "MPESA",
    },
    include: { items: true },
  });
  if (!sale) return { settled: false, reason: "no_pending_sale" };

  if (payload.status !== "SUCCESS") {
    // Payment did not succeed — cancel the pending sale (guarded).
    const cancelled = await prisma.sale.updateMany({
      where: { id: sale.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (cancelled.count > 0) {
      logMpesa("settlement.sale_cancelled", { saleId: sale.id, status: payload.status });
    }
    return { settled: true, saleId: sale.id };
  }

  await prisma.$transaction(async (tx) => {
    // Guarded flip: exactly one settlement wins.
    const flipped = await tx.sale.updateMany({
      where: { id: sale.id, status: "PENDING" },
      data: {
        status: "COMPLETED",
        mpesaReference: payload.mpesaReceipt ?? null,
      },
    });
    if (flipped.count === 0) return; // a concurrent settlement won

    for (const item of sale.items) {
      if (!item.productId) continue;
      // The product must belong to the SAME organization as the sale — a
      // cross-organization reference is a data-integrity error that must
      // fail the settlement (retryable), never silently decrement another
      // organization's stock.
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        select: { organizationId: true },
      });
      if (!product || product.organizationId !== payload.organizationId) {
        throw new Error(
          `Cannot settle sale ${sale.id}: item product ${item.productId} does not ` +
            "belong to the sale's organization.",
        );
      }
      // update (not updateMany) so a missing product throws and the whole
      // transaction rolls back — the outbox retry re-attempts atomically.
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    }
  });

  logMpesa("settlement.sale_completed", { saleId: sale.id });
  return { settled: true, saleId: sale.id };
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export type SettlementWorkerResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  permanentlyFailed: number;
};

/**
 * Process due settlement work from the outbox.
 *
 * Safe to run concurrently (FOR UPDATE SKIP LOCKED claiming) and repeatedly.
 * Called on a best-effort basis after every M-Pesa callback, and scheduled
 * via the reconciliation sweep / cron for guaranteed retry.
 */
export async function processPendingSettlements(options?: {
  limit?: number;
  /** Restrict the sweep to one application (default: all applications). */
  applicationId?: string;
  /** Restrict the sweep to one environment (default: all environments). */
  environment?: Environment;
}): Promise<SettlementWorkerResult> {
  const limit = options?.limit ?? 10;
  const records = await claimDueOutboxRecords({
    batchSize: limit,
    eventTypePrefix: "settlement.",
    applicationId: options?.applicationId,
    environment: options?.environment,
  });

  const result: SettlementWorkerResult = {
    claimed: records.length,
    succeeded: 0,
    failed: 0,
    permanentlyFailed: 0,
  };

  for (const record of records) {
    try {
      if (record.eventType === SETTLEMENT_EVENT_TYPES.payment) {
        const payload = record.payload as unknown as PaymentSettlementPayload;
        await settlePaymentToLedger(payload.paymentId);
      } else if (record.eventType === SETTLEMENT_EVENT_TYPES.mpesaSale) {
        const payload = record.payload as unknown as SaleSettlementPayload;
        await settleLinkedSale(payload);
      } else {
        throw new Error(`Unknown settlement event type: ${record.eventType}`);
      }
      await markDispatched(record.id);
      result.succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(record.id, message);
      const updated = await prisma.outboxRecord.findUnique({
        where: { id: record.id },
        select: { status: true },
      });
      if (updated?.status === "FAILED") result.permanentlyFailed++;
      result.failed++;
      logMpesaError("settlement.attempt_failed", {
        outboxRecordId: record.id,
        eventType: record.eventType,
        attempt: record.attempts + 1,
        error: message,
      });
    }
  }

  return result;
}
