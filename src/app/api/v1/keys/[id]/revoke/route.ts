import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { revokeApiKey } from "@/lib/api-keys";

/**
 * POST /v1/keys/:id/revoke
 *
 * Revoke an API key immediately.
 * Requires `api-keys:manage` scope.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["api-keys:manage"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "api-keys:manage");
  if (permErr) return permErr;

  const { id } = await params;
  const ok = await revokeApiKey(id);

  if (!ok) {
    return apiError({ code: "NOT_FOUND", message: "API key not found or already revoked.", status: 404 });
  }

  return Response.json({
    data: { id, revoked: true },
    meta: { requestId: ctx.requestId },
  });
}
