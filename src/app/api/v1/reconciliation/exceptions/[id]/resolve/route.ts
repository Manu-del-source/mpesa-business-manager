import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { resolveException } from "@/lib/reconciliation";
import { z } from "zod";

const resolveSchema = z.object({
  resolution: z.string().min(1).max(500),
});

/**
 * POST /v1/reconciliation/exceptions/:id/resolve
 *
 * Mark a reconciliation exception as resolved with resolution notes.
 * Requires `reconciliation:run` scope.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["reconciliation:run"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "reconciliation:run");
  if (permErr) return permErr;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = resolveSchema.safeParse(body);
  const resolution = parsed.success ? parsed.data.resolution : "Resolved manually";

  const resolvedBy = ctx.apiKey?.name || ctx.tenantRole || "user";
  const ok = await resolveException(id, resolvedBy, resolution);

  if (!ok) {
    return apiError({ code: "NOT_FOUND", message: "Exception not found or already resolved.", status: 404 });
  }

  return Response.json({
    data: {
      id,
      resolved: true,
      resolvedBy,
      resolution,
    },
    meta: { requestId: ctx.requestId },
  });
}
