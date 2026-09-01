import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { getPayout } from "@/lib/payouts";

/**
 * GET /v1/payouts/:id
 *
 * Payout detail view.
 * Requires `payouts:read` scope.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payouts:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payouts:read");
  if (permErr) return permErr;

  const { id } = await params;
  const payout = await getPayout(id, ctx.application.id);

  if (!payout) {
    return apiError({ code: "NOT_FOUND", message: "Payout not found.", status: 404 });
  }

  return Response.json({
    data: payout,
    meta: { requestId: ctx.requestId, environment: ctx.environment },
  });
}
