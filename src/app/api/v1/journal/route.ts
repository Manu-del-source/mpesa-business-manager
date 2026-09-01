import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { postJournalEntry, LedgerValidationError } from "@/lib/ledger";
import { parseAmountMinor } from "@/lib/money";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

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

const journalEntrySchema = z.object({
  description: z.string().min(1).max(500),
  reference: z.string().max(200).optional(),
  entries: z
    .array(
      z.object({
        accountId: z.string().min(1),
        type: z.enum(["DEBIT", "CREDIT"]),
        amountMinor: amountMinorSchema,
        currency: z
          .string()
          .length(3)
          .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter uppercase ISO code.")
          .optional(),
        description: z.string().max(500).optional(),
      }),
    )
    .min(2, "A journal entry needs at least 2 entries (debit and credit)."),
});

/**
 * GET /v1/journal
 *
 * List journal transactions and entries for the financial ledger.
 * Requires `ledger:read` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const search = url.searchParams.get("search");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);
  const cursor = url.searchParams.get("cursor");

  const where: Record<string, unknown> = {
    applicationId: ctx.application.id,
    environment: ctx.environment,
  };

  if (search) {
    where.OR = [
      { id: { contains: search, mode: "insensitive" } },
      { reference: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  if (accountId) {
    where.entries = {
      some: { accountId },
    };
  }

  if (cursor) {
    const cursorItem = await prisma.journalTransaction.findUnique({
      where: { id: cursor },
      select: { postedAt: true },
    });
    if (cursorItem) {
      where.postedAt = { lt: cursorItem.postedAt };
    }
  }

  const transactions = await prisma.journalTransaction.findMany({
    where,
    include: {
      entries: {
        include: { account: true },
      },
    },
    orderBy: { postedAt: "desc" },
    take: limit + 1,
  });

  const hasMore = transactions.length > limit;
  const data = hasMore ? transactions.slice(0, limit) : transactions;
  const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

  // Flatten for ledger line display if requested or provide both
  const flatEntries = data.flatMap((tx) =>
    tx.entries.map((entry) => ({
      id: entry.id,
      journalId: tx.id,
      timestamp: tx.postedAt.toISOString(),
      accountCode: entry.account.code,
      accountName: entry.account.name,
      accountType: entry.account.type,
      accountId: entry.accountId,
      debitMinor: entry.type === "DEBIT" ? entry.amountMinor.toString() : "-",
      creditMinor: entry.type === "CREDIT" ? entry.amountMinor.toString() : "-",
      type: entry.type,
      amountMinor: entry.amountMinor.toString(),
      currency: entry.currency,
      reference: tx.reference || `TXN_${tx.id.slice(-6).toUpperCase()}`,
      description: entry.description || tx.description,
      voided: tx.voidedAt !== null,
    }))
  );

  return Response.json({
    data: data.map((t) => ({
      id: t.id,
      description: t.description,
      reference: t.reference,
      postedAt: t.postedAt.toISOString(),
      voidedAt: t.voidedAt?.toISOString() ?? null,
      voidReason: t.voidReason,
      entries: t.entries.map((e) => ({
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
    })),
    flatEntries,
    pagination: {
      hasMore,
      nextCursor,
      limit,
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
    },
  });
}

/**
 * POST /v1/journal — post a balanced journal entry to the ledger.
 *
 * Requires `ledger:post` scope. Invariants enforced IN THE POSTING
 * TRANSACTION (see src/lib/ledger.ts):
 *   - At least 2 entries; all amounts > 0
 *   - Sum of debits == Sum of credits (exact, in integer minor units)
 *   - Accounts exist, are active, and belong to this application + environment
 *   - Every entry's currency matches its account's currency
 *   - A journal is single-currency
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
      entries: parsed.data.entries,
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
      { status: 201, headers: { "x-request-id": ctx.requestId } },
    );
  } catch (err) {
    if (err instanceof LedgerValidationError) {
      return apiError({
        code: "LEDGER_VALIDATION_ERROR",
        message: err.message,
        status: 422,
      });
    }
    throw err;
  }
}
