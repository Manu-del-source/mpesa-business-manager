/**
 * Usage tracking — records API calls and financial operations for metering
 * and billing purposes.
 *
 * Usage records are aggregated periodically and used for billing.
 *
 * @module lib/usage
 */

import "server-only";

import { prisma } from "./prisma";
import type { Environment, Prisma } from "../generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsageMetric =
  | "payments.initiated"
  | "payments.succeeded"
  | "payments.failed"
  | "payouts.initiated"
  | "payouts.succeeded"
  | "payouts.failed"
  | "refunds.initiated"
  | "refunds.succeeded"
  | "refunds.failed"
  | "api_calls"
  | "webhook_deliveries"
  | "reconciliation_runs";

export interface RecordUsageOptions {
  applicationId: string;
  environment: Environment;
  metric: UsageMetric;
  quantity?: number;
  metadata?: Record<string, unknown>;
}

export interface UsageSummary {
  metric: string;
  total: number;
  periodStart: Date;
  periodEnd: Date;
}

// ---------------------------------------------------------------------------
// Record usage
// ---------------------------------------------------------------------------

/**
 * Record a usage event. Deduplicates by (applicationId, environment, metric,
 * periodStart) — increments quantity on subsequent calls.
 */
export async function recordUsage(
  options: RecordUsageOptions,
): Promise<void> {
  const now = new Date();
  const periodStart = getPeriodStart(now);
  const periodEnd = getPeriodEnd(now);

  // Upsert: increment if record exists for this period
  await prisma.usageRecord.upsert({
    where: {
      // Composite unique doesn't exist — use a manual approach
      id: `${options.applicationId}:${options.environment}:${options.metric}:${periodStart.getTime()}`,
    },
    create: {
      applicationId: options.applicationId,
      environment: options.environment,
      metric: options.metric,
      quantity: options.quantity ?? 1,
      metadata: (options.metadata ?? undefined) as Prisma.InputJsonValue,
      periodStart,
      periodEnd,
    },
    update: {
      quantity: { increment: options.quantity ?? 1 },
    },
  });
}

/**
 * Simple usage recording without upsert (always creates a new record).
 * Preferred for high-volume metrics where dedup isn't needed.
 */
export async function recordUsageSimple(
  options: RecordUsageOptions,
): Promise<void> {
  const now = new Date();
  await prisma.usageRecord.create({
    data: {
      applicationId: options.applicationId,
      environment: options.environment,
      metric: options.metric,
      quantity: options.quantity ?? 1,
      metadata: (options.metadata ?? undefined) as Prisma.InputJsonValue,
      periodStart: getPeriodStart(now),
      periodEnd: getPeriodEnd(now),
    },
  });
}

// ---------------------------------------------------------------------------
// Query usage
// ---------------------------------------------------------------------------

/**
 * Get usage summary for a specific metric over a time range.
 */
export async function getUsageSummary(
  applicationId: string,
  metric: string,
  since: Date,
  until: Date,
): Promise<UsageSummary[]> {
  const records = await prisma.usageRecord.findMany({
    where: {
      applicationId,
      metric,
      periodStart: { gte: since },
      periodEnd: { lte: until },
    },
    orderBy: { periodStart: "asc" },
  });

  // Group by period
  const grouped = new Map<string, { total: number; periodStart: Date; periodEnd: Date }>();
  for (const record of records) {
    const key = record.periodStart.getTime().toString();
    const existing = grouped.get(key);
    if (existing) {
      existing.total += record.quantity;
    } else {
      grouped.set(key, {
        total: record.quantity,
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
      });
    }
  }

  return Array.from(grouped.values()).map((g) => ({
    metric,
    total: g.total,
    periodStart: g.periodStart,
    periodEnd: g.periodEnd,
  }));
}

/**
 * Get total usage for a metric across all periods.
 */
export async function getTotalUsage(
  applicationId: string,
  metric: string,
  since: Date,
  until: Date,
): Promise<number> {
  const result = await prisma.usageRecord.aggregate({
    where: {
      applicationId,
      metric,
      periodStart: { gte: since },
      periodEnd: { lte: until },
    },
    _sum: { quantity: true },
  });

  return result._sum.quantity ?? 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the start of the current billing period (first day of the month).
 */
export function getPeriodStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Get the end of the current billing period (last day of the month).
 */
export function getPeriodEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}
