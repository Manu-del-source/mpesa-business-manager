import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError, ERRORS } from "@/lib/middleware";
import {
  generateApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  validateRequestedScopes,
} from "@/lib/api-keys";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
  keyType: z.enum(["PUBLIC", "SECRET", "WEBHOOK_SECRET"]),
  scopes: z.array(z.string().min(1)).optional(),
  expiresAt: z.string().datetime().optional(),
});

const rotateQuerySchema = z.object({
  id: z.string().min(1, "Query parameter `id` (the key to rotate) is required."),
});

/**
 * GET /v1/keys — list API keys for the authenticated application.
 *
 * Secrets are never returned (only previews). Requires `api-keys:read`.
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, {
    requiredScopes: ["api-keys:read"],
  });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "api-keys:read");
  if (permErr) return permErr;

  const keys = await listApiKeys(ctx.application.id);

  return Response.json(
    {
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
    },
    { headers: { "x-request-id": ctx.requestId } },
  );
}

/**
 * POST /v1/keys — create a new API key. The secret is returned EXACTLY ONCE.
 *
 * Scope rules (enforced, not advisory):
 *   - Every requested scope must exist in the permission registry.
 *   - A key can never grant a scope its caller does not hold — a key with
 *     `api-keys:manage` alone cannot mint a key with `payments:create`.
 *
 * Environment rule: the new key is created in the SAME environment as the
 * authenticating key — a sandbox key can never mint a live key.
 *
 * Requires `api-keys:manage` scope.
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

  // Validate scopes against the registry AND the caller's own permissions.
  const scopeCheck = validateRequestedScopes(
    parsed.data.scopes ?? [],
    ctx.permissions,
  );
  if (!scopeCheck.ok) {
    return apiError({
      code: scopeCheck.code,
      message: scopeCheck.error,
      status: scopeCheck.code === "INVALID_SCOPES" ? 422 : 403,
    });
  }

  const result = await generateApiKey({
    applicationId: ctx.application.id,
    // Environment is taken from the AUTHENTICATING key, never from the body.
    environment: ctx.environment,
    keyType: parsed.data.keyType,
    name: parsed.data.name,
    scopes: scopeCheck.scopes,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  });

  if (!result.ok) {
    return apiError({ code: result.code, message: result.error, status: 422 });
  }

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
        warning: "Save the secretKey now — it will not be shown again.",
      },
    },
    { status: 201, headers: { "x-request-id": ctx.requestId } },
  );
}

/**
 * PATCH /v1/keys?id=<keyId> — rotate an API key.
 *
 * Atomically revokes the old key and creates a replacement with the same
 * name, environment, key type and scopes. The new secret is returned exactly
 * once. Only keys in the caller's own environment can be rotated.
 *
 * Requires `api-keys:manage` scope.
 */
export async function PATCH(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, {
    requiredScopes: ["api-keys:manage"],
  });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "api-keys:manage");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parsedQuery = rotateQuerySchema.safeParse({
    id: url.searchParams.get("id") ?? undefined,
  });
  if (!parsedQuery.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid query parameters.",
      status: 422,
      details: parsedQuery.error.flatten().fieldErrors,
    });
  }

  const result = await rotateApiKey({
    keyId: parsedQuery.data.id,
    applicationId: ctx.application.id,
  });

  if (!result) {
    return apiError({
      ...ERRORS.NOT_FOUND,
      message:
        "API key not found, already revoked, or belongs to a different application.",
    });
  }

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
        revokedKeyId: result.revokedKeyId,
      },
      meta: {
        requestId: ctx.requestId,
        warning:
          "The old key has been revoked. Save the new secretKey now — it will not be shown again.",
      },
    },
    { status: 200, headers: { "x-request-id": ctx.requestId } },
  );
}

/**
 * DELETE /v1/keys?id=<keyId> — revoke an API key (soft delete; it stops
 * authenticating immediately). Requires `api-keys:manage` scope.
 */
export async function DELETE(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, {
    requiredScopes: ["api-keys:manage"],
  });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "api-keys:manage");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parsedQuery = rotateQuerySchema.safeParse({
    id: url.searchParams.get("id") ?? undefined,
  });
  if (!parsedQuery.success) {
    return apiError({
      code: "VALIDATION_ERROR",
      message: "Invalid query parameters.",
      status: 422,
      details: parsedQuery.error.flatten().fieldErrors,
    });
  }

  const revoked = await revokeApiKey(parsedQuery.data.id);

  if (!revoked) {
    return apiError({
      ...ERRORS.NOT_FOUND,
      message: "API key not found, already revoked, or belongs to a different application.",
    });
  }

  return Response.json(
    {
      data: { id: parsedQuery.data.id, revoked: true },
      meta: { requestId: ctx.requestId },
    },
    { headers: { "x-request-id": ctx.requestId } },
  );
}
