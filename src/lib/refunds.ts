import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isValidCurrency } from "@/lib/money";
import {
  createIdempotencyRecordTx,
  runIdempotent,
  hashRequestPayload,
  type IdempotentOutcome,
} from "@/lib/idempotency";
import {
  InvalidTransitionError,
  TransitionConflictError,
} from "@/lib/domain-errors";

export { InvalidTransitionError, TransitionConflictError };

import type { Environment, RefundStatus } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateRefundInput = {
  applicationId: string;
  environment: Environment;
  paymentId: string;
  amountMinor: bigint;
  currency?: string;
  reason?: string;
  reference?: string;
  idempotencyKey?: string;
};

export type RefundResult =
  | { ok: true; refund: RefundView; replayed?: boolean }
  | { ok: false; error: string; code: string };

/** Returned when the same idempotency key is reused with a different payload. */
export type IdempotencyConflict = {
  ok: false;
  error: string;
  code: "IDEMPOTENCY_CONFLICT";
};

export type RefundView = {
  id: string;
  status: RefundStatus;
  paymentId: string;
  amountMinor: string;
  currency: string;
  reason: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Valid state transitions for a Refund.
 *
 * PENDING    → PROCESSING (provider accepted the refund request) | CANCELLED
 * PROCESSING → SUCCEEDED | FAILED
 * SUCCEEDED / FAILED / CANCELLED are terminal. A SUCCEEDED refund can never
 * be refunded again (the refundable-balance check also counts it), and a
 * FAILED refund is terminal — a retry is a NEW refund with a NEW idempotency
 * key so the audit trail stays complete.
 */
const VALID_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isValidRefundTransition(from: RefundStatus, to: RefundStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidRefundTransitions(status: RefundStatus): RefundStatus[] {
  return VALID_TRANSITIONS[status] ?? [];
}

const TERMINAL_STATUSES: readonly RefundStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];

/** Refund statuses that reserve refundable balance (cannot double-spend). */
const RESERVING_STATUSES: readonly RefundStatus[] = [
  "SUCCEEDED",
  "PENDING",
  "PROCESSING",
];

// ---------------------------------------------------------------------------
// Refund creation (idempotent, race-safe, transactional)
// ---------------------------------------------------------------------------

/**
 * Stable representation of the logical request used for idempotency hashing
 * (same shared scheme as payments and payouts).
 */
function idempotentRequestView(input: CreateRefundInput) {
  return {
    applicationId: input.applicationId,
    environment: input.environment,
    paymentId: input.paymentId,
    amountMinor: input.amountMinor.toString(),
    currency: input.currency ?? "KES",
    reason: input.reason ?? null,
    reference: input.reference ?? null,
  };
}

/**
 * Create a refund against a payment.
 *
 * Combines the SAME transactional idempotency architecture as payments
 * (runIdempotent — see src/lib/idempotency.ts) with a row-locked
 * refundable-balance check:
 *
 *   1. The payment row is locked (SELECT … FOR UPDATE) INSIDE the creation
 *      transaction, serializing concurrent refunds for the same payment —
 *      the sum of refunds can never exceed the payment amount, even under
 *      concurrency.
 *   2. Same idempotency key + same payload → the ORIGINAL refund (replay).
 *   3. Same key + different payload → IDEMPOTENCY_CONFLICT (409).
 *   4. Concurrent duplicates → exactly one refund row (unique constraint on
 *      IdempotencyRecord(applicationId, environment, key)).
 *
 * The refund is created PENDING. Provider execution is a separate guarded
 * step (transitionRefund) — creating the record never moves money, so a
 * replayed create can never double-refund.
 */
export async function createRefund(
  input: CreateRefundInput,
): Promise<RefundResult | IdempotencyConflict> {
  if (input.amountMinor <= 0n) {
    return { ok: false, error: "Refund amount must be positive.", code: "INVALID_AMOUNT" };
  }
  if (input.currency !== undefined && !isValidCurrency(input.currency)) {
    return {
      ok: false,
      error: 'Currency must be a 3-letter ISO code (e.g. "KES").',
      code: "INVALID_CURRENCY",
    };
  }

  const normalized: CreateRefundInput = {
    ...input,
    currency: input.currency ?? "KES",
  };

  if (!normalized.idempotencyKey) {
    const refund = await createRefundTx(prisma, normalized);
    if (!refund.ok) return refund;
    return { ok: true, refund: formatRefund(refund.refund) };
  }

  const { applicationId, environment, idempotencyKey } = normalized;

  const outcome: IdempotentOutcome<RefundResult> = await runIdempotent(
    { applicationId, environment, key: idempotencyKey },
    idempotentRequestView(normalized),
    async (tx) => {
      const refund = await createRefundTx(tx, normalized);
      // NOTE: refundability is DATABASE STATE, so the first execution's
      // result (success OR validation error) is cached under the key —
      // a retry with the same key + payload replays it deterministically,
      // and a different payload conflicts (409). Pure input validation
      // (amount/currency) happens before the key is involved.
      const result: RefundResult = refund.ok
        ? { ok: true, refund: formatRefund(refund.refund) }
        : { ok: false, error: refund.error, code: refund.code };
      const responseStatus = refund.ok ? 201 : 400;
      await createIdempotencyRecordTx(
        tx,
        { applicationId, environment, key: idempotencyKey! },
        hashRequestPayload(idempotentRequestView(normalized)),
        responseStatus,
        result,
      );
      return { responseStatus, responseBody: result };
    },
  );

  switch (outcome.type) {
    case "fresh":
      return outcome.result;
    case "replay":
      return outcome.result.ok
        ? { ...outcome.result, replayed: true }
        : outcome.result;
    case "conflict":
      return {
        ok: false,
        code: "IDEMPOTENCY_CONFLICT",
        error:
          "This idempotency key was already used with a different request payload.",
      };
  }
}

/**
 * The race-safe creation core, executed inside a transaction:
 * lock the payment row, re-validate refundability, create the refund.
 */
async function createRefundTx(
  tx: Prisma.TransactionClient,
  input: CreateRefundInput,
): Promise<
  | { ok: false; error: string; code: string }
  | { ok: true; refund: { id: string; status: RefundStatus; paymentId: string; amountMinor: bigint; currency: string; reason: string | null; reference: string | null; idempotencyKey: string | null; errorCode: string | null; errorMessage: string | null; createdAt: Date; processedAt: Date | null } }
> {
  // Lock the payment row — serializes concurrent refunds + guarantees the
  // refundable-balance check reads a stable state.
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.paymentId} FOR UPDATE`;

  const payment = await tx.payment.findFirst({
    where: {
      id: input.paymentId,
      applicationId: input.applicationId,
      environment: input.environment,
    },
  });

  if (!payment) {
    return { ok: false, error: "Payment not found.", code: "NOT_FOUND" };
  }
  if (payment.status !== "SUCCEEDED") {
    return {
      ok: false,
      error: "Only successful payments can be refunded.",
      code: "NOT_REFUNDABLE",
    };
  }
  if (input.currency && input.currency !== payment.currency) {
    return {
      ok: false,
      error: `Refund currency (${input.currency}) must match payment currency (${payment.currency}).`,
      code: "CURRENCY_MISMATCH",
    };
  }

  const existingRefunds = await tx.refund.aggregate({
    where: { paymentId: input.paymentId, status: { in: [...RESERVING_STATUSES] } },
    _sum: { amountMinor: true },
  });
  const alreadyRefunded = existingRefunds._sum.amountMinor ?? 0n;
  const refundable = payment.amountMinor - alreadyRefunded;

  if (input.amountMinor > refundable) {
    return {
      ok: false,
      error: `Refund amount (${input.amountMinor}) exceeds refundable balance (${refundable}).`,
      code: "AMOUNT_EXCEEDS_REFUNDABLE",
    };
  }

  const refund = await tx.refund.create({
    data: {
      applicationId: input.applicationId,
      environment: input.environment,
      paymentId: input.paymentId,
      status: "PENDING",
      amountMinor: input.amountMinor,
      currency: input.currency ?? payment.currency,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });

  return { ok: true, refund };
}

// ---------------------------------------------------------------------------
// State transitions (concurrency-safe)
// ---------------------------------------------------------------------------

/**
 * Transition a refund to a new status — CONCURRENCY-SAFE guarded conditional
 * update, identical pattern to payments and payouts. Zero affected rows →
 * TransitionConflictError; a forbidden transition → InvalidTransitionError.
 */
export async function transitionRefund(
  refundId: string,
  newStatus: RefundStatus,
  errorData?: { errorCode?: string; errorMessage?: string },
): Promise<RefundView | null> {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund) return null;

  if (!isValidRefundTransition(refund.status, newStatus)) {
    throw new InvalidTransitionError(
      "refund",
      refund.status,
      newStatus,
      getValidRefundTransitions(refund.status),
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const guarded = await tx.refund.updateMany({
        where: { id: refundId, status: refund.status },
        data: {
          status: newStatus,
          processedAt: TERMINAL_STATUSES.includes(newStatus)
            ? new Date()
            : undefined,
          errorCode: errorData?.errorCode ?? undefined,
          errorMessage: errorData?.errorMessage ?? undefined,
        },
      });

      if (guarded.count === 0) {
        throw new TransitionConflictError("refund", refundId, refund.status);
      }

      const updated = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
      });
      return formatRefund(updated);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const original = err.meta?.cause ?? err;
      if (original instanceof InvalidTransitionError) throw original;
      if (original instanceof TransitionConflictError) throw original;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getRefund(
  refundId: string,
  applicationId: string,
): Promise<RefundView | null> {
  const refund = await prisma.refund.findFirst({
    where: { id: refundId, applicationId },
  });
  return refund ? formatRefund(refund) : null;
}

/**
 * Remaining refundable amount for a payment (payment amount minus refunds in
 * SUCCEEDED/PENDING/PROCESSING states). Informational — the authoritative
 * check runs inside createRefund's locked transaction.
 */
export async function getRefundableAmount(
  paymentId: string,
  applicationId: string,
): Promise<bigint | null> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, applicationId },
  });
  if (!payment || payment.status !== "SUCCEEDED") return null;

  const existingRefunds = await prisma.refund.aggregate({
    where: { paymentId, status: { in: [...RESERVING_STATUSES] } },
    _sum: { amountMinor: true },
  });
  return payment.amountMinor - (existingRefunds._sum.amountMinor ?? 0n);
}

export async function listRefunds(
  applicationId: string,
  environment: Environment,
  options?: { paymentId?: string; status?: RefundStatus; limit?: number },
): Promise<RefundView[]> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const where: Prisma.RefundWhereInput = { applicationId, environment };
  if (options?.paymentId) where.paymentId = options.paymentId;
  if (options?.status) where.status = options.status;

  const refunds = await prisma.refund.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return refunds.map(formatRefund);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRefund(r: {
  id: string;
  status: RefundStatus;
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  reason: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  processedAt: Date | null;
}): RefundView {
  return {
    id: r.id,
    status: r.status,
    paymentId: r.paymentId,
    amountMinor: r.amountMinor.toString(),
    currency: r.currency,
    reason: r.reason,
    reference: r.reference,
    idempotencyKey: r.idempotencyKey,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
  };
}
