import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { transitionPayment } from "@/lib/payments";

/**
 * POST /v1/payments/:id/cancel
 *
 * Cancel a pending payment.
 * Requires `payments:cancel` scope.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:cancel"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:cancel");
  if (permErr) return permErr;

  const { id } = await params;

  try {
    const updated = await transitionPayment(id, "CANCELLED");
    if (!updated) {
      return apiError({ code: "NOT_FOUND", message: "Payment not found.", status: 404 });
    }

    return Response.json({
      data: updated,
      meta: { requestId: ctx.requestId },
    });
  } catch (err) {
    return apiError({
      code: "INVALID_STATE",
      message: err instanceof Error ? err.message : "Unable to cancel payment.",
      status: 400,
    });
  }
}
