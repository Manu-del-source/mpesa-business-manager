import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createPayment, listPayments } from "@/lib/payments";
import { z } from "zod";
import type { PaymentStatus } from "@/generated/prisma";

const createPaymentSchema = z.object({
  amountMinor: z.number().int().positive().max(15_000_000),
  currency: z.string().default("KES"),
  direction: z.enum(["INCOMING", "OUTGOING"]).default("INCOMING"),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  customerName: z.string().optional(),
  description: z.string().max(500).optional(),
  idempotencyKey: z.string().max(200).optional(),
  reference: z.string().max(200).optional(),
});

/**
 * GET /v1/payments
 *
 * List payments for the authenticated application's environment.
 * Requires `payments:read` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as PaymentStatus | null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
  const cursor = url.searchParams.get("cursor");

  const result = await listPayments(ctx.application.id, ctx.environment, {
    status: status ?? undefined,
    limit,
    cursor: cursor ?? undefined,
  });

  return Response.json({
    data: result.data,
    pagination: {
      hasMore: result.nextCursor !== null,
      nextCursor: result.nextCursor,
      limit,
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
      application: ctx.application.slug,
    },
  });
}

/**
 * POST /v1/payments
 *
 * Create a new payment. Idempotent when idempotencyKey is provided.
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

  const result = await createPayment({
    applicationId: ctx.application.id,
    environment: ctx.environment,
    ...parsed.data,
  });

  if (!result.ok) {
    return apiError({ code: result.code, message: result.error, status: 400 });
  }

  return Response.json(
    {
      data: result.payment,
      meta: { requestId: ctx.requestId },
    },
    { status: 201 },
  );
}
