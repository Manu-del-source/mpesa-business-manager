import { type NextRequest, NextResponse } from "next/server";
import { verifyApiKey, type VerifiedKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import type { Environment, TenantRole } from "@/generated/prisma";
import { resolvePermissions, type Permission } from "@/lib/rbac";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequestContext = {
  /** The verified API key metadata. */
  apiKey: VerifiedKey;
  /** Resolved tenant for the API key's application. */
  tenant: { id: string; name: string; slug: string };
  /** Resolved application. */
  application: { id: string; name: string; slug: string };
  /** Active environment (from the API key). */
  environment: Environment;
  /** Resolved permissions for this key's scopes. */
  permissions: Permission[];
  /** Correlation ID for request tracing. */
  requestId: string;
};

export type ApiError = {
  code: string;
  message: string;
  status: number;
  details?: unknown;
};

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export function apiError(error: ApiError): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message, details: error.details } },
    { status: error.status },
  );
}

const ERRORS = {
  UNAUTHORIZED: { code: "UNAUTHORIZED", message: "Invalid or missing API key.", status: 401 },
  FORBIDDEN: { code: "FORBIDDEN", message: "Insufficient permissions.", status: 403 },
  NOT_FOUND: { code: "NOT_FOUND", message: "Resource not found.", status: 404 },
  VALIDATION: (details: unknown) => ({
    code: "VALIDATION_ERROR",
    message: "Request validation failed.",
    status: 422,
    details,
  }),
  RATE_LIMITED: { code: "RATE_LIMITED", message: "Too many requests.", status: 429 },
  INTERNAL: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", status: 500 },
} as const;

// ---------------------------------------------------------------------------
// Middleware pipeline
// ---------------------------------------------------------------------------

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Extract the API key from the Authorization header.
 * Supports: `Bearer sk_test_...` or `Bearer pk_test_...`
 */
function extractBearerKey(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;

  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;

  const key = parts[1].trim();
  if (!key) return null;

  return key;
}

/**
 * Resolve the tenant and application from an API key.
 */
async function resolveContextFromKey(
  verified: VerifiedKey,
): Promise<Omit<RequestContext, "apiKey" | "permissions" | "requestId"> | null> {
  // Get application → tenant
  const app = await prisma.application.findUnique({
    where: { id: verified.applicationId },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
  });

  if (!app) return null;

  return {
    tenant: app.tenant,
    application: { id: app.id, name: app.name, slug: app.slug },
    environment: verified.environment,
  };
}

/**
 * Main middleware function. Verifies the API key, resolves tenant context,
 * and checks permissions.
 *
 * Usage in route handlers:
 * ```ts
 * export async function GET(request: NextRequest) {
 *   const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:read"] });
 *   if (ctx instanceof NextResponse) return ctx; // error response
 *   // ctx is RequestContext — proceed with business logic
 * }
 * ```
 */
export async function withApiKeyAuth(
  request: NextRequest,
  options?: {
    requiredScopes?: string[];
    requiredEnvironment?: Environment;
  },
): Promise<RequestContext | NextResponse> {
  const requestId = generateRequestId();
  const rawKey = extractBearerKey(request);

  if (!rawKey) {
    return apiError(ERRORS.UNAUTHORIZED);
  }

  const verified = await verifyApiKey(rawKey, {
    requiredEnvironment: options?.requiredEnvironment,
    requiredScopes: options?.requiredScopes,
  });

  if (!verified) {
    return apiError(ERRORS.UNAUTHORIZED);
  }

  const resolved = await resolveContextFromKey(verified);
  if (!resolved) {
    return apiError(ERRORS.INTERNAL);
  }

  // Resolve permissions from key scopes (or all permissions for the key)
  // For now, scopes on the key ARE the permissions
  const permissions = verified.scopes as Permission[];

  return {
    apiKey: verified,
    ...resolved,
    permissions,
    requestId,
  };
}

/**
 * Check that the request context includes a specific permission.
 * Returns an ApiError response if unauthorized, null if authorized.
 */
export function requirePermission(
  ctx: RequestContext,
  permission: Permission,
): NextResponse | null {
  if (!ctx.permissions.includes(permission)) {
    return apiError(ERRORS.FORBIDDEN);
  }
  return null;
}

/**
 * Check that the request context includes ALL of the given permissions.
 */
export function requireAllPermissions(
  ctx: RequestContext,
  permissions: Permission[],
): NextResponse | null {
  for (const perm of permissions) {
    if (!ctx.permissions.includes(perm)) {
      return apiError(ERRORS.FORBIDDEN);
    }
  }
  return null;
}

/**
 * Check that the request context includes ANY of the given permissions.
 */
export function requireAnyPermission(
  ctx: RequestContext,
  permissions: Permission[],
): NextResponse | null {
  const hasAny = permissions.some((p) => ctx.permissions.includes(p));
  if (!hasAny) {
    return apiError(ERRORS.FORBIDDEN);
  }
  return null;
}
