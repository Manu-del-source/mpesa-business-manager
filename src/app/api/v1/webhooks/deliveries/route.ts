import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";

/**
 * GET /v1/webhooks/deliveries
 *
 * List recent webhook delivery logs with delivery status, HTTP status, and retries.
 * Requires `webhooks:read` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["webhooks:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "webhooks:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const endpointId = url.searchParams.get("endpointId");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 100);

  const where: Record<string, unknown> = {
    webhookEndpoint: {
      applicationId: ctx.application.id,
      environment: ctx.environment,
    },
  };

  if (endpointId) {
    where.webhookEndpointId = endpointId;
  }

  const deliveries = await prisma.webhookDelivery.findMany({
    where,
    include: {
      webhookEndpoint: {
        select: { id: true, url: true, description: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return Response.json({
    data: deliveries.map((d) => ({
      id: d.id,
      endpointId: d.webhookEndpointId,
      endpointUrl: d.webhookEndpoint.url,
      eventType: d.eventType,
      payload: d.payload,
      status: d.status,
      httpStatusCode: d.httpStatusCode,
      responseBody: d.responseBody,
      attempts: d.attempts,
      maxAttempts: d.maxAttempts,
      lastError: d.lastError,
      createdAt: d.createdAt.toISOString(),
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
    })),
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
    },
  });
}
