import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";
import { getAccountBalance } from "@/lib/ledger";

/**
 * GET /v1/accounts/:id
 *
 * Returns account details, computed balance, and recent ledger entries.
 * Requires `ledger:read` scope.
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

  const account = await prisma.account.findFirst({
    where: {
      id,
      applicationId: ctx.application.id,
      environment: ctx.environment,
    },
    include: {
      parent: true,
      children: true,
    },
  });

  if (!account) {
    return apiError({ code: "NOT_FOUND", message: "Account not found.", status: 404 });
  }

  const balance = await getAccountBalance(id);

  const entries = await prisma.ledgerEntry.findMany({
    where: { accountId: id },
    include: { journalTransaction: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({
    data: {
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      currency: account.currency,
      active: account.active,
      description: account.description,
      parentId: account.parentId,
      parentName: account.parent?.name ?? null,
      balance: balance
        ? {
            debitMinor: balance.debitMinor.toString(),
            creditMinor: balance.creditMinor.toString(),
            balanceMinor: balance.balanceMinor.toString(),
          }
        : null,
      entries: entries.map((e) => ({
        id: e.id,
        journalId: e.journalTransactionId,
        type: e.type,
        amountMinor: e.amountMinor.toString(),
        description: e.description || e.journalTransaction.description,
        reference: e.journalTransaction.reference,
        postedAt: e.journalTransaction.postedAt.toISOString(),
        voided: e.journalTransaction.voidedAt !== null,
      })),
      createdAt: account.createdAt.toISOString(),
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
    },
  });
}
