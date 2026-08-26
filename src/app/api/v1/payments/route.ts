import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";
import type { MpesaStatus } from "@/generated/prisma";

/**
 * GET /v1/payments
 *
 * List payments for the authenticated application's environment.
 * Requires a valid API key with `payments:read` scope.
 *
 * Query params:
 *   - status: filter by payment status (PENDING, SUCCESS, FAILED, etc.)
 *   - limit: max results (default 50, max 100)
 *   - cursor: pagination cursor (the id of the last item)
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, {
    requiredScopes: ["payments:read"],
  });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:read");
  if (permErr) return permErr;

  // Parse query params
  const url = new URL(request.url);
  const status = url.searchParams.get("status") as MpesaStatus | null;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
  const cursor = url.searchParams.get("cursor");

  // Build query — scoped to tenant's organizations
  const orgIds = await prisma.organization
    .findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true },
    })
    .then((orgs) => orgs.map((o) => o.id));

  const where: Record<string, unknown> = {
    organizationId: { in: orgIds },
  };

  if (status) {
    where.status = status;
  }

  if (cursor) {
    where.createdAt = { ...(where.createdAt as object ?? {}), lt: await getCursorDate(cursor) };
  }

  const transactions = await prisma.mpesaTransaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1, // Fetch one extra to determine if there are more
    select: {
      id: true,
      phone: true,
      amount: true,
      status: true,
      receiptNo: true,
      reference: true,
      direction: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const hasMore = transactions.length > limit;
  const data = hasMore ? transactions.slice(0, limit) : transactions;
  const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

  return Response.json({
    data: data.map((t) => ({
      id: t.id,
      phone: t.phone,
      amount: t.amount.toString(),
      status: t.status,
      receiptNo: t.receiptNo,
      reference: t.reference,
      direction: t.direction,
      createdAt: t.createdAt.toISOString(),
      completedAt: t.completedAt?.toISOString() ?? null,
    })),
    pagination: {
      hasMore,
      nextCursor,
      limit,
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
      application: ctx.application.slug,
    },
  });
}

async function getCursorDate(cursorId: string): Promise<Date> {
  const cursor = await prisma.mpesaTransaction.findUnique({
    where: { id: cursorId },
    select: { createdAt: true },
  });
  return cursor?.createdAt ?? new Date();
}
