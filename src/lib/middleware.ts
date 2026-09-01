import { type NextRequest, NextResponse } from "next/server";
import { verifyApiKey, type VerifiedKey } from "@/lib/api-keys";
import { prisma } from "@/lib/prisma";
import {
  isValidPermission,
  type Permission,
  type TenantRoleName,
} from "@/lib/permissions";
import { resolvePermissions } from "@/lib/rbac";
import { getCurrentUser, requireTenantContext } from "@/lib/tenant";
import type { Environment } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequestContext = {
  /** The verified API key metadata (if authenticated via key). */
  apiKey?: VerifiedKey;
  /** Resolved tenant for the API key's application or session. */
  tenant: { id: string; name: string; slug: string };
  /** Resolved application. */
  application: { id: string; name: string; slug: string };
  /**
   * Active environment. For API keys this comes from the key itself (keys are
   * environment-bound); for session auth it comes from the x-environment
   * header or the active-environment cookie.
   */
  environment: Environment;
  /**
   * Resolved permissions for this key's scopes or the user's tenant role.
   * Always registry-validated — unknown scope strings are dropped.
   */
  permissions: Permission[];
  /** Tenant role if resolved via session. */
  tenantRole?: TenantRoleName;
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

export const ERRORS = {
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
 * Supports: `Bearer sk_test_...`
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
 * Resolve the tenant and application from an API key. The application and
 * its tenant come from the DATABASE, keyed by the key's applicationId —
 * client-supplied tenant/application identifiers are never trusted.
 */
async function resolveContextFromKey(
  verified: VerifiedKey,
): Promise<Omit<RequestContext, "apiKey" | "permissions" | "requestId"> | null> {
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
 * Main middleware function. Verifies the API key or authenticated user session,
 * resolves tenant context, and checks permissions.
 *
 * Supports:
 * 1. Bearer API key in `Authorization: Bearer <key>` header
 * 2. Authenticated user session (Supabase or Demo session) with tenant/application context
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

  // -------------------------------------------------------------------------
  // 1. API key authentication (machine-to-machine)
  // -------------------------------------------------------------------------
  if (rawKey) {
    let verified: VerifiedKey | null;
    try {
      verified = await verifyApiKey(rawKey, {
        requiredEnvironment: options?.requiredEnvironment,
        requiredScopes: options?.requiredScopes,
      });
    } catch {
      // Verification must fail closed — a database failure never becomes a
      // "no key required" situation, nor a crash with a 500 stack trace.
      return apiError(ERRORS.INTERNAL);
    }

    if (!verified) {
      return apiError(ERRORS.UNAUTHORIZED);
    }

    let resolved: Omit<RequestContext, "apiKey" | "permissions" | "requestId"> | null;
    try {
      resolved = await resolveContextFromKey(verified);
    } catch {
      return apiError(ERRORS.INTERNAL);
    }
    if (!resolved) {
      // Key points at an application that no longer exists.
      return apiError(ERRORS.UNAUTHORIZED);
    }

    // Only registry-valid permissions enter the request context. Unknown
    // scope strings stored on a key can never satisfy a permission check.
    const permissions = verified.scopes.filter(isValidPermission);

    return {
      apiKey: verified,
      ...resolved,
      permissions,
      requestId,
    };
  }

  // -------------------------------------------------------------------------
  // 2. Session authentication (first-party dashboard requests)
  // -------------------------------------------------------------------------
  let tenantCtx: Awaited<ReturnType<typeof requireTenantContext>>;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return apiError(ERRORS.UNAUTHORIZED);
    }

    tenantCtx = await requireTenantContext();
  } catch {
    // No session, or the session names a tenant the user cannot access.
    return apiError(ERRORS.UNAUTHORIZED);
  }

  // The environment header may only narrow to an explicit, known value; any
  // other value falls back to the cookie-backed context environment (SANDBOX
  // by default) rather than silently widening access.
  const headerEnv = request.headers.get("x-environment")?.toUpperCase();
  const activeEnv: Environment =
    headerEnv === "LIVE" || headerEnv === "SANDBOX"
      ? headerEnv
      : tenantCtx.environment;

  if (options?.requiredEnvironment && activeEnv !== options.requiredEnvironment) {
    return apiError(ERRORS.FORBIDDEN);
  }

  // resolvePermissions fails closed: it throws on unexpected database errors
  // rather than falling back to broad defaults, so deny on any failure.
  let permissions: Permission[];
  try {
    permissions = await resolvePermissions(tenantCtx.tenantRole);
  } catch {
    return apiError(ERRORS.INTERNAL);
  }

  if (options?.requiredScopes && options.requiredScopes.length > 0) {
    const hasAll = options.requiredScopes.every(
      (scope) => isValidPermission(scope) && permissions.includes(scope),
    );
    if (!hasAll) {
      return apiError(ERRORS.FORBIDDEN);
    }
  }

  return {
    tenant: tenantCtx.tenant,
    application: tenantCtx.application,
    environment: activeEnv,
    tenantRole: tenantCtx.tenantRole,
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
