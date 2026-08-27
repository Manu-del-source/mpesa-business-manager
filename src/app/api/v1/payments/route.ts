import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createPayment, listPayments } from "@/lib/payments";
import { parseAmountMinor } from "@/lib/money";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Amount in minor units. Decimal strings are the canonical wire format
 * ("1549"); JSON numbers are accepted only when they are safe integers —
 * anything that would lose precision is rejected, never rounded.
 */
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

const createPaymentSchema = z.object({
  amountMinor: amountMinorSchema,
  currency: z
    .string()
    .length(3, "Currency must be a 3-letter ISO code (e.g. \"KES\").")
    .regex(/^[A-Z]{3}$/, "Currency must be uppercase letters only (e.g. \"KES\").")
    .default("KES"),
  direction: z.enum(["INCOMING", "OUTGOING"]).default("INCOMING"),
  phone: z
    .string()
    .regex(/^\+?[0-9]{9,15}$/, "Phone must be a valid phone number (e.g. \"+2547XXXXXXXX\").")
    .optional(),
  email: z.string().email().optional(),
  customerName: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  reference: z.string().max(200).optional(),
});

const listPaymentsQuerySchema = z.object({
  status: z
    .enum([
      "PENDING",
      "PROCESSING",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
      "REFUNDED",
    ])
    .optional(),
  limit: z.coerce
    .number({ invalid_type_error: "limit must be an integer between 1 and 100." })
    .int("limit must be an integer between 1 and 100.")
    .min(1, "limit must be an integer between 1 and 100.")
    .max(100, "limit must be an integer between 1 and 100.")
    .default(50),
  cursor: z.string().min(1).max(1024).optional(),
});

/**
 * GET /v1/payments — list payments for the authenticated application's
 * environment, newest first (deterministic createdAt DESC, id DESC cursor
 * pagination).
 *
 * Requires `payments:read` scope. Invalid query parameters → 422.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const rawQuery = {
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  };
  const parsedQuery = listPaymentsQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid query parameters.",
      status: 422,
      details: parsedQuery.error.flatten().fieldErrors,
    });
  }

  const result = await listPayments(
    ctx.application.id,
    ctx.environment,
    parsedQuery.data,
  );

  if (!result.ok) {
    return apiError({
      code: result.code,
      message: result.error,
      status: 400,
    });
  }

  return Response.json(
    {
      data: result.data,
      pagination: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor,
        limit: parsedQuery.data.limit,
      },
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
 * POST /v1/payments — create a payment intent.
 *
 * IDEMPOTENCY: send an `Idempotency-Key` header (recommended) or an
 * `idempotencyKey` body field. The key is scoped to (application,
 * environment).
 *   - Same key + same payload → the original result is returned again
 *     (201, with `Idempotent-Replay: true`).
 *   - Same key + different payload → 409 IDEMPOTENCY_CONFLICT and NO
 *     payment is created.
 *   - Concurrent duplicates → exactly one payment is created; the loser
 *     receives the winner's result (replay) or a conflict.
 *
 * Requires `payments:create` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:create"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:create");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid payment request.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  // Idempotency-Key header takes precedence over the body field.
  const headerKey = request.headers.get("idempotency-key");
  if (headerKey !== null && (headerKey.length < 1 || headerKey.length > 200)) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Idempotency-Key header must be between 1 and 200 characters.",
      status: 422,
    });
  }
  const idempotencyKey = headerKey?.trim() || undefined;

  const result = await createPayment({
    applicationId: ctx.application.id,
    environment: ctx.environment,
    ...parsed.data,
    idempotencyKey,
  });

  if (!result.ok) {
    const status = result.code === "IDEMPOTENCY_CONFLICT" ? 409 : 400;
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
      data: result.payment,
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
