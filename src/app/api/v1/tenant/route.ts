import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";
import {
  ACTIVE_TENANT_COOKIE,
  ACTIVE_ENVIRONMENT_COOKIE,
} from "@/lib/tenant";

/**
 * GET /v1/tenant
 *
 * List all tenants the current user belongs to.
 * Requires a valid API key.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request);
  if (ctx instanceof Response) return ctx;

  // For now, return the current tenant context
  // Later: list all tenants the user has access to
  const store = await cookies();
  const activeTenantSlug = store.get(ACTIVE_TENANT_COOKIE)?.value;
  const activeEnv = store.get(ACTIVE_ENVIRONMENT_COOKIE)?.value ?? "SANDBOX";

  return Response.json({
    data: {
      tenant: ctx.tenant,
      application: ctx.application,
      environment: ctx.environment,
      tenantRole: ctx.tenantRole,
    },
    meta: {
      requestId: ctx.requestId,
    },
  });
}
