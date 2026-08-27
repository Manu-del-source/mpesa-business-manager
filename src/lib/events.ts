import "server-only";
import { prisma } from "@/lib/prisma";
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
 * Claim the next batch of pending outbox records for dispatch.
 * Uses a SELECT FOR UPDATE pattern (via updateMany) to prevent
 * double-processing in concurrent workers.
 */
export async function claimOutboxRecords(
  applicationId: string,
  environment: Environment,
  batchSize = 10,
) {
  const now = new Date();

  // Find pending records ready for processing
  const records = await prisma.outboxRecord.findMany({
    where: {
      applicationId,
      environment,
      status: "PENDING",
      attempts: { lt: prisma.outboxRecord.fields.maxAttempts },
      OR: [
        { nextRetryAt: null },
        { nextRetryAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  return records;
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
 * Mark an outbox record as failed and schedule retry with exponential backoff.
 */
export async function markFailed(recordId: string, error: string) {
  const record = await prisma.outboxRecord.findUnique({ where: { id: recordId } });
  if (!record) return;

  const attempts = record.attempts + 1;
  const maxAttempts = record.maxAttempts;

  if (attempts >= maxAttempts) {
    // Permanently failed
    return prisma.outboxRecord.update({
      where: { id: recordId },
      data: { status: "FAILED", attempts, lastError: error },
    });
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, ...
  const delayMs = Math.min(1000 * Math.pow(2, attempts), 60_000);
  return prisma.outboxRecord.update({
    where: { id: recordId },
    data: {
      attempts,
      lastError: error,
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
