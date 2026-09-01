import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { runReconciliation, getReconciliationRuns } from "@/lib/reconciliation";
import { prisma } from "@/lib/prisma";

/**
 * GET /v1/reconciliation/runs
 *
 * List recent reconciliation runs with summaries and discrepancy metrics.
 * Requires `reconciliation:read` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["reconciliation:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "reconciliation:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);

  const runs = await getReconciliationRuns(ctx.application.id, ctx.environment, limit);

  // Also query active exceptions count
  const unresolvedExceptionsCount = await prisma.reconciliationException.count({
    where: {
      reconciliationRun: {
        applicationId: ctx.application.id,
        environment: ctx.environment,
      },
      resolved: false,
    },
  });

  return Response.json({
    data: runs.map((r) => ({
      runId: r.runId,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      totalChecked: r.totalChecked,
      matched: r.matched,
      discrepancies: r.discrepancies,
    })),
    summary: {
      unresolvedExceptions: unresolvedExceptionsCount,
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
    },
  });
}

/**
 * POST /v1/reconciliation/runs
 *
 * Trigger an immediate reconciliation run.
 * Requires `reconciliation:run` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["reconciliation:run"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "reconciliation:run");
  if (permErr) return permErr;

  const body = await request.json().catch(() => ({}));
  const maxAge = body?.maxAge ? Number(body.maxAge) : undefined;

  try {
    const result = await runReconciliation(ctx.application.id, ctx.environment, {
      maxAge,
    });

    return Response.json(
      {
        data: result,
        meta: { requestId: ctx.requestId },
      },
      { status: 201 }
    );
  } catch (err) {
    return apiError({
      code: "RECONCILIATION_FAILED",
      message: err instanceof Error ? err.message : "Reconciliation run failed.",
      status: 500,
    });
  }
}
