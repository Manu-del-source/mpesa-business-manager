import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Environment } from "@/generated/prisma/client";

/**
 * Transactional idempotency for financial operations.
 *
 * Correctness model:
 *   1. The IdempotencyRecord unique constraint on
 *      (applicationId, environment, key) is the serialization point.
 *   2. The business entity (payment/payout/refund) AND its idempotency
 *      record are created in ONE database transaction, so a duplicate
 *      insert can only surface as Prisma P2002 — which we then resolve by
 *      re-reading the record.
 *   3. A stored record whose requestHash differs from the current request is
 *      a CONFLICT (409 IDEMPOTENCY_CONFLICT) — never a silent second entity.
 *
 * This is deliberately NOT a "check-then-create" helper: two concurrent
 * requests both pass the initial check, and the loser is resolved by the
 * unique constraint, not by luck.
 */

export type IdempotencyScope = {
  applicationId: string;
  environment: Environment;
  key: string;
};

/** Default time-to-live for idempotency records (24 hours, like Stripe). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Stable JSON serialization for request hashing (sorted keys). */
export function hashRequestPayload(payload: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          if (obj[key] !== undefined) acc[key] = stable(obj[key]);
          return acc;
        }, {});
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}

export type IdempotentOutcome<T> =
  | { type: "fresh"; result: T }
  | { type: "replay"; result: T }
  | { type: "conflict" };

/**
 * Look up an existing idempotency record.
 * Returns "replay" (hash matches), "conflict" (hash differs) or null
 * (no record, or expired — expired records are removed so the key can be
 * reused after the TTL).
 */
export async function findIdempotencyRecord(
  scope: IdempotencyScope,
  requestHash: string,
): Promise<{ outcome: "replay" | "conflict"; responseStatus: number; responseBody: unknown } | null> {
  const record = await prisma.idempotencyRecord.findUnique({
    where: {
      applicationId_environment_key: {
        applicationId: scope.applicationId,
        environment: scope.environment,
        key: scope.key,
      },
    },
  });

  if (!record) return null;

  if (record.expiresAt.getTime() <= Date.now()) {
    // Expired: remove so the key can be reused. Concurrent removals are
    // fine (deleteMany), and the create path tolerates the race via P2002.
    await prisma.idempotencyRecord
      .deleteMany({ where: { id: record.id } })
      .catch(() => {});
    return null;
  }

  if (record.requestHash !== requestHash) {
    return { outcome: "conflict", responseStatus: 409, responseBody: null };
  }

  return {
    outcome: "replay",
    responseStatus: record.responseStatus,
    responseBody: record.responseBody,
  };
}

/** Store (inside the caller's transaction) the idempotency record. */
export async function createIdempotencyRecordTx(
  tx: Prisma.TransactionClient,
  scope: IdempotencyScope,
  requestHash: string,
  responseStatus: number,
  responseBody: unknown,
  ttlMs: number = IDEMPOTENCY_TTL_MS,
): Promise<void> {
  await tx.idempotencyRecord.create({
    data: {
      applicationId: scope.applicationId,
      environment: scope.environment,
      key: scope.key,
      requestHash,
      responseStatus,
      responseBody: responseBody as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
}

/** Prisma unique-constraint violation on the idempotency key? */
export function isIdempotencyKeyConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Run a financial operation idempotently.
 *
 * `operation` receives a transaction client and MUST create the business
 * entity AND call createIdempotencyRecordTx(...) with the same key inside
 * that transaction. It returns the typed result plus the response body to
 * cache (typically the same result).
 *
 * Concurrency: if two requests race, one transaction commits first; the
 * other hits P2002, aborts, and resolves by re-reading the stored record —
 * replay for identical payloads, conflict otherwise. No second entity is
 * ever created.
 */
export async function runIdempotent<TResponse>(
  scope: IdempotencyScope,
  requestPayload: unknown,
  operation: (tx: Prisma.TransactionClient) => Promise<{
    responseStatus: number;
    responseBody: TResponse;
  }>,
): Promise<IdempotentOutcome<TResponse>> {
  const requestHash = hashRequestPayload(requestPayload);

  // Fast path: an existing record resolves without touching the write path.
  const existing = await findIdempotencyRecord(scope, requestHash);
  if (existing?.outcome === "replay") {
    return { type: "replay", result: existing.responseBody as TResponse };
  }
  if (existing?.outcome === "conflict") {
    return { type: "conflict" };
  }

  // Slow path: create entity + record atomically.
  try {
    const result = await prisma.$transaction(operation);
    return { type: "fresh", result: result.responseBody };
  } catch (err) {
    if (!isIdempotencyKeyConflict(err)) throw err;

    // Lost the race (or an expired record was replaced). Re-read to resolve.
    const resolved = await findIdempotencyRecord(scope, requestHash);
    if (resolved?.outcome === "replay") {
      return { type: "replay", result: resolved.responseBody as TResponse };
    }
    // Different payload for the same key, or the record vanished again
    // (expiry race) — either way this request must not create anything.
    return { type: "conflict" };
  }
}

/** Clean up expired idempotency records. Run periodically. */
export async function cleanupExpiredIdempotency(): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
