import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { getRefund } from "@/lib/refunds";

/**
 * GET /v1/refunds/:id
 *
 * Refund detail view.
 * Requires `payments:read` scope.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:read");
  if (permErr) return permErr;

  const { id } = await params;
  const refund = await getRefund(id, ctx.application.id);

  if (!refund) {
    return apiError({ code: "NOT_FOUND", message: "Refund not found.", status: 404 });
  }

  return Response.json({
    data: refund,
    meta: { requestId: ctx.requestId, environment: ctx.environment },
  });
}
