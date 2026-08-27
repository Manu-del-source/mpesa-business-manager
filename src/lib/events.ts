import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { Environment } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventData = {
  applicationId: string;
  environment: Environment;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type OutboxData = {
  applicationId: string;
  environment: Environment;
  eventType: string;
  payload: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Event store
// ---------------------------------------------------------------------------

/**
 * Record an event in the event store. Events are append-only and immutable.
 */
export async function recordEvent(data: EventData) {
  return prisma.event.create({
    data: {
      applicationId: data.applicationId,
      environment: data.environment,
      type: data.type,
      aggregateType: data.aggregateType,
      aggregateId: data.aggregateId,
      payload: data.payload as never,
      metadata: (data.metadata as never) ?? null,
    },
  });
}

/**
 * List events for an aggregate (e.g., all events for a specific payment).
 */
export async function listEventsForAggregate(
  applicationId: string,
  aggregateType: string,
  aggregateId: string,
  limit = 50,
) {
  return prisma.event.findMany({
    where: { applicationId, aggregateType, aggregateId },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

/**
 * List recent events of a specific type.
 */
export async function listEventsByType(
  applicationId: string,
  environment: Environment,
  type: string,
  limit = 50,
) {
  return prisma.event.findMany({
    where: { applicationId, environment, type },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Transactional outbox
// ---------------------------------------------------------------------------

/**
 * Enqueue an event for reliable delivery. The outbox record is created
 * in the same transaction as the business operation to guarantee at-least-once
 * delivery.
 */
export async function enqueueEvent(data: OutboxData) {
  return prisma.outboxRecord.create({
    data: {
      applicationId: data.applicationId,
      environment: data.environment,
      eventType: data.eventType,
      payload: data.payload as never,
      status: "PENDING",
      nextRetryAt: new Date(),
    },
  });
}

/**
 * Claim the next batch of due outbox records for processing.
 *
 * Race-safe on PostgreSQL: rows are selected FOR UPDATE SKIP LOCKED inside a
 * short transaction and flipped to PROCESSING, so concurrent workers never
 * claim the same record (the previous find-then-update implementation could
 * double-process). Records that exceed maxAttempts are not claimed (their
 * terminal FAILED status is set by markFailed).
 */
export async function claimOutboxRecords(
  applicationId: string,
  environment: Environment,
  batchSize = 10,
) {
  return claimDueOutboxRecords({ applicationId, environment, batchSize });
}

/**
 * Claim due outbox records across ALL applications (worker/cron entry point).
 * Same FOR UPDATE SKIP LOCKED semantics as claimOutboxRecords.
 */
export async function claimDueOutboxRecords(
  options?: {
    applicationId?: string;
    environment?: Environment;
    /** Only claim records whose eventType starts with this prefix (e.g. "settlement."). */
    eventTypePrefix?: string;
    batchSize?: number;
  },
): Promise<OutboxRecord[]> {
  const batchSize = Math.min(Math.max(options?.batchSize ?? 10, 1), 100);
  const appFilter = options?.applicationId
    ? Prisma.sql`AND "applicationId" = ${options.applicationId}`
    : Prisma.empty;
  const envFilter = options?.environment
    ? Prisma.sql`AND environment = ${options.environment}::"Environment"`
    : Prisma.empty;
  const typeFilter = options?.eventTypePrefix
    ? Prisma.sql`AND "eventType" LIKE ${options.eventTypePrefix + "%"}`
    : Prisma.empty;

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "OutboxRecord"
      WHERE status = 'PENDING'
        AND attempts < "maxAttempts"
        AND ("nextRetryAt" IS NULL OR "nextRetryAt" <= now())
        ${appFilter}
        ${envFilter}
        ${typeFilter}
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    // Guarded claim: only still-PENDING rows flip to PROCESSING.
    const claimed = await tx.outboxRecord.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) return [];

    return tx.outboxRecord.findMany({
      where: { id: { in: ids }, status: "PROCESSING" },
      orderBy: { createdAt: "asc" },
    });
  });
}

/** Outbox record shape (re-exported for processors/workers). */
export type OutboxRecord = {
  id: string;
  applicationId: string;
  environment: Environment;
  eventType: string;
  payload: Prisma.JsonValue;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  dispatchedAt: Date | null;
};

/**
 * Release a claimed record back to PENDING (e.g. a processor crashed before
 * finishing; the row-level lock ends with the transaction).
 */
export async function releaseOutboxRecord(recordId: string): Promise<void> {
  await prisma.outboxRecord.updateMany({
    where: { id: recordId, status: "PROCESSING" },
    data: { status: "PENDING" },
  });
}

/**
 * Mark an outbox record as dispatched (successfully delivered).
 */
export async function markDispatched(recordId: string) {
  return prisma.outboxRecord.update({
    where: { id: recordId },
    data: {
      status: "DISPATCHED",
      dispatchedAt: new Date(),
    },
  });
}

/**
 * Mark a claimed outbox record as failed and schedule a retry with
 * exponential backoff. After maxAttempts the record becomes FAILED
 * (terminal — requires manual investigation/reconciliation); the error is
 * truncated and stored for diagnosis.
 */
export async function markFailed(recordId: string, error: string) {
  const record = await prisma.outboxRecord.findUnique({ where: { id: recordId } });
  if (!record) return;
  // Never overwrite a record that was already dispatched by another path.
  if (record.status === "DISPATCHED") return record;

  const attempts = record.attempts + 1;

  if (attempts >= record.maxAttempts) {
    // Permanently failed — loud for operations.
    return prisma.outboxRecord.update({
      where: { id: recordId },
      data: {
        status: "FAILED",
        attempts,
        lastError: error.slice(0, 1000),
      },
    });
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, ...
  const delayMs = Math.min(1000 * Math.pow(2, attempts), 60_000);
  return prisma.outboxRecord.update({
    where: { id: recordId },
    data: {
      status: "PENDING",
      attempts,
      lastError: error.slice(0, 1000),
      nextRetryAt: new Date(Date.now() + delayMs),
    },
  });
}

/**
 * Get outbox statistics for monitoring.
 */
export async function getOutboxStats(applicationId: string, environment: Environment) {
  const [pending, dispatched, failed] = await Promise.all([
    prisma.outboxRecord.count({ where: { applicationId, environment, status: "PENDING" } }),
    prisma.outboxRecord.count({ where: { applicationId, environment, status: "DISPATCHED" } }),
    prisma.outboxRecord.count({ where: { applicationId, environment, status: "FAILED" } }),
  ]);
  return { pending, dispatched, failed, total: pending + dispatched + failed };
}

/**
 * Clean up old dispatched outbox records (older than retention period).
 */
export async function cleanupOutboxRecords(applicationId: string, environment: Environment, retentionMs = 7 * 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - retentionMs);
  const result = await prisma.outboxRecord.deleteMany({
    where: {
      applicationId,
      environment,
      status: "DISPATCHED",
      dispatchedAt: { lt: cutoff },
    },
  });
  return result.count;
}
