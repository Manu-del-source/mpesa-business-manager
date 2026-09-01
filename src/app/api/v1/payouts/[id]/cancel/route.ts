import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { transitionPayout } from "@/lib/payouts";

/**
 * POST /v1/payouts/:id/cancel
 *
 * Cancel a pending payout.
 * Requires `payouts:create` scope.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payouts:create"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payouts:create");
  if (permErr) return permErr;

  const { id } = await params;

  try {
    const updated = await transitionPayout(id, "CANCELLED");
    if (!updated) {
      return apiError({ code: "NOT_FOUND", message: "Payout not found.", status: 404 });
    }

    return Response.json({
      data: updated,
      meta: { requestId: ctx.requestId },
    });
  } catch (err) {
    return apiError({
      code: "INVALID_STATE",
      message: err instanceof Error ? err.message : "Unable to cancel payout.",
      status: 400,
    });
  }
}
