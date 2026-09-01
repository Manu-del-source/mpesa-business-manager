import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { reverseJournalEntry, LedgerValidationError } from "@/lib/ledger";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const voidSchema = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * POST /v1/journal/:id/void
 *
 * "Voids" a journal entry by posting a COMPENSATING reversal journal with
 * inverted debits/credits. The original entries are never mutated or deleted
 * — both journals stay in the audit trail and balances reflect the net
 * effect. This is the ledger's only correction mechanism.
 *
 * Requires `ledger:post` scope.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:post"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:post");
  if (permErr) return permErr;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = voidSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "A reversal reason is required.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  // Resolve the journal WITHIN the caller's application + environment so a
  // journal id from another tenant can never be reversed here.
  const journal = await prisma.journalTransaction.findFirst({
    where: {
      id,
      applicationId: ctx.application.id,
      environment: ctx.environment,
    },
    select: { id: true },
  });
  if (!journal) {
    return apiError({
      code: "NOT_FOUND",
      message: "Journal transaction not found.",
      status: 404,
    });
  }

  const actor = ctx.apiKey?.name ?? ctx.tenantRole ?? "user";

  try {
    const { reversalId } = await reverseJournalEntry({
      journalId: journal.id,
      reversedBy: actor,
      reason: parsed.data.reason,
    });

    const reversal = await prisma.journalTransaction.findUnique({
      where: { id: reversalId },
      select: { id: true, description: true, reference: true, postedAt: true },
    });

    return Response.json(
      {
        data: {
          id: journal.id,
          reversalId,
          reversedBy: actor,
          reason: parsed.data.reason,
          reversal: reversal
            ? {
                id: reversal.id,
                description: reversal.description,
                reference: reversal.reference,
                postedAt: reversal.postedAt.toISOString(),
              }
            : null,
        },
        meta: { requestId: ctx.requestId },
      },
      { headers: { "x-request-id": ctx.requestId } },
    );
  } catch (err) {
    if (err instanceof LedgerValidationError) {
      return apiError({
        code: "INVALID_OPERATION",
        message: err.message,
        status: 400,
      });
    }
    throw err;
  }
}
