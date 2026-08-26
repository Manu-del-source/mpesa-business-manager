import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { Environment, PaymentDirection, PaymentStatus } from "@/generated/prisma";

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
  | { ok: true; payment: PaymentView }
  | { ok: false; error: string; code: string };

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
// State machine
// ---------------------------------------------------------------------------

/**
 * Valid state transitions for a Payment.
 * Each key is the current status; the value is the set of allowed next statuses.
 */
const VALID_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: ["REFUNDED"],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Check whether a state transition is valid.
 */
export function isValidTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get all valid transitions from a given status.
 */
export function getValidTransitions(status: PaymentStatus): PaymentStatus[] {
  return VALID_TRANSITIONS[status] ?? [];
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

/**
 * Check for an existing idempotent response. Returns the cached response
 * if the key exists and the request body matches.
 */
async function checkIdempotency(
  applicationId: string,
  environment: Environment,
  key: string,
  requestBody: unknown,
): Promise<{ status: number; body: unknown } | null> {
  const record = await prisma.idempotencyRecord.findUnique({
    where: {
      applicationId_environment_key: { applicationId, environment, key },
    },
  });

  if (!record) return null;

  // Check expiry
  if (record.expiresAt < new Date()) {
    await prisma.idempotencyRecord.delete({
      where: { id: record.id },
    });
    return null;
  }

  // Check request body matches
  const requestHash = hashRequest(requestBody);
  if (record.requestHash !== requestHash) {
    // Different payload with same key — this is a conflict
    return null; // Caller should handle this
  }

  return {
    status: record.responseStatus,
    body: record.responseBody,
  };
}

/**
 * Store an idempotent response for future retries.
 */
async function storeIdempotency(
  applicationId: string,
  environment: Environment,
  key: string,
  requestBody: unknown,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  const requestHash = hashRequest(requestBody);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h TTL

  await prisma.idempotencyRecord.upsert({
    where: {
      applicationId_environment_key: { applicationId, environment, key },
    },
    create: {
      applicationId,
      environment,
      key,
      requestHash,
      responseStatus,
      responseBody: responseBody as Prisma.InputJsonValue,
      expiresAt,
    },
    update: {
      requestHash,
      responseStatus,
      responseBody: responseBody as Prisma.InputJsonValue,
      expiresAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Payment creation
// ---------------------------------------------------------------------------

/**
 * Create a new payment. This is the entry point for all payment initiation.
 *
 * - If an idempotency key is provided and already processed, returns the
 *   cached response.
 * - Creates the Payment as PENDING (intent-before-network pattern).
 * - Returns the payment for the caller to dispatch to a provider.
 */
export async function createPayment(input: CreatePaymentInput): Promise<PaymentResult> {
  // Validate amount
  if (input.amountMinor <= 0n) {
    return { ok: false, error: "Amount must be positive.", code: "INVALID_AMOUNT" };
  }

  // Max KES 150,000 (15,000,000 minor units)
  if (input.amountMinor > 15_000_000n) {
    return {
      ok: false,
      error: "Amount must not exceed KSh 150,000.",
      code: "INVALID_AMOUNT",
    };
  }

  // Check idempotency
  if (input.idempotencyKey) {
    const cached = await checkIdempotency(
      input.applicationId,
      input.environment,
      input.idempotencyKey,
      input,
    );
    if (cached) {
      // Return cached response — this is a retry
      return cached.body as PaymentResult;
    }
  }

  // Create payment as PENDING
  const payment = await prisma.payment.create({
    data: {
      applicationId: input.applicationId,
      environment: input.environment,
      direction: input.direction ?? "INCOMING",
      status: "PENDING",
      amountMinor: input.amountMinor,
      currency: input.currency ?? "KES",
      phone: input.phone ?? null,
      email: input.email ?? null,
      customerName: input.customerName ?? null,
      description: input.description ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      reference: input.reference ?? null,
    },
  });

  const result: PaymentResult = {
    ok: true,
    payment: formatPayment(payment),
  };

  // Store idempotent response
  if (input.idempotencyKey) {
    await storeIdempotency(
      input.applicationId,
      input.environment,
      input.idempotencyKey,
      input,
      201,
      result,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Transition a payment to a new status. Validates the state machine
 * and creates a PaymentAttempt record.
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
    throw new Error(
      `Invalid transition: ${payment.status} → ${newStatus}. ` +
      `Valid transitions from ${payment.status}: ${getValidTransitions(payment.status).join(", ") || "none"}.`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Update payment status
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: newStatus,
        processedAt: ["SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED"].includes(newStatus)
          ? new Date()
          : undefined,
      },
    });

    // Create payment attempt if provider data provided
    if (attemptData) {
      await tx.paymentAttempt.create({
        data: {
          paymentId,
          provider: attemptData.provider,
          status: newStatus,
          providerRequestId: attemptData.providerRequestId ?? null,
          providerCheckoutId: attemptData.providerCheckoutId ?? null,
          providerResponse: attemptData.providerResponse as Prisma.InputJsonValue ?? null,
          errorCode: attemptData.errorCode ?? null,
          errorMessage: attemptData.errorMessage ?? null,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          completedAt: new Date(),
        },
      });
    }

    return updated;
  });

  return formatPayment(result);
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

/**
 * List payments for an application, with optional status filter.
 */
export async function listPayments(
  applicationId: string,
  environment: Environment,
  options?: { status?: PaymentStatus; limit?: number; cursor?: string },
): Promise<{ data: PaymentView[]; nextCursor: string | null }> {
  const limit = Math.min(options?.limit ?? 50, 100);

  const where: Record<string, unknown> = {
    applicationId,
    environment,
  };

  if (options?.status) {
    where.status = options.status;
  }

  if (options?.cursor) {
    const cursorPayment = await prisma.payment.findUnique({
      where: { id: options.cursor },
      select: { createdAt: true },
    });
    if (cursorPayment) {
      where.createdAt = { lt: cursorPayment.createdAt };
    }
  }

  const payments = await prisma.payment.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = payments.length > limit;
  const data = hasMore ? payments.slice(0, limit) : payments;
  const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

  return {
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
