import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createPayout, listPayouts } from "@/lib/payouts";
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

const createPayoutSchema = z.object({
  amountMinor: amountMinorSchema,
  currency: z
    .string()
    .length(3)
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase ISO code.")
    .default("KES"),
  recipientPhone: z
    .string()
    .regex(
      /^(\+?254)(7|1)\d{8}$/,
      "recipientPhone must be a Kenyan MSISDN (2547XXXXXXXX / 2541XXXXXXXX).",
    ),
  recipientName: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  reference: z.string().max(200).optional(),
});

const listPayoutsQuerySchema = z.object({
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
 * GET /v1/payouts — list payouts for the authenticated application's
 * environment, newest first (deterministic createdAt DESC, id DESC cursor
 * pagination). Requires `payouts:read` scope. Invalid query params → 422.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payouts:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payouts:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parsedQuery = listPayoutsQuerySchema.safeParse({
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

  const result = await listPayouts(ctx.application.id, ctx.environment, parsedQuery.data);
  if (!result.ok) {
    return apiError({ code: result.code, message: result.error, status: 400 });
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
 * POST /v1/payouts — create a payout (PENDING; provider dispatch is a
 * separate guarded step).
 *
 * IDEMPOTENCY: send an `Idempotency-Key` header (recommended) or an
 * `idempotencyKey` body field. The key is scoped to (application,
 * environment).
 *   - Same key + same payload → the original result (201, `Idempotent-Replay: true`).
 *   - Same key + different payload → 409 IDEMPOTENCY_CONFLICT, nothing created.
 *   - Concurrent duplicates → exactly one payout; the loser replays or conflicts.
 *
 * Requires `payouts:create` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payouts:create"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payouts:create");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createPayoutSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid payout request.",
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

  const result = await createPayout({
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
      data: result.payout,
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
