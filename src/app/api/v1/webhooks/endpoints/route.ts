import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { createEndpoint, listEndpoints } from "@/lib/webhooks";
import { z } from "zod";

const createEndpointSchema = z.object({
  url: z.string().url().startsWith("https://"),
  events: z.array(z.string()).optional(),
  description: z.string().max(500).optional(),
});

/**
 * GET /v1/webhooks/endpoints
 *
 * List webhook endpoints for the active application and environment.
 * Requires `webhooks:read` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["webhooks:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "webhooks:read");
  if (permErr) return permErr;

  const endpoints = await listEndpoints(ctx.application.id, ctx.environment);

  return Response.json({
    data: endpoints,
    meta: { requestId: ctx.requestId, environment: ctx.environment },
  });
}

/**
 * POST /v1/webhooks/endpoints
 *
 * Create a new webhook subscription endpoint.
 * Requires `webhooks:manage` scope.
 * ⚠️ Signing secret is returned ONCE.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["webhooks:manage"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "webhooks:manage");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createEndpointSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid webhook endpoint. URL must use HTTPS.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await createEndpoint({
    applicationId: ctx.application.id,
    environment: ctx.environment,
    url: parsed.data.url,
    events: parsed.data.events,
    description: parsed.data.description,
  });

  if (!result.ok) {
    return apiError({ code: result.code, message: result.error, status: 400 });
  }

  return Response.json(
    {
      data: result.endpoint,
      secret: result.secret,
      meta: {
        requestId: ctx.requestId,
        warning: "Store the signing secret securely. It cannot be retrieved again.",
      },
    },
    { status: 201 }
  );
}
