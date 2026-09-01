import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";

/**
 * GET /v1/allocations
 *
 * List applied allocations across payments.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const paymentId = url.searchParams.get("paymentId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);

  const where: Record<string, unknown> = {
    payment: {
      applicationId: ctx.application.id,
      environment: ctx.environment,
    },
  };

  if (paymentId) {
    where.paymentId = paymentId;
  }

  const allocations = await prisma.allocation.findMany({
    where,
    include: {
      account: true,
      allocationRule: true,
      payment: {
        select: {
          id: true,
          reference: true,
          amountMinor: true,
          status: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return Response.json({
    data: allocations.map((a) => ({
      id: a.id,
      paymentId: a.paymentId,
      paymentReference: a.payment.reference,
      paymentAmountMinor: a.payment.amountMinor.toString(),
      ruleName: a.allocationRule?.name ?? "Custom Split",
      accountCode: a.account.code,
      accountName: a.account.name,
      accountType: a.account.type,
      amountMinor: a.amountMinor.toString(),
      currency: a.currency,
      percentage: a.percentage,
      roundingApplied: a.roundingApplied,
      createdAt: a.createdAt.toISOString(),
    })),
    meta: { requestId: ctx.requestId, environment: ctx.environment },
  });
}
