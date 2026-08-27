import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_ROLE_PERMISSIONS,
  invalidPermissions,
  isValidPermission,
  type Permission,
} from "@/lib/permissions";
import type { ApiKeyType, Environment, TenantRole } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiKeyResult = {
  ok: true;
  id: string;
  name: string;
  keyType: ApiKeyType;
  prefix: string;
  /** The full secret key — only returned on creation, never stored. */
  secretKey: string;
  keyPreview: string;
  scopes: string[];
  environment: Environment;
  expiresAt: Date | null;
  createdAt: Date;
};

export type VerifiedKey = {
  id: string;
  applicationId: string;
  environment: Environment;
  keyType: ApiKeyType;
  name: string;
  scopes: Permission[];
};

export type ApiKeyError =
  | { ok: false; error: string; code: "INVALID_SCOPES" | "UNAUTHORIZED_SCOPES" }
  | { ok: false; error: string; code: "INVALID_KEY_TYPE" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Wire-format prefixes per key type and environment (exported for tests/docs). */
export const KEY_PREFIXES: Record<ApiKeyType, Record<Environment, string>> = {
  PUBLIC: {
    SANDBOX: "pk_test",
    LIVE: "pk_live",
  },
  SECRET: {
    SANDBOX: "sk_test",
    LIVE: "sk_live",
  },
  WEBHOOK_SECRET: {
    SANDBOX: "whsec_test",
    LIVE: "whsec_live",
  },
};

const SECRET_BYTES = 32;

/** API-key types accepted for Bearer authentication of /v1 endpoints. */
export const AUTHENTICATING_KEY_TYPES: readonly ApiKeyType[] = ["SECRET"];

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/** SHA-256 hex digest — the at-rest form of API keys (exported for tests). */
export function sha256Hash(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validate requested scopes for a new API key.
 *
 * 1. Every scope must exist in the permission registry (src/lib/permissions.ts)
 *    — an unknown scope string can never travel through the system.
 * 2. The caller must hold every scope they want to grant: a key can never
 *    grant permissions its creator does not have.
 *
 * `callerScopes` is the set of permissions available to the caller — either
 * the scopes of the API key creating the new key, or the resolved permission
 * set of the acting user.
 */
export function validateRequestedScopes(
  requestedScopes: readonly string[],
  callerScopes: readonly string[],
): ApiKeyError | { ok: true; scopes: Permission[] } {
  const invalid = invalidPermissions(requestedScopes);
  if (invalid.length > 0) {
    return {
      ok: false,
      code: "INVALID_SCOPES",
      error: `Unknown scope(s): ${invalid.join(", ")}. Scopes must come from the platform permission registry.`,
    };
  }

  const callerSet = new Set(callerScopes);
  const unauthorized = requestedScopes.filter((scope) => !callerSet.has(scope));
  if (unauthorized.length > 0) {
    return {
      ok: false,
      code: "UNAUTHORIZED_SCOPES",
      error: `Cannot grant scope(s) the caller does not hold: ${unauthorized.join(", ")}.`,
    };
  }

  return { ok: true, scopes: [...new Set(requestedScopes)] as Permission[] };
}

/**
 * Generate a new API key. Returns the full secret key exactly once;
 * it is never stored in plaintext — only the SHA-256 hash is saved.
 *
 * Scopes MUST be validated beforehand (validateRequestedScopes) — this
 * function rejects unknown scope strings defensively.
 */
export async function generateApiKey(params: {
  applicationId: string;
  environment: Environment;
  keyType: ApiKeyType;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
}): Promise<ApiKeyResult | ApiKeyError> {
  if (params.scopes && invalidPermissions(params.scopes).length > 0) {
    return {
      ok: false,
      code: "INVALID_SCOPES",
      error: "API key scopes must come from the platform permission registry.",
    };
  }

  const prefix = KEY_PREFIXES[params.keyType][params.environment];
  const rawSecret = randomBytes(SECRET_BYTES).toString("base64url");
  const fullKey = `${prefix}_${rawSecret}`;
  const keyHash = sha256Hash(fullKey);
  const keyPreview = `${prefix}_...${rawSecret.slice(-4)}`;

  const record = await prisma.apiKey.create({
    data: {
      applicationId: params.applicationId,
      environment: params.environment,
      keyType: params.keyType,
      name: params.name,
      prefix,
      keyHash,
      keyPreview,
      scopes: params.scopes ?? [],
      expiresAt: params.expiresAt ?? null,
    },
  });

  return {
    ok: true as const,
    id: record.id,
    name: record.name,
    keyType: record.keyType,
    prefix: record.prefix,
    secretKey: fullKey,
    keyPreview: record.keyPreview,
    scopes: record.scopes,
    environment: record.environment,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Key verification
// ---------------------------------------------------------------------------

/**
 * Verify an API key presented by a client. Looks up the key by its SHA-256
 * hash and validates:
 *   - it exists
 *   - it has not been revoked
 *   - it has not expired
 *   - it is of an authenticating type (SECRET) unless explicitly allowed
 *   - it matches the required environment, when given
 *   - it holds all required scopes, when given
 *
 * Unknown scope strings on the stored key are filtered out — only registry
 * permissions are ever returned.
 *
 * Returns the key metadata on success, null on failure.
 */
export async function verifyApiKey(
  rawKey: string,
  options?: {
    requiredEnvironment?: Environment;
    requiredScopes?: string[];
    /** Key types allowed to authenticate. Defaults to SECRET only. */
    allowedKeyTypes?: readonly ApiKeyType[];
  },
): Promise<VerifiedKey | null> {
  const keyHash = sha256Hash(rawKey);

  // Look up by hash (indexed)
  const record = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!record) return null;

  // Check revocation
  if (record.revokedAt) return null;

  // Check expiration
  if (record.expiresAt && record.expiresAt < new Date()) return null;

  // Only authenticating key types may be used as Bearer credentials.
  // PUBLIC keys identify, they never authorize.
  const allowedTypes = options?.allowedKeyTypes ?? AUTHENTICATING_KEY_TYPES;
  if (!allowedTypes.includes(record.keyType)) return null;

  // Check environment
  if (options?.requiredEnvironment && record.environment !== options.requiredEnvironment) {
    return null;
  }

  // Only registry permissions enter the verified scope set.
  const scopes = record.scopes.filter(
    (scope): scope is Permission => isValidPermission(scope),
  );

  // Check scopes
  if (options?.requiredScopes && options.requiredScopes.length > 0) {
    const held = new Set<string>(scopes);
    const missing = options.requiredScopes.filter((scope) => !held.has(scope));
    if (missing.length > 0) return null;
  }

  // Update lastUsedAt (fire-and-forget, don't block on failure)
  prisma.apiKey
    .update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {}); // Intentionally non-blocking

  return {
    id: record.id,
    applicationId: record.applicationId,
    environment: record.environment,
    keyType: record.keyType,
    name: record.name,
    scopes,
  };
}

/** Constant-time comparison helper kept for parity with the previous API. */
export function safeCompare(a: string, b: string): boolean {
  return constantTimeCompare(a, b);
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * Revoke an API key (soft delete — key stops working immediately).
 */
export async function revokeApiKey(keyId: string): Promise<boolean> {
  const result = await prisma.apiKey.updateMany({
    where: { id: keyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Rotate an API key: atomically revoke the old key and create a replacement
 * with the same name, environment, key type and scopes. The new secret is
 * returned exactly once. The old key keeps working until this function
 * commits — after that it is revoked.
 */
export async function rotateApiKey(params: {
  keyId: string;
  applicationId: string;
}): Promise<(Omit<ApiKeyResult, "ok"> & { ok: true; revokedKeyId: string }) | null> {
  const { keyId, applicationId } = params;

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.apiKey.findFirst({
      where: { id: keyId, applicationId, revokedAt: null },
    });
    if (!existing) return null;

    // Generate the new secret.
    const prefix = KEY_PREFIXES[existing.keyType][existing.environment];
    const rawSecret = randomBytes(SECRET_BYTES).toString("base64url");
    const fullKey = `${prefix}_${rawSecret}`;
    const keyHash = sha256Hash(fullKey);
    const keyPreview = `${prefix}_...${rawSecret.slice(-4)}`;

    const replacement = await tx.apiKey.create({
      data: {
        applicationId: existing.applicationId,
        environment: existing.environment,
        keyType: existing.keyType,
        name: existing.name,
        prefix,
        keyHash,
        keyPreview,
        scopes: existing.scopes,
        expiresAt: existing.expiresAt,
      },
    });

    // Revoke the old key in the same transaction.
    await tx.apiKey.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return { existing, replacement, fullKey, keyPreview };
  });

  if (!result) return null;

  return {
    ok: true as const,
    id: result.replacement.id,
    name: result.replacement.name,
    keyType: result.replacement.keyType,
    prefix: result.replacement.prefix,
    secretKey: result.fullKey,
    keyPreview: result.keyPreview,
    scopes: result.replacement.scopes,
    environment: result.replacement.environment,
    expiresAt: result.replacement.expiresAt,
    createdAt: result.replacement.createdAt,
    revokedKeyId: result.existing.id,
  };
}

/**
 * Default scopes granted for a tenant role — used when creating a key for a
 * user who has no explicit scope list.
 */
export function defaultScopesForRole(role: TenantRole): Permission[] {
  return [...DEFAULT_ROLE_PERMISSIONS[role]];
}

/**
 * List API keys for an application (redacted — no secret values).
 */
export async function listApiKeys(applicationId: string): Promise<
  Array<{
    id: string;
    name: string;
    keyType: ApiKeyType;
    prefix: string;
    keyPreview: string;
    scopes: string[];
    environment: Environment;
    expiresAt: Date | null;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
  }>
> {
  return prisma.apiKey.findMany({
    where: { applicationId },
    select: {
      id: true,
      name: true,
      keyType: true,
      prefix: true,
      keyPreview: true,
      scopes: true,
      environment: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
  });
}
