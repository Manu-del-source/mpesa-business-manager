import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
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
// State machine
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

async function checkIdempotency(
  applicationId: string,
  environment: Environment,
  key: string,
  body: unknown,
): Promise<{ status: number; body: unknown } | null> {
  const record = await prisma.idempotencyRecord.findUnique({
    where: { applicationId_environment_key: { applicationId, environment, key } },
  });
  if (!record) return null;
  if (record.expiresAt < new Date()) {
    await prisma.idempotencyRecord.delete({ where: { id: record.id } });
    return null;
  }
  if (record.requestHash !== hashBody(body)) return null;
  return { status: record.responseStatus, body: record.responseBody };
}

async function storeIdempotency(
  applicationId: string,
  environment: Environment,
  key: string,
  body: unknown,
  responseStatus: number,
  responseBody: unknown,
) {
  await prisma.idempotencyRecord.upsert({
    where: { applicationId_environment_key: { applicationId, environment, key } },
    create: {
      applicationId, environment, key,
      requestHash: hashBody(body),
      responseStatus,
      responseBody: responseBody as never,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    update: {
      requestHash: hashBody(body),
      responseStatus,
      responseBody: responseBody as never,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

// ---------------------------------------------------------------------------
// Payout creation
// ---------------------------------------------------------------------------

export async function createPayout(input: CreatePayoutInput) {
  if (input.amountMinor <= 0n) {
    return { ok: false as const, error: "Amount must be positive.", code: "INVALID_AMOUNT" };
  }

  // Check idempotency
  if (input.idempotencyKey) {
    const cached = await checkIdempotency(input.applicationId, input.environment, input.idempotencyKey, input);
    if (cached) return cached.body;
  }

  const payout = await prisma.payout.create({
    data: {
      applicationId: input.applicationId,
      environment: input.environment,
      status: "PENDING",
      amountMinor: input.amountMinor,
      currency: input.currency ?? "KES",
      recipientPhone: input.recipientPhone,
      recipientName: input.recipientName ?? null,
      description: input.description ?? null,
      reference: input.reference ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });

  const result = { ok: true as const, payout: formatPayout(payout) };

  if (input.idempotencyKey) {
    await storeIdempotency(input.applicationId, input.environment, input.idempotencyKey, input, 201, result);
  }

  return result;
}

export async function transitionPayout(
  payoutId: string,
  newStatus: PayoutStatus,
  errorData?: { errorCode?: string; errorMessage?: string },
): Promise<PayoutView | null> {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return null;

  if (!isValidTransition(payout.status, newStatus)) {
    throw new Error(`Invalid transition: ${payout.status} → ${newStatus}`);
  }

  const updated = await prisma.payout.update({
    where: { id: payoutId },
    data: {
      status: newStatus,
      processedAt: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(newStatus) ? new Date() : undefined,
      errorCode: errorData?.errorCode ?? undefined,
      errorMessage: errorData?.errorMessage ?? undefined,
    },
  });

  return formatPayout(updated);
}

export async function getPayout(payoutId: string, applicationId: string): Promise<PayoutView | null> {
  const payout = await prisma.payout.findFirst({ where: { id: payoutId, applicationId } });
  return payout ? formatPayout(payout) : null;
}

export async function listPayouts(
  applicationId: string,
  environment: Environment,
  options?: { status?: PayoutStatus; limit?: number; cursor?: string },
) {
  const limit = Math.min(options?.limit ?? 50, 100);
  const where: Record<string, unknown> = { applicationId, environment };
  if (options?.status) where.status = options.status;
  if (options?.cursor) {
    const cursor = await prisma.payout.findUnique({ where: { id: options.cursor }, select: { createdAt: true } });
    if (cursor) where.createdAt = { lt: cursor.createdAt };
  }
  const payouts = await prisma.payout.findMany({ where, orderBy: { createdAt: "desc" }, take: limit + 1 });
  const hasMore = payouts.length > limit;
  const data = hasMore ? payouts.slice(0, limit) : payouts;
  return { data: data.map(formatPayout), nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null };
}

function formatPayout(p: {
  id: string; status: PayoutStatus; amountMinor: bigint; currency: string;
  recipientPhone: string; recipientName: string | null; description: string | null;
  reference: string | null; idempotencyKey: string | null; errorCode: string | null;
  errorMessage: string | null; createdAt: Date; processedAt: Date | null;
}): PayoutView {
  return {
    id: p.id, status: p.status, amountMinor: p.amountMinor.toString(), currency: p.currency,
    recipientPhone: p.recipientPhone, recipientName: p.recipientName, description: p.description,
    reference: p.reference, idempotencyKey: p.idempotencyKey, errorCode: p.errorCode,
    errorMessage: p.errorMessage, createdAt: p.createdAt.toISOString(),
    processedAt: p.processedAt?.toISOString() ?? null,
  };
}
