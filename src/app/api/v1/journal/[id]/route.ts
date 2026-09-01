import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";

/**
 * GET /v1/journal/:id
 *
 * Get specific journal transaction details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:read");
  if (permErr) return permErr;

  const { id } = await params;

  const tx = await prisma.journalTransaction.findFirst({
    where: {
      id,
      applicationId: ctx.application.id,
      environment: ctx.environment,
    },
    include: {
      entries: {
        include: { account: true },
      },
    },
  });

  if (!tx) {
    return apiError({ code: "NOT_FOUND", message: "Journal transaction not found.", status: 404 });
  }

  return Response.json({
    data: {
      id: tx.id,
      description: tx.description,
      reference: tx.reference,
      postedAt: tx.postedAt.toISOString(),
      voidedAt: tx.voidedAt?.toISOString() ?? null,
      voidedBy: tx.voidedBy,
      voidReason: tx.voidReason,
      entries: tx.entries.map((e) => ({
        id: e.id,
        accountId: e.accountId,
        accountCode: e.account.code,
        accountName: e.account.name,
        accountType: e.account.type,
        type: e.type,
        amountMinor: e.amountMinor.toString(),
        currency: e.currency,
        description: e.description,
      })),
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
    },
  });
}
