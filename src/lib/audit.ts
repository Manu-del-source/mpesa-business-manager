/**
 * Audit Log — append-only record of all significant platform actions.
 *
 * Every financial state change, permission grant, API key creation, etc.
 * is recorded here. Rows are NEVER updated or deleted.
 *
 * @module lib/audit
 */

import "server-only";

import { prisma } from "./prisma";
import type { Environment, Prisma } from "../generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  applicationId: string;
  environment: Environment;
  actorId: string;
  actorType?: "user" | "api_key" | "system" | "webhook";
  action: string;
  targetType: string;
  targetId: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryOptions {
  applicationId: string;
  environment?: Environment;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Write (append-only)
// ---------------------------------------------------------------------------

/**
 * Append an entry to the audit log. This is the ONLY write path — there are
 * no update or delete operations.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      applicationId: entry.applicationId,
      environment: entry.environment,
      actorId: entry.actorId,
      actorType: entry.actorType ?? "user",
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      changes: (entry.changes ?? undefined) as Prisma.InputJsonValue,
      metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Log with correlation ID — convenience wrapper that injects the request ID
 * into metadata.
 */
export async function logAuditWithCorrelation(
  entry: AuditLogEntry,
  correlationId: string,
): Promise<void> {
  await logAudit({
    ...entry,
    metadata: {
      ...entry.metadata,
      correlationId,
    },
  });
}

// ---------------------------------------------------------------------------
// Read (query)
// ---------------------------------------------------------------------------

/**
 * Query audit log entries with filters. Returns entries newest-first.
 */
export async function queryAuditLog(options: AuditQueryOptions) {
  const {
    applicationId,
    environment,
    actorId,
    action,
    targetType,
    targetId,
    since,
    until,
    limit = 50,
    offset = 0,
  } = options;

  const where: Record<string, unknown> = { applicationId };

  if (environment) where.environment = environment;
  if (actorId) where.actorId = actorId;
  if (action) where.action = action;
  if (targetType) where.targetType = targetType;
  if (targetId) where.targetId = targetId;

  if (since || until) {
    where.createdAt = {
      ...(since ? { gte: since } : {}),
      ...(until ? { lte: until } : {}),
    };
  }

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { entries, total, limit, offset };
}

/**
 * Get audit trail for a specific entity.
 */
export async function getEntityAuditTrail(
  applicationId: string,
  targetType: string,
  targetId: string,
  limit = 100,
) {
  return prisma.auditLog.findMany({
    where: { applicationId, targetType, targetId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
