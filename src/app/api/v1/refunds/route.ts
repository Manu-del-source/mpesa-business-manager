import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createRefund } from "@/lib/refunds";
import { prisma } from "@/lib/prisma";
import { parseAmountMinor } from "@/lib/money";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const amountMinorSchema = z
  .union([z.string(), z.number()])
  .refine(
    (value) => parseAmountMinor(value).ok,
    (value) => ({
      message:
        "amountMinor must be a positive integer in minor units, provided as a " +
        `decimal string or a safe integer (got ${JSON.stringify(value)}).`,
    }),
  )
  .transform((value) => parseAmountMinor(value))
  .refine((result) => result.ok, { message: "Invalid amount." })
  .transform((result) => (result.ok ? result.amountMinor : 0n));

const createRefundSchema = z.object({
  paymentId: z.string().min(1, "paymentId is required."),
  amountMinor: amountMinorSchema,
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase ISO code.")
    .optional(),
  reason: z.string().min(1).max(500).optional(),
  reference: z.string().max(200).optional(),
});

const listRefundsQuerySchema = z.object({
  paymentId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"]).optional(),
  limit: z.coerce
    .number({ invalid_type_error: "limit must be an integer between 1 and 100." })
    .int("limit must be an integer between 1 and 100.")
    .min(1, "limit must be an integer between 1 and 100.")
    .max(100, "limit must be an integer between 1 and 100.")
    .default(50),
  cursor: z.string().min(1).max(1024).optional(),
});

/**
 * GET /v1/refunds — list refunds for the authenticated application's
 * environment (optionally filtered by paymentId). Requires `payments:read`.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parsedQuery = listRefundsQuerySchema.safeParse({
    paymentId: url.searchParams.get("paymentId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!parsedQuery.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid query parameters.",
      status: 422,
      details: parsedQuery.error.flatten().fieldErrors,
    });
  }

  const { paymentId, status, limit, cursor } = parsedQuery.data;

  // Always scoped to the server-resolved application + environment, so a
  // cursor or filter can never reach another tenant's refunds.
  const where: Prisma.RefundWhereInput = {
    applicationId: ctx.application.id,
    environment: ctx.environment,
  };
  if (status) where.status = status;
  if (paymentId) where.paymentId = paymentId;

  if (cursor) {
    // Resolve the cursor WITHIN the caller's scope — an id belonging to
    // another application must not be usable as a pagination anchor.
    const cursorItem = await prisma.refund.findFirst({
      where: {
        id: cursor,
        applicationId: ctx.application.id,
        environment: ctx.environment,
      },
      select: { id: true, createdAt: true },
    });
    if (!cursorItem) {
      return apiError({
        code: "VALIDATION_ERROR",
        message: "Invalid pagination cursor.",
        status: 422,
      });
    }
    where.OR = [
      { createdAt: { lt: cursorItem.createdAt } },
      { createdAt: cursorItem.createdAt, id: { lt: cursorItem.id } },
    ];
  }

  const refunds = await prisma.refund.findMany({
    where,
    include: {
      payment: {
        select: {
          id: true,
          reference: true,
          amountMinor: true,
          phone: true,
          customerName: true,
          status: true,
        },
      },
    },
    // Deterministic ordering: createdAt DESC, id DESC (matches the cursor).
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = refunds.length > limit;
  const page = hasMore ? refunds.slice(0, limit) : refunds;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return Response.json(
    {
      data: page.map((r) => ({
        id: r.id,
        paymentId: r.paymentId,
        paymentReference: r.payment.reference,
        paymentAmountMinor: r.payment.amountMinor.toString(),
        paymentStatus: r.payment.status,
        customerPhone: r.payment.phone,
        customerName: r.payment.customerName,
        status: r.status,
        amountMinor: r.amountMinor.toString(),
        currency: r.currency,
        reason: r.reason,
        reference: r.reference,
        idempotencyKey: r.idempotencyKey,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
        processedAt: r.processedAt?.toISOString() ?? null,
      })),
      pagination: { hasMore, nextCursor, limit },
      meta: {
        requestId: ctx.requestId,
        environment: ctx.environment,
        application: ctx.application.slug,
      },
    },
    { headers: { "x-request-id": ctx.requestId } },
  );
}

/**
 * POST /v1/refunds — create a refund against a SUCCEEDED payment.
 *
 * The refundable-balance check runs inside a row-locked transaction, so
 * concurrent refunds can never over-refund a payment.
 *
 * IDEMPOTENCY: send an `Idempotency-Key` header (recommended) or an
 * `idempotencyKey` body field. Key scope: (application, environment).
 *   - Same key + same payload → the original result (201, `Idempotent-Replay: true`).
 *   - Same key + different payload → 409 IDEMPOTENCY_CONFLICT, nothing created.
 *   - Concurrent duplicates → exactly one refund; the loser replays or conflicts.
 *   - The FIRST execution's result is cached under the key — including
 *     refundability errors (NOT_REFUNDABLE / AMOUNT_EXCEEDS_REFUNDABLE) —
 *     because they depend on database state at execution time.
 *
 * Requires `payments:refund` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:refund"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:refund");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createRefundSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid refund request.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const headerKey = request.headers.get("idempotency-key");
  if (headerKey !== null && (headerKey.length < 1 || headerKey.length > 200)) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Idempotency-Key header must be between 1 and 200 characters.",
      status: 422,
    });
  }
  const idempotencyKey = headerKey?.trim() || undefined;

  const result = await createRefund({
    applicationId: ctx.application.id,
    environment: ctx.environment,
    ...parsed.data,
    idempotencyKey,
  });

  if (!result.ok) {
    const status =
      result.code === "IDEMPOTENCY_CONFLICT"
        ? 409
        : result.code === "NOT_FOUND"
          ? 404
          : 400;
    return Response.json(
      {
        error: {
          code: result.code,
          message: result.error,
          requestId: ctx.requestId,
        },
      },
      { status, headers: { "x-request-id": ctx.requestId } },
    );
  }

  return Response.json(
    {
      data: result.refund,
      meta: {
        requestId: ctx.requestId,
        idempotentReplay: result.replayed === true,
      },
    },
    {
      status: 201,
      headers: {
        "x-request-id": ctx.requestId,
        ...(result.replayed === true ? { "Idempotent-Replay": "true" } : {}),
      },
    },
  );
}
