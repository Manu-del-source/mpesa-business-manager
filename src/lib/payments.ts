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
import { enqueuePaymentSettlementTx } from "@/lib/settlement";

export { InvalidTransitionError, TransitionConflictError };
import type { Environment, PaymentDirection, PaymentStatus } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreatePaymentInput = {
  applicationId: string;
  environment: Environment;
  direction?: PaymentDirection;
  amountMinor: bigint;
  currency?: string;
  phone?: string;
  email?: string;
  customerName?: string;
  description?: string;
  idempotencyKey?: string;
  reference?: string;
};

export type PaymentResult =
  | { ok: true; payment: PaymentView; replayed?: boolean }
  | { ok: false; error: string; code: string };

/** Returned when the same idempotency key is reused with a different payload. */
export type IdempotencyConflict = {
  ok: false;
  error: string;
  code: "IDEMPOTENCY_CONFLICT";
};

export type PaymentView = {
  id: string;
  status: PaymentStatus;
  direction: PaymentDirection;
  amountMinor: string;
  currency: string;
  phone: string | null;
  email: string | null;
  customerName: string | null;
  description: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  processedAt: string | null;
};

// ---------------------------------------------------------------------------
// Amount policy
// ---------------------------------------------------------------------------

/**
 * Platform-wide per-payment limit (KES 150,000 = 15,000,000 minor units),
 * matching the M-Pesa per-transaction collection limit. Enforced before any
 * record is created so internal state never diverges from a provider charge.
 */
export const MAX_PAYMENT_MINOR = 15_000_000n;

/**
 * Validate a payment amount (positive, within the platform limit) and
 * currency. Returns null when valid.
 */
export function validatePaymentAmount(
  amountMinor: bigint,
  currency?: string,
): { error: string; code: string } | null {
  if (amountMinor <= 0n) {
    return { error: "Amount must be positive.", code: "INVALID_AMOUNT" };
  }
  if (amountMinor > MAX_PAYMENT_MINOR) {
    return {
      error: "Amount must not exceed KSh 150,000 per transaction.",
      code: "INVALID_AMOUNT",
    };
  }
  if (currency !== undefined && !isValidCurrency(currency)) {
    return {
      error: 'Currency must be a 3-letter ISO code (e.g. "KES").',
      code: "INVALID_CURRENCY",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Valid state transitions for a Payment.
 * Each key is the current status; the value is the set of allowed next statuses.
 *
 * PENDING    → PROCESSING (provider accepted) | CANCELLED (before dispatch)
 * PROCESSING → SUCCEEDED | FAILED | CANCELLED
 * SUCCEEDED  → REFUNDED (fully refunded; refund records carry the amounts)
 * FAILED / CANCELLED / REFUNDED are terminal.
 */
const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: ["REFUNDED"],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/** Check whether a state transition is valid. */
export function isValidTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Get all valid transitions from a given status. */
export function getValidTransitions(status: PaymentStatus): PaymentStatus[] {
  return VALID_TRANSITIONS[status] ?? [];
}

// ---------------------------------------------------------------------------
// Payment creation (idempotent, concurrency-safe)
// ---------------------------------------------------------------------------

/**
 * Stable representation of the logical request used for idempotency hashing.
 * The amount is normalized to its decimal string so "1549" (string) and
 * 1549 (number) hash identically.
 */
function idempotentRequestView(input: CreatePaymentInput) {
  return {
    applicationId: input.applicationId,
    environment: input.environment,
    direction: input.direction ?? "INCOMING",
    amountMinor: input.amountMinor.toString(),
    currency: input.currency ?? "KES",
    phone: input.phone ?? null,
    email: input.email ?? null,
    customerName: input.customerName ?? null,
    description: input.description ?? null,
    reference: input.reference ?? null,
  };
}

/**
 * Create a new payment. This is the entry point for all payment initiation.
 *
 * Idempotency (when `idempotencyKey` is provided):
 *   - same key + logically equivalent request → the ORIGINAL result is
 *     returned (flagged `replayed`)
 *   - same key + different payload → IDEMPOTENCY_CONFLICT, no second payment
 *   - concurrent duplicates → the database unique constraint on
 *     IdempotencyRecord(applicationId, environment, key) serializes the
 *     requests; exactly one payment is created
 *
 * The payment and its idempotency record are written in ONE transaction, so
 * a crash can never leave a payment without its replay record (or vice
 * versa).
 */
export async function createPayment(
  input: CreatePaymentInput,
): Promise<PaymentResult | IdempotencyConflict> {
  const amountError = validatePaymentAmount(input.amountMinor, input.currency);
  if (amountError) {
    return { ok: false, error: amountError.error, code: amountError.code };
  }

  // Normalize once: everything downstream (including the idempotency hash)
  // uses the same shape.
  const normalized: CreatePaymentInput = {
    ...input,
    direction: input.direction ?? "INCOMING",
    currency: input.currency ?? "KES",
  };

  if (!normalized.idempotencyKey) {
    const payment = await prisma.payment.create({
      data: paymentCreateData(normalized),
    });
    return { ok: true, payment: formatPayment(payment) };
  }

  const outcome: IdempotentOutcome<{ ok: true; payment: PaymentView }> =
    await runIdempotent(
      {
        applicationId: normalized.applicationId,
        environment: normalized.environment,
        key: normalized.idempotencyKey,
      },
      idempotentRequestView(normalized),
      async (tx) => {
        const payment = await tx.payment.create({
          data: paymentCreateData(normalized),
        });
        const result = { ok: true as const, payment: formatPayment(payment) };
        const { applicationId, environment, idempotencyKey } = normalized;
        await createIdempotencyRecordTx(
          tx,
          {
            applicationId,
            environment,
            key: idempotencyKey!,
          },
          hashRequestPayload(idempotentRequestView(normalized)),
          201,
          result,
        );
        return { responseStatus: 201, responseBody: result };
      },
    );

  switch (outcome.type) {
    case "fresh":
      return outcome.result;
    case "replay":
      return { ...outcome.result, replayed: true };
    case "conflict":
      return {
        ok: false,
        code: "IDEMPOTENCY_CONFLICT",
        error:
          "This idempotency key was already used with a different request payload.",
      };
  }
}

function paymentCreateData(input: CreatePaymentInput) {
  return {
    applicationId: input.applicationId,
    environment: input.environment,
    direction: input.direction ?? "INCOMING",
    status: "PENDING" as const,
    amountMinor: input.amountMinor,
    currency: input.currency ?? "KES",
    phone: input.phone ?? null,
    email: input.email ?? null,
    customerName: input.customerName ?? null,
    description: input.description ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    reference: input.reference ?? null,
  };
}

// ---------------------------------------------------------------------------
// State transitions (concurrency-safe)
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: readonly PaymentStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
];

/**
 * Transition a payment to a new status — CONCURRENCY-SAFE.
 *
 * The update is guarded:
 *
 *   UPDATE Payment SET status = NEW
 *   WHERE id = PAYMENT_ID AND status = EXPECTED_PREVIOUS_STATUS
 *
 * If zero rows are affected, another writer changed the state first (or the
 * transition is invalid) and the transaction aborts — a payment can never be
 * transitioned twice, and impossible transitions (SUCCEEDED → PENDING,
 * FAILED → SUCCEEDED, …) are rejected by the state machine.
 *
 * The PaymentAttempt record is created in the same transaction as the
 * guarded update, so attempts and state always agree.
 */
export async function transitionPayment(
  paymentId: string,
  newStatus: PaymentStatus,
  attemptData?: {
    provider: string;
    providerRequestId?: string;
    providerCheckoutId?: string;
    providerResponse?: unknown;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<PaymentView | null> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment) return null;

  if (!isValidTransition(payment.status, newStatus)) {
    throw new InvalidTransitionError("payment", payment.status, newStatus, getValidTransitions(payment.status));
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Guarded update: only succeeds when the status is still what we read.
      const guarded = await tx.payment.updateMany({
        where: { id: paymentId, status: payment.status },
        data: {
          status: newStatus,
          processedAt: TERMINAL_STATUSES.includes(newStatus) ? new Date() : undefined,
        },
      });

      if (guarded.count === 0) {
        throw new TransitionConflictError("payment", paymentId, payment.status);
      }

      // When the payment reaches SUCCEEDED, enqueue the ledger settlement
      // in the SAME transaction — the financial posting can never be lost,
      // and it happens through the retryable, idempotent outbox worker
      // (see src/lib/settlement.ts), never inline.
      if (newStatus === "SUCCEEDED") {
        await enqueuePaymentSettlementTx(tx, {
          id: paymentId,
          applicationId: payment.applicationId,
          environment: payment.environment,
        });
      }

      // Create the payment attempt in the SAME transaction, only after the
      // guarded update won the race.
      if (attemptData) {
        await tx.paymentAttempt.create({
          data: {
            paymentId,
            provider: attemptData.provider,
            status: newStatus,
            providerRequestId: attemptData.providerRequestId ?? null,
            providerCheckoutId: attemptData.providerCheckoutId ?? null,
            providerResponse: (attemptData.providerResponse ?? null) as Prisma.InputJsonValue,
            errorCode: attemptData.errorCode ?? null,
            errorMessage: attemptData.errorMessage ?? null,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            completedAt: new Date(),
          },
        });
      }

      const updated = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      return formatPayment(updated);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma wraps errors thrown inside interactive transactions as
      // P2004 ("transaction failed") with the original error attached.
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

/**
 * Get a payment by ID, scoped to an application.
 */
export async function getPayment(
  paymentId: string,
  applicationId: string,
): Promise<PaymentView | null> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, applicationId },
  });
  return payment ? formatPayment(payment) : null;
}

/** Opaque cursor for keyset pagination: base64url("createdAt|id"). */
function encodePaymentCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export type CursorParseResult =
  | { ok: true; createdAt: Date; id: string }
  | { ok: false };

export function decodePaymentCursor(cursor: string): CursorParseResult {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator <= 0) return { ok: false };
    const iso = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) return { ok: false };
    return { ok: true, createdAt, id };
  } catch {
    return { ok: false };
  }
}

export type ListPaymentsResult =
  | { ok: true; data: PaymentView[]; nextCursor: string | null }
  | { ok: false; error: string; code: "INVALID_CURSOR" | "INVALID_LIMIT" };

/**
 * List payments for an application + environment, newest first.
 *
 * Ordering is deterministic: (createdAt DESC, id DESC) — id is the unique
 * tiebreaker so rows that share a timestamp are never skipped or duplicated.
 *
 * Cursors are opaque and keyset-based. A cursor that does not resolve to a
 * payment IN THE SAME application + environment is rejected (a cursor from
 * another tenant/application must not influence this page boundary).
 */
export async function listPayments(
  applicationId: string,
  environment: Environment,
  options?: { status?: PaymentStatus; limit?: number; cursor?: string },
): Promise<ListPaymentsResult> {
  const limit = options?.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return {
      ok: false,
      code: "INVALID_LIMIT",
      error: "limit must be an integer between 1 and 100.",
    };
  }

  const where: Prisma.PaymentWhereInput = {
    applicationId,
    environment,
  };

  if (options?.status) {
    where.status = options.status;
  }

  if (options?.cursor) {
    const parsed = decodePaymentCursor(options.cursor);
    if (!parsed.ok) {
      return {
        ok: false,
        code: "INVALID_CURSOR",
        error: "Malformed pagination cursor.",
      };
    }

    // The cursor must resolve to a payment in THIS scope — otherwise a
    // cursor minted in another tenant/application would leak its position.
    const cursorPayment = await prisma.payment.findFirst({
      where: {
        id: parsed.id,
        createdAt: parsed.createdAt,
        applicationId,
        environment,
      },
      select: { id: true },
    });
    if (!cursorPayment) {
      return {
        ok: false,
        code: "INVALID_CURSOR",
        error: "Cursor does not belong to this application/environment.",
      };
    }

    // Keyset predicate: strictly before (createdAt, id) in the sort order.
    where.OR = [
      { createdAt: { lt: parsed.createdAt } },
      { createdAt: parsed.createdAt, id: { lt: parsed.id } },
    ];
  }

  const payments = await prisma.payment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = payments.length > limit;
  const data = hasMore ? payments.slice(0, limit) : payments;
  const last = data[data.length - 1];
  const nextCursor = hasMore && last
    ? encodePaymentCursor(last.createdAt, last.id)
    : null;

  return {
    ok: true,
    data: data.map(formatPayment),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPayment(p: {
  id: string;
  status: PaymentStatus;
  direction: PaymentDirection;
  amountMinor: bigint;
  currency: string;
  phone: string | null;
  email: string | null;
  customerName: string | null;
  description: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
  processedAt: Date | null;
}): PaymentView {
  return {
    id: p.id,
    status: p.status,
    direction: p.direction,
    amountMinor: p.amountMinor.toString(),
    currency: p.currency,
    phone: p.phone,
    email: p.email,
    customerName: p.customerName,
    description: p.description,
    reference: p.reference,
    idempotencyKey: p.idempotencyKey,
    createdAt: p.createdAt.toISOString(),
    processedAt: p.processedAt?.toISOString() ?? null,
  };
}

/**
 * Clean up expired idempotency records. Run periodically.
 */
export async function cleanupExpiredIdempotency(): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
