import "server-only";
import { prisma } from "@/lib/prisma";
import { statusForResultCode } from "@/lib/mpesa/callback";
import { queryStkStatus, resolveLiveConfig } from "@/lib/mpesa/daraja";
import { toDarajaError } from "@/lib/mpesa/errors";
import { logMpesa, logMpesaError } from "@/lib/mpesa/log";

/**
 * Reconciliation sweep for STK pushes whose callback never arrived.
 *
 * Callbacks get lost in practice: a deploy restarts mid-flight, the callback
 * URL is briefly unreachable, or Safaricom drops the retry. Without a sweep
 * those transactions sit PENDING forever and the linked sale never settles.
 *
 * For each stale PENDING transaction that carries a real checkoutRequestId we
 * ask Daraja (STK Push Query) for the authoritative outcome and apply it
 * through exactly the same idempotent write the callback uses.
 */

/** Don't query a push that may still legitimately be on the customer's phone. */
export const MIN_AGE_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Safaricom expires an unanswered STK prompt after ~1 minute, and the query
 * endpoint stops recognising very old CheckoutRequestIDs. Past this age we
 * stop asking and mark the transaction TIMEOUT so it doesn't churn forever.
 */
export const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export type ReconcileSummary = {
  scanned: number;
  settled: number;
  stillPending: number;
  expired: number;
  errors: number;
};

/**
 * Reconcile stale transactions.
 *
 * @param orgId  Limit to one organization; omit to sweep every organization.
 * @param limit  Safety cap on how many transactions to touch per run.
 */
export async function reconcilePendingTransactions(options: {
  orgId?: string;
  limit?: number;
} = {}): Promise<ReconcileSummary> {
  const limit = options.limit ?? 50;
  const now = Date.now();

  const stale = await prisma.mpesaTransaction.findMany({
    where: {
      status: "PENDING",
      // Only live pushes can be queried; simulated ones have no id.
      checkoutRequestId: { not: null },
      createdAt: { lt: new Date(now - MIN_AGE_MS) },
      ...(options.orgId ? { organizationId: options.orgId } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      organizationId: true,
      checkoutRequestId: true,
      createdAt: true,
      reference: true,
    },
  });

  const summary: ReconcileSummary = {
    scanned: stale.length,
    settled: 0,
    stillPending: 0,
    expired: 0,
    errors: 0,
  };

  // Cache per-org config so a sweep over many rows resolves it once.
  const configCache = new Map<string, Awaited<ReturnType<typeof resolveLiveConfig>>>();

  for (const txn of stale) {
    const age = now - txn.createdAt.getTime();

    try {
      if (!configCache.has(txn.organizationId)) {
        configCache.set(txn.organizationId, await resolveLiveConfig(txn.organizationId));
      }
      const config = configCache.get(txn.organizationId) ?? null;

      // Org went back to demo/disabled — nothing authoritative to ask.
      if (!config) {
        summary.stillPending++;
        continue;
      }

      const queried = await queryStkStatus(config, txn.checkoutRequestId!);

      if (queried.pending || queried.resultCode === null) {
        if (age > MAX_AGE_MS) {
          await expire(txn.id, "No confirmation received from Safaricom.");
          summary.expired++;
        } else {
          summary.stillPending++;
        }
        continue;
      }

      const status = statusForResultCode(queried.resultCode);
      const updated = await prisma.mpesaTransaction.updateMany({
        where: { id: txn.id, status: "PENDING" },
        data: {
          status,
          resultCode: queried.resultCode,
          resultDesc: queried.resultDesc?.slice(0, 500) ?? null,
          completedAt: new Date(),
        },
      });

      if (updated.count > 0) {
        summary.settled++;
        logMpesa("reconcile.settled", {
          transactionId: txn.id,
          resultCode: queried.resultCode,
          status,
        });

        // Mirror the callback's sale bookkeeping.
        if (txn.reference) {
          await settleSaleForReconciledTxn(txn.organizationId, txn.reference, status);
        }
      }
    } catch (err) {
      const error = toDarajaError(err);
      summary.errors++;
      logMpesaError("reconcile.failed", {
        transactionId: txn.id,
        code: error.code,
        detail: error.detail,
      });

      // Give up on very old rows even when the query itself keeps failing.
      if (age > MAX_AGE_MS) {
        await expire(txn.id, "Could not confirm this payment with Safaricom.");
        summary.expired++;
      }
    }
  }

  logMpesa("reconcile.sweep", { ...summary, orgId: options.orgId ?? "all" });
  return summary;
}

async function expire(transactionId: string, reason: string): Promise<void> {
  await prisma.mpesaTransaction.updateMany({
    where: { id: transactionId, status: "PENDING" },
    data: { status: "TIMEOUT", resultDesc: reason, completedAt: new Date() },
  });
  logMpesa("reconcile.expired", { transactionId });
}

/**
 * Apply the reconciled outcome to a linked POS sale. Mirrors
 * `settleLinkedSale` in callback.ts: stock moves only on confirmed payment.
 */
async function settleSaleForReconciledTxn(
  orgId: string,
  receiptNo: string,
  status: ReturnType<typeof statusForResultCode>,
): Promise<void> {
  const sale = await prisma.sale.findFirst({
    where: { organizationId: orgId, receiptNo, status: "PENDING", paymentMethod: "MPESA" },
    include: { items: true },
  });
  if (!sale) return;

  try {
    if (status === "SUCCESS") {
      await prisma.$transaction(async (tx) => {
        await tx.sale.update({ where: { id: sale.id }, data: { status: "COMPLETED" } });
        for (const item of sale.items) {
          if (!item.productId) continue;
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          });
        }
      });
    } else {
      await prisma.sale.update({ where: { id: sale.id }, data: { status: "CANCELLED" } });
    }
  } catch (err) {
    logMpesaError("reconcile.sale_settlement_failed", {
      saleId: sale.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
