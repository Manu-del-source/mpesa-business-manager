import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { ApiKeyType, Environment } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiKeyResult = {
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
  name: string;
  scopes: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEY_PREFIXES: Record<ApiKeyType, Record<Environment, string>> = {
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

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

function sha256Hash(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Generate a new API key. Returns the full secret key exactly once;
 * it is never stored in plaintext — only the SHA-256 hash is saved.
 */
export async function generateApiKey(params: {
  applicationId: string;
  environment: Environment;
  keyType: ApiKeyType;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
}): Promise<ApiKeyResult> {
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
 * Verify an API key presented by a client. Looks up the key by its hash
 * and validates it hasn't been revoked or expired.
 *
 * Returns the key metadata on success, null on failure.
 */
export async function verifyApiKey(
  rawKey: string,
  options?: {
    requiredEnvironment?: Environment;
    requiredScopes?: string[];
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

  // Check environment
  if (options?.requiredEnvironment && record.environment !== options.requiredEnvironment) {
    return null;
  }

  // Check scopes
  if (options?.requiredScopes && options.requiredScopes.length > 0) {
    const hasAll = options.requiredScopes.every((scope) => record.scopes.includes(scope));
    if (!hasAll) return null;
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
    name: record.name,
    scopes: record.scopes,
  };
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
    orderBy: { createdAt: "desc" },
  });
}
