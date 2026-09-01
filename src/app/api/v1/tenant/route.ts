import { type NextRequest } from "next/server";
import { withApiKeyAuth } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";

/**
 * GET /v1/tenant — describe the tenant context the caller operates in.
 *
 * The tenant/application/environment are resolved SERVER-SIDE from the API
 * key's applicationId (or from the verified session's tenant membership) —
 * client-supplied identifiers are never trusted, so this endpoint cannot be
 * used to probe other tenants.
 *
 * Also returns the applications visible to that tenant, the caller's tenant
 * role (when session-authenticated) and their resolved permissions.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request);
  if (ctx instanceof Response) return ctx;

  // Scoped to the server-resolved tenant id — never a client-supplied one.
  const applications = await prisma.application.findMany({
    where: { tenantId: ctx.tenant.id },
    select: { id: true, name: true, slug: true, description: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(
    {
      data: {
        tenant: ctx.tenant,
        application: ctx.application,
        applications,
        environment: ctx.environment,
        // No role is implied for API-key callers; do not invent one.
        tenantRole: ctx.tenantRole ?? null,
        permissions: ctx.permissions,
        /** @deprecated use `permissions` */
        scopes: ctx.permissions,
      },
      meta: {
        requestId: ctx.requestId,
      },
    },
    { headers: { "x-request-id": ctx.requestId } },
  );
}
