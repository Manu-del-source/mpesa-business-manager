import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { deactivateEndpoint } from "@/lib/webhooks";

/**
 * DELETE /v1/webhooks/endpoints/:id
 *
 * Deactivate a webhook endpoint.
 * Requires `webhooks:manage` scope.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["webhooks:manage"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "webhooks:manage");
  if (permErr) return permErr;

  const { id } = await params;
  const ok = await deactivateEndpoint(id);

  if (!ok) {
    return apiError({ code: "NOT_FOUND", message: "Webhook endpoint not found or already inactive.", status: 404 });
  }

  return Response.json({
    data: { id, active: false },
    meta: { requestId: ctx.requestId },
  });
}
