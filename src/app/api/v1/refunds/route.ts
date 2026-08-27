import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createRefund, listRefunds } from "@/lib/refunds";
import { parseAmountMinor } from "@/lib/money";
import { z } from "zod";

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
  });
  if (!parsedQuery.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid query parameters.",
      status: 422,
      details: parsedQuery.error.flatten().fieldErrors,
    });
  }

  const refunds = await listRefunds(
    ctx.application.id,
    ctx.environment,
    parsedQuery.data,
  );

  return Response.json(
    {
      data: refunds,
      pagination: { limit: parsedQuery.data.limit },
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
