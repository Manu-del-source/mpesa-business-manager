import { type NextRequest } from "next/server";
import { withApiKeyAuth } from "@/lib/middleware";

/**
 * GET /v1/tenant — describe the tenant context the authenticated API key
 * operates in. The tenant/application/environment are resolved SERVER-SIDE
 * from the API key's applicationId — client-supplied identifiers are never
 * trusted, so this endpoint cannot be used to probe other tenants.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request);
  if (ctx instanceof Response) return ctx;

  return Response.json(
    {
      data: {
        tenant: ctx.tenant,
        application: ctx.application,
        environment: ctx.environment,
        scopes: ctx.permissions,
      },
      meta: {
        requestId: ctx.requestId,
      },
    },
    { headers: { "x-request-id": ctx.requestId } },
  );
}
