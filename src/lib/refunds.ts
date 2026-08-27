import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
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

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

async function checkIdempotency(applicationId: string, environment: Environment, key: string, body: unknown) {
  const record = await prisma.idempotencyRecord.findUnique({
    where: { applicationId_environment_key: { applicationId, environment, key } },
  });
  if (!record) return null;
  if (record.expiresAt < new Date()) { await prisma.idempotencyRecord.delete({ where: { id: record.id } }); return null; }
  if (record.requestHash !== hashBody(body)) return null;
  return { status: record.responseStatus, body: record.responseBody };
}

async function storeIdempotency(applicationId: string, environment: Environment, key: string, body: unknown, responseStatus: number, responseBody: unknown) {
  await prisma.idempotencyRecord.upsert({
    where: { applicationId_environment_key: { applicationId, environment, key } },
    create: { applicationId, environment, key, requestHash: hashBody(body), responseStatus, responseBody: responseBody as never, expiresAt: new Date(Date.now() + 86400000) },
    update: { requestHash: hashBody(body), responseStatus, responseBody: responseBody as never, expiresAt: new Date(Date.now() + 86400000) },
  });
}

// ---------------------------------------------------------------------------
// Refund creation
// ---------------------------------------------------------------------------

export async function createRefund(input: CreateRefundInput) {
  if (input.amountMinor <= 0n) {
    return { ok: false as const, error: "Refund amount must be positive.", code: "INVALID_AMOUNT" };
  }

  // Validate payment exists and is refundable
  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId, applicationId: input.applicationId, environment: input.environment },
  });
  if (!payment) return { ok: false as const, error: "Payment not found.", code: "NOT_FOUND" };
  if (payment.status !== "SUCCEEDED") {
    return { ok: false as const, error: "Only successful payments can be refunded.", code: "NOT_REFUNDABLE" };
  }

  // Check total refundable amount
  const existingRefunds = await prisma.refund.aggregate({
    where: { paymentId: input.paymentId, status: { in: ["SUCCEEDED", "PENDING", "PROCESSING"] } },
    _sum: { amountMinor: true },
  });
  const alreadyRefunded = existingRefunds._sum.amountMinor ?? 0n;
  const refundable = payment.amountMinor - alreadyRefunded;

  if (input.amountMinor > refundable) {
    return {
      ok: false as const,
      error: `Refund amount (${input.amountMinor}) exceeds refundable balance (${refundable}).`,
      code: "AMOUNT_EXCEEDS_REFUNDABLE",
    };
  }

  // Check idempotency
  if (input.idempotencyKey) {
    const cached = await checkIdempotency(input.applicationId, input.environment, input.idempotencyKey, input);
    if (cached) return cached.body;
  }

  const refund = await prisma.refund.create({
    data: {
      applicationId: input.applicationId,
      environment: input.environment,
      paymentId: input.paymentId,
      status: "PENDING",
      amountMinor: input.amountMinor,
      currency: input.currency ?? "KES",
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });

  const result = { ok: true as const, refund: formatRefund(refund) };

  if (input.idempotencyKey) {
    await storeIdempotency(input.applicationId, input.environment, input.idempotencyKey, input, 201, result);
  }

  return result;
}

export async function transitionRefund(refundId: string, newStatus: RefundStatus, errorData?: { errorCode?: string; errorMessage?: string }): Promise<RefundView | null> {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund) return null;
  if (!isValidRefundTransition(refund.status, newStatus)) throw new Error(`Invalid transition: ${refund.status} → ${newStatus}`);
  const updated = await prisma.refund.update({
    where: { id: refundId },
    data: {
      status: newStatus,
      processedAt: ["SUCCEEDED", "FAILED", "CANCELLED"].includes(newStatus) ? new Date() : undefined,
      errorCode: errorData?.errorCode ?? undefined,
      errorMessage: errorData?.errorMessage ?? undefined,
    },
  });
  return formatRefund(updated);
}

export async function getRefund(refundId: string, applicationId: string): Promise<RefundView | null> {
  const refund = await prisma.refund.findFirst({ where: { id: refundId, applicationId } });
  return refund ? formatRefund(refund) : null;
}

export async function getRefundableAmount(paymentId: string, applicationId: string): Promise<bigint | null> {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, applicationId } });
  if (!payment || payment.status !== "SUCCEEDED") return null;
  const existingRefunds = await prisma.refund.aggregate({
    where: { paymentId, status: { in: ["SUCCEEDED", "PENDING", "PROCESSING"] } },
    _sum: { amountMinor: true },
  });
  return payment.amountMinor - (existingRefunds._sum.amountMinor ?? 0n);
}

function formatRefund(r: {
  id: string; status: RefundStatus; paymentId: string; amountMinor: bigint; currency: string;
  reason: string | null; reference: string | null; idempotencyKey: string | null;
  errorCode: string | null; errorMessage: string | null; createdAt: Date; processedAt: Date | null;
}): RefundView {
  return {
    id: r.id, status: r.status, paymentId: r.paymentId, amountMinor: r.amountMinor.toString(),
    currency: r.currency, reason: r.reason, reference: r.reference, idempotencyKey: r.idempotencyKey,
    errorCode: r.errorCode, errorMessage: r.errorMessage, createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
  };
}
