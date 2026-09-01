import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";

/**
 * GET /v1/tenant/tenants
 *
 * List all tenants available to the user for switching.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request);
  if (ctx instanceof Response) return ctx;

  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: {
        select: { applications: true, members: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return Response.json({
    data: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      applicationCount: t._count.applications,
      memberCount: t._count.members,
      createdAt: t.createdAt.toISOString(),
    })),
    meta: { requestId: ctx.requestId },
  });
}
