import "server-only";
import { prisma } from "@/lib/prisma";
import type { Environment, Prisma } from "@/generated/prisma/client";
import { getProvider } from "@/lib/providers/registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconciliationResult = {
  runId: string;
  status: "COMPLETED" | "FAILED";
  totalChecked: number;
  matched: number;
  discrepancies: number;
  exceptions: number;
  duration: number;
};

export type ReconciliationSummary = {
  runId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: string;
  totalChecked: number;
  matched: number;
  discrepancies: number;
};

// ---------------------------------------------------------------------------
// Reconciliation engine
// ---------------------------------------------------------------------------

/**
 * Run a reconciliation for all PENDING payments in an application + environment.
 *
 * For each PENDING payment with a provider checkout ID, queries the provider
 * for the current status and compares it against our internal record.
 *
 * Returns a summary of the reconciliation run.
 */
export async function runReconciliation(
  applicationId: string,
  environment: Environment,
  options?: {
    providerName?: string;
    maxAge?: number; // Max age in ms for PENDING payments to check
  },
): Promise<ReconciliationResult> {
  const startTime = Date.now();

  // Create the reconciliation run record
  const run = await prisma.reconciliationRun.create({
    data: {
      applicationId,
      environment,
      status: "RUNNING",
    },
  });

  try {
    // Find PENDING payments with provider checkout IDs
    const maxAge = options?.maxAge ?? 60 * 60 * 1000; // Default 1 hour
    const cutoff = new Date(Date.now() - maxAge);

    const pendingPayments = await prisma.payment.findMany({
      where: {
        applicationId,
        environment,
        status: "PENDING",
        createdAt: { lt: cutoff },
        providerRefs: { some: { externalType: "checkout_request" } },
      },
      include: {
        providerRefs: {
          where: { externalType: "checkout_request" },
          take: 1,
        },
      },
    });

    let matched = 0;
    let discrepancies = 0;

    for (const payment of pendingPayments) {
      const checkoutRef = payment.providerRefs[0];
      if (!checkoutRef) continue;

      try {
        // Query the provider for current status
        const provider = getProvider(checkoutRef.provider);
        if (!provider || !provider.queryStkPush) continue;

        const queryResult = await provider.queryStkPush({
          checkoutId: checkoutRef.externalId,
        });

        // Determine discrepancy
        let match = true;
        let discrepancyType: string | null = null;
        let details: Record<string, unknown> = {};

        if (queryResult.pending) {
          // Still pending — no discrepancy
          match = true;
        } else if (queryResult.resultCode === 0) {
          // Provider says success, we say pending — discrepancy
          match = false;
          discrepancyType = "STATUS_MISMATCH";
          details = {
            internal: "PENDING",
            external: "SUCCESS",
            receiptNumber: queryResult.receiptNumber,
          };
        } else {
          // Provider says failed/cancelled — discrepancy
          match = false;
          discrepancyType = "STATUS_MISMATCH";
          details = {
            internal: "PENDING",
            external: queryResult.resultCode === 1032 ? "CANCELLED" : "FAILED",
            resultCode: queryResult.resultCode,
          };
        }

        // Record the item
        await prisma.reconciliationItem.create({
          data: {
            reconciliationRunId: run.id,
            paymentId: payment.id,
            externalId: checkoutRef.externalId,
            internalStatus: "PENDING",
            externalStatus: queryResult.pending ? "PENDING" : `RESULT_${queryResult.resultCode}`,
            match,
            discrepancyType,
            details: details as unknown as Prisma.InputJsonValue,
          },
        });

        if (match) {
          matched++;
        } else {
          discrepancies++;

          // Create exception for non-matching items
          await prisma.reconciliationException.create({
            data: {
              reconciliationRunId: run.id,
              paymentId: payment.id,
              type: discrepancyType ?? "UNKNOWN",
              severity: "WARNING",
              description: `Internal status PENDING does not match external status for checkout ${checkoutRef.externalId}`,
              suggestedAction: queryResult.resultCode === 0
                ? "Update payment status to SUCCEEDED"
                : queryResult.resultCode === 1032
                  ? "Update payment status to CANCELLED"
                  : "Update payment status to FAILED and review",
            },
          });
        }
      } catch (err) {
        // Query failed — record as discrepancy
        discrepancies++;
        await prisma.reconciliationItem.create({
          data: {
            reconciliationRunId: run.id,
            paymentId: payment.id,
            externalId: checkoutRef.externalId,
            internalStatus: "PENDING",
            externalStatus: "QUERY_FAILED",
            match: false,
            discrepancyType: "QUERY_ERROR",
            details: { error: err instanceof Error ? err.message : String(err) },
          },
        });

        await prisma.reconciliationException.create({
          data: {
            reconciliationRunId: run.id,
            paymentId: payment.id,
            type: "QUERY_ERROR",
            severity: "WARNING",
            description: `Failed to query provider for checkout ${checkoutRef.externalId}`,
            suggestedAction: "Retry reconciliation or investigate provider connectivity",
          },
        });
      }
    }

    // Update run record
    const completedAt = new Date();
    const duration = completedAt.getTime() - startTime;

    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt,
        totalChecked: pendingPayments.length,
        matched,
        discrepancies,
      },
    });

    const exceptionCount = await prisma.reconciliationException.count({
      where: { reconciliationRunId: run.id },
    });

    return {
      runId: run.id,
      status: "COMPLETED",
      totalChecked: pendingPayments.length,
      matched,
      discrepancies,
      exceptions: exceptionCount,
      duration,
    };
  } catch (err) {
    // Mark run as failed
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      },
    });

    return {
      runId: run.id,
      status: "FAILED",
      totalChecked: 0,
      matched: 0,
      discrepancies: 0,
      exceptions: 0,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Resolve a reconciliation exception.
 */
export async function resolveException(
  exceptionId: string,
  resolvedBy: string,
  resolution: string,
): Promise<boolean> {
  const result = await prisma.reconciliationException.updateMany({
    where: { id: exceptionId, resolved: false },
    data: {
      resolved: true,
      resolvedAt: new Date(),
      resolvedBy,
      resolution,
    },
  });
  return result.count > 0;
}

/**
 * Get recent reconciliation runs for an application.
 */
export async function getReconciliationRuns(
  applicationId: string,
  environment: Environment,
  limit = 10,
): Promise<ReconciliationSummary[]> {
  const runs = await prisma.reconciliationRun.findMany({
    where: { applicationId, environment },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      status: true,
      totalChecked: true,
      matched: true,
      discrepancies: true,
    },
  });

  return runs.map((r) => ({
    runId: r.id,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    status: r.status,
    totalChecked: r.totalChecked,
    matched: r.matched,
    discrepancies: r.discrepancies,
  }));
}
