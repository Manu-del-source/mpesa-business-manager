import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { postJournalEntry } from "@/lib/ledger";
import { z } from "zod";

const journalEntrySchema = z.object({
  description: z.string().min(1).max(500),
  reference: z.string().max(200).optional(),
  entries: z
    .array(
      z.object({
        accountId: z.string(),
        type: z.enum(["DEBIT", "CREDIT"]),
        amountMinor: z.number().int().positive(),
        currency: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .min(2),
});

/**
 * POST /v1/journal
 *
 * Post a balanced journal entry to the ledger.
 * Requires `ledger:post` scope.
 *
 * Invariants enforced:
 *   - At least 2 entries
 *   - Sum of debits == Sum of credits
 *   - All amounts > 0
 *   - Accounts exist, are active, and belong to this application
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:post"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:post");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = journalEntrySchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid journal entry.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const journal = await postJournalEntry({
      applicationId: ctx.application.id,
      environment: ctx.environment,
      description: parsed.data.description,
      reference: parsed.data.reference,
      entries: parsed.data.entries.map((e) => ({
        ...e,
        amountMinor: BigInt(e.amountMinor),
      })),
    });

    return Response.json(
      {
        data: {
          id: journal.id,
          description: journal.description,
          reference: journal.reference,
          postedAt: journal.postedAt.toISOString(),
          createdAt: journal.createdAt.toISOString(),
        },
        meta: { requestId: ctx.requestId },
      },
      { status: 201 },
    );
  } catch (err) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: err instanceof Error ? err.message : "Failed to post journal entry.",
      status: 422,
    });
  }
}
