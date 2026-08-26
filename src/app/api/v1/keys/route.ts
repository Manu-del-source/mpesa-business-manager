import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { generateApiKey, listApiKeys } from "@/lib/api-keys";
import { z } from "zod";
import type { ApiKeyType, Environment } from "@/generated/prisma";

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  keyType: z.enum(["PUBLIC", "SECRET", "WEBHOOK_SECRET"]),
  environment: z.enum(["SANDBOX", "LIVE"]).default("SANDBOX"),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * GET /v1/keys
 *
 * List API keys for the authenticated application.
 * Requires `api-keys:read` scope.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, {
    requiredScopes: ["api-keys:read"],
  });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "api-keys:read");
  if (permErr) return permErr;

  const keys = await listApiKeys(ctx.application.id);

  return Response.json({
    data: keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyType: k.keyType,
      prefix: k.prefix,
      keyPreview: k.keyPreview,
      scopes: k.scopes,
      environment: k.environment,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    })),
    meta: {
      requestId: ctx.requestId,
      application: ctx.application.slug,
    },
  });
}

/**
 * POST /v1/keys
 *
 * Create a new API key. The secret key is returned exactly once.
 * Requires `api-keys:manage` scope.
 *
 * ⚠️  The `secretKey` field in the response is shown ONLY on creation.
 *     It cannot be retrieved again.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, {
    requiredScopes: ["api-keys:manage"],
  });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "api-keys:manage");
  if (permErr) return permErr;

  const body = await request.json().catch(() => null);
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid request body.",
      status: 422,
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const result = await generateApiKey({
    applicationId: ctx.application.id,
    environment: parsed.data.environment as Environment,
    keyType: parsed.data.keyType as ApiKeyType,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  });

  return Response.json(
    {
      data: {
        id: result.id,
        name: result.name,
        keyType: result.keyType,
        prefix: result.prefix,
        secretKey: result.secretKey,
        keyPreview: result.keyPreview,
        scopes: result.scopes,
        environment: result.environment,
        expiresAt: result.expiresAt?.toISOString() ?? null,
        createdAt: result.createdAt.toISOString(),
      },
      meta: {
        requestId: ctx.requestId,
        warning:
          "Save the secretKey now — it will not be shown again.",
      },
    },
    { status: 201 },
  );
}
