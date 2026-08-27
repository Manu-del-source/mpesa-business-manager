import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createAccount, listAccounts, getAccountBalances } from "@/lib/ledger";
import { z } from "zod";

const createAccountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  parentId: z.string().optional(),
  currency: z.string().default("KES"),
  description: z.string().optional(),
});

/**
 * GET /v1/accounts
 *
 * List all accounts for the authenticated application's environment.
 * Optionally includes balances when ?balances=true.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const includeBalances = url.searchParams.get("balances") === "true";

  if (includeBalances) {
    const balances = await getAccountBalances(ctx.application.id, ctx.environment);
    return Response.json({
      data: balances.map((b) => ({
        id: b.accountId,
        code: b.code,
        name: b.name,
        type: b.type,
        balanceMinor: b.balanceMinor.toString(),
        debitMinor: b.debitMinor.toString(),
        creditMinor: b.creditMinor.toString(),
        currency: b.currency,
      })),
      meta: { requestId: ctx.requestId, environment: ctx.environment },
    });
  }

  const accounts = await listAccounts(ctx.application.id, ctx.environment);
  return Response.json({
    data: accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      currency: a.currency,
      active: a.active,
      description: a.description,
      entryCount: a._count.entries,
      createdAt: a.createdAt.toISOString(),
    })),
    meta: { requestId: ctx.requestId, environment: ctx.environment },
  });
}

/**
 * POST /v1/accounts
 *
 * Create a new account in the chart of accounts.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["ledger:post"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "ledger:post");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createAccountSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({ code: "VALIDATION_ERROR", message: "Invalid request body.", status: 422, details: parsed.error.flatten().fieldErrors });
  }

  try {
    const account = await createAccount({
      applicationId: ctx.application.id,
      environment: ctx.environment,
      ...parsed.data,
    });

    return Response.json(
      {
        data: {
          id: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          currency: account.currency,
          active: account.active,
          description: account.description,
          createdAt: account.createdAt.toISOString(),
        },
        meta: { requestId: ctx.requestId },
      },
      { status: 201 },
    );
  } catch (err) {
    return apiError({ code: "CONFLICT", message: err instanceof Error ? err.message : "Account creation failed.", status: 409 });
  }
}
