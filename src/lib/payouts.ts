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

import type { Environment, PayoutStatus } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreatePayoutInput = {
  applicationId: string;
  environment: Environment;
  amountMinor: bigint;
  currency?: string;
  recipientPhone: string;
  recipientName?: string;
  description?: string;
  reference?: string;
  idempotencyKey?: string;
};

export type PayoutResult =
  | { ok: true; payout: PayoutView; replayed?: boolean }
  | { ok: false; error: string; code: string };

/** Returned when the same idempotency key is reused with a different payload. */
export type IdempotencyConflict = {
  ok: false;
  error: string;
  code: "IDEMPOTENCY_CONFLICT";
};

export type PayoutView = {
  id: string;
  status: PayoutStatus;
  amountMinor: string;
  currency: string;
  recipientPhone: string;
  recipientName: string | null;
  description: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
};

// ---------------------------------------------------------------------------
// Amount policy
// ---------------------------------------------------------------------------

/**
 * Platform-wide per-payout limit — M-Pesa B2C transactions are capped at
 * KES 150,000 (15,000,000 minor units) per transfer, matching collections.
 * Enforced at creation so internal state never diverges from what a provider
 * could execute.
 */
export const MAX_PAYOUT_MINOR = 15_000_000n;

/**
 * Validate a payout amount (positive, within the platform limit) and
 * currency. Returns null when valid.
 */
export function validatePayoutAmount(
  amountMinor: bigint,
  currency?: string,
): { error: string; code: string } | null {
  if (amountMinor <= 0n) {
    return { error: "Payout amount must be positive.", code: "INVALID_AMOUNT" };
  }
  if (amountMinor > MAX_PAYOUT_MINOR) {
    return {
      error: "Payout amount must not exceed KSh 150,000 per transaction.",
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

/** Kenyan MSISDN (2547XXXXXXXX / 2541XXXXXXXX) or +254 E.164 form. */
const KENYAN_PHONE_PATTERN = /^(\+?254)(7|1)\d{8}$/;

export function isValidPayoutPhone(phone: string): boolean {
  return KENYAN_PHONE_PATTERN.test(phone);
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Valid state transitions for a Payout.
 *
 * PENDING    → PROCESSING (provider accepted the B2C request) | CANCELLED
 *              (cancelled before dispatch)
 * PROCESSING → SUCCEEDED | FAILED (provider outcome — FAILED carries the
 *              provider error and is TERMINAL: a failed payout is never
 *              resurrected; a retry is a NEW payout with a NEW idempotency
 *              key so the money movement history stays complete).
 * SUCCEEDED / FAILED / CANCELLED are terminal.
 */
const VALID_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export function isValidTransition(from: PayoutStatus, to: PayoutStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTransitions(status: PayoutStatus): PayoutStatus[] {
  return VALID_TRANSITIONS[status] ?? [];
}

const TERMINAL_STATUSES: readonly PayoutStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
];

// ---------------------------------------------------------------------------
// Payout creation (idempotent, concurrency-safe)
// ---------------------------------------------------------------------------

/**
 * Stable representation of the logical request used for idempotency hashing —
 * the SAME shared scheme as payments (src/lib/idempotency.ts), with amounts
 * normalized to decimal strings.
 */
function idempotentRequestView(input: CreatePayoutInput) {
  return {
    applicationId: input.applicationId,
    environment: input.environment,
    amountMinor: input.amountMinor.toString(),
    currency: input.currency ?? "KES",
    recipientPhone: input.recipientPhone,
    recipientName: input.recipientName ?? null,
    description: input.description ?? null,
    reference: input.reference ?? null,
  };
}

function payoutCreateData(input: CreatePayoutInput) {
  return {
    applicationId: input.applicationId,
    environment: input.environment,
    status: "PENDING" as const,
    amountMinor: input.amountMinor,
    currency: input.currency ?? "KES",
    recipientPhone: input.recipientPhone,
    recipientName: input.recipientName ?? null,
    description: input.description ?? null,
    reference: input.reference ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  };
}

/**
 * Create a payout. Reuses the SAME transactional idempotency architecture as
 * payments (src/lib/idempotency.ts — runIdempotent):
 *
 *   - same key + same payload    → the ORIGINAL result (replayed)
 *   - same key + different payload → IDEMPOTENCY_CONFLICT, nothing created
 *   - concurrent duplicates      → the IdempotencyRecord(applicationId,
 *     environment, key) unique constraint serializes them; exactly one
 *     payout row is ever created
 *   - the payout AND its idempotency record are written in ONE transaction
 *     (a crash can never leave one without the other)
 *
 * The payout is created PENDING; provider dispatch (B2C) is a separate,
 * guarded step (transitionPayout) — creating the record never initiates a
 * provider money movement, so a failed/retried CREATE can never double-pay.
 */
export async function createPayout(
  input: CreatePayoutInput,
): Promise<PayoutResult | IdempotencyConflict> {
  const amountError = validatePayoutAmount(input.amountMinor, input.currency);
  if (amountError) {
    return { ok: false, error: amountError.error, code: amountError.code };
  }

  if (!isValidPayoutPhone(input.recipientPhone)) {
    return {
      ok: false,
      code: "INVALID_PHONE",
      error:
        "recipientPhone must be a Kenyan MSISDN (2547XXXXXXXX / 2541XXXXXXXX).",
    };
  }

  const normalized: CreatePayoutInput = {
    ...input,
    currency: input.currency ?? "KES",
  };

  if (!normalized.idempotencyKey) {
    const payout = await prisma.payout.create({
      data: payoutCreateData(normalized),
    });
    return { ok: true, payout: formatPayout(payout) };
  }

  const outcome: IdempotentOutcome<{ ok: true; payout: PayoutView }> =
    await runIdempotent(
      {
        applicationId: normalized.applicationId,
        environment: normalized.environment,
        key: normalized.idempotencyKey,
      },
      idempotentRequestView(normalized),
      async (tx) => {
        const { applicationId, environment, idempotencyKey } = normalized;
        const payout = await tx.payout.create({
          data: payoutCreateData(normalized),
        });
        const result = { ok: true as const, payout: formatPayout(payout) };
        await createIdempotencyRecordTx(
          tx,
          { applicationId, environment, key: idempotencyKey! },
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

// ---------------------------------------------------------------------------
// State transitions (concurrency-safe)
// ---------------------------------------------------------------------------

/**
 * Transition a payout to a new status — CONCURRENCY-SAFE, identical guarded
 * pattern to payments:
 *
 *   UPDATE Payout SET status = NEW
 *   WHERE id = PAYOUT_ID AND status = EXPECTED_PREVIOUS_STATUS
 *
 * Zero affected rows → another writer changed the state first (or it is
 * already terminal) and the transaction aborts with TransitionConflictError
 * — a payout can never be transitioned twice, and no provider operation is
 * ever triggered from a stale state.
 */
export async function transitionPayout(
  payoutId: string,
  newStatus: PayoutStatus,
  errorData?: {
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<PayoutView | null> {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
  });

  if (!payout) return null;

  if (!isValidTransition(payout.status, newStatus)) {
    throw new InvalidTransitionError(
      "payout",
      payout.status,
      newStatus,
      getValidTransitions(payout.status),
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const guarded = await tx.payout.updateMany({
        where: { id: payoutId, status: payout.status },
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
        throw new TransitionConflictError("payout", payoutId, payout.status);
      }

      const updated = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
      });
      return formatPayout(updated);
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

export async function getPayout(
  payoutId: string,
  applicationId: string,
): Promise<PayoutView | null> {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, applicationId },
  });
  return payout ? formatPayout(payout) : null;
}

/** Opaque cursor for keyset pagination: base64url("createdAt|id"). */
function encodePayoutCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodePayoutCursor(cursor: string):
  | { ok: true; createdAt: Date; id: string }
  | { ok: false } {
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

export type ListPayoutsResult =
  | { ok: true; data: PayoutView[]; nextCursor: string | null }
  | { ok: false; error: string; code: "INVALID_CURSOR" | "INVALID_LIMIT" };

/**
 * List payouts for an application + environment, newest first.
 *
 * Deterministic ordering (createdAt DESC, id DESC) and keyset cursors that
 * must resolve WITHIN the same application + environment — a cursor minted
 * in another tenant/application cannot influence the page boundary.
 */
export async function listPayouts(
  applicationId: string,
  environment: Environment,
  options?: { status?: PayoutStatus; limit?: number; cursor?: string },
): Promise<ListPayoutsResult> {
  const limit = options?.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return {
      ok: false,
      code: "INVALID_LIMIT",
      error: "limit must be an integer between 1 and 100.",
    };
  }

  const where: Prisma.PayoutWhereInput = {
    applicationId,
    environment,
  };

  if (options?.status) {
    where.status = options.status;
  }

  if (options?.cursor) {
    const parsed = decodePayoutCursor(options.cursor);
    if (!parsed.ok) {
      return {
        ok: false,
        code: "INVALID_CURSOR",
        error: "Malformed pagination cursor.",
      };
    }

    const cursorPayout = await prisma.payout.findFirst({
      where: {
        id: parsed.id,
        createdAt: parsed.createdAt,
        applicationId,
        environment,
      },
      select: { id: true },
    });
    if (!cursorPayout) {
      return {
        ok: false,
        code: "INVALID_CURSOR",
        error: "Cursor does not belong to this application/environment.",
      };
    }

    where.OR = [
      { createdAt: { lt: parsed.createdAt } },
      { createdAt: parsed.createdAt, id: { lt: parsed.id } },
    ];
  }

  const payouts = await prisma.payout.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = payouts.length > limit;
  const data = hasMore ? payouts.slice(0, limit) : payouts;
  const last = data[data.length - 1];
  const nextCursor = hasMore && last
    ? encodePayoutCursor(last.createdAt, last.id)
    : null;

  return {
    ok: true,
    data: data.map(formatPayout),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPayout(p: {
  id: string;
  status: PayoutStatus;
  amountMinor: bigint;
  currency: string;
  recipientPhone: string;
  recipientName: string | null;
  description: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  processedAt: Date | null;
}): PayoutView {
  return {
    id: p.id,
    status: p.status,
    amountMinor: p.amountMinor.toString(),
    currency: p.currency,
    recipientPhone: p.recipientPhone,
    recipientName: p.recipientName,
    description: p.description,
    reference: p.reference,
    idempotencyKey: p.idempotencyKey,
    errorCode: p.errorCode,
    errorMessage: p.errorMessage,
    createdAt: p.createdAt.toISOString(),
    processedAt: p.processedAt?.toISOString() ?? null,
  };
}
