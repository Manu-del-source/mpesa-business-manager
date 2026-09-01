import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createAppSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
});

/**
 * GET /v1/tenant/applications
 *
 * List applications under the current tenant.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request);
  if (ctx instanceof Response) return ctx;

  const applications = await prisma.application.findMany({
    where: { tenantId: ctx.tenant.id },
    include: {
      _count: {
        select: {
          payments: true,
          apiKeys: true,
          accounts: true,
          webhookEndpoints: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return Response.json({
    data: applications.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      description: a.description,
      paymentCount: a._count.payments,
      apiKeyCount: a._count.apiKeys,
      accountCount: a._count.accounts,
      webhookCount: a._count.webhookEndpoints,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
    meta: { requestId: ctx.requestId },
  });
}

/**
 * POST /v1/tenant/applications
 *
 * Create a new application under the tenant.
 * Requires `settings:manage` scope.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["settings:manage"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "settings:manage");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createAppSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid application data. Slug must contain only lowercase letters, numbers, and dashes.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const app = await prisma.application.create({
      data: {
        tenantId: ctx.tenant.id,
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description ?? null,
      },
    });

    return Response.json(
      {
        data: {
          id: app.id,
          name: app.name,
          slug: app.slug,
          description: app.description,
          createdAt: app.createdAt.toISOString(),
        },
        meta: { requestId: ctx.requestId },
      },
      { status: 201 }
    );
  } catch (err) {
    return apiError({
      code: "CONFLICT",
      message: "An application with this slug already exists in this tenant.",
      status: 409,
    });
  }
}
