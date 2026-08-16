import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { darajaBaseUrl, type ResolvedMpesaConfig } from "@/lib/mpesa/config";
import { DarajaError, codeForStatus, toDarajaError } from "@/lib/mpesa/errors";

/**
 * Safaricom Daraja OAuth (client-credentials).
 *
 * `GET /oauth/v1/generate?grant_type=client_credentials` with a Basic auth
 * header of `base64(consumerKey:consumerSecret)` returns a bearer token that
 * is valid for ~1 hour (`expires_in`, in seconds, as a string).
 *
 * Tokens are cached in-process, keyed by a hash of the credentials + base URL,
 * and expired 60s early to avoid using a token that dies mid-request. The
 * cache key is a SHA-256 digest so raw secrets never sit in a map key, in a
 * log line, or in a heap dump that's easy to grep.
 */

type CachedToken = { token: string; expiresAt: number };

const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

/** Safety margin (ms) applied before a token's real expiry. */
const EXPIRY_SKEW_MS = 60_000;

function cacheKey(config: ResolvedMpesaConfig): string {
  return createHash("sha256")
    .update(`${config.environment}:${config.consumerKey}:${config.consumerSecret}`)
    .digest("hex");
}

type TokenResponse = {
  access_token?: string;
  expires_in?: string | number;
  errorCode?: string;
  errorMessage?: string;
};

async function requestToken(config: ResolvedMpesaConfig): Promise<CachedToken> {
  const basic = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`,
    "utf8",
  ).toString("base64");

  const url = `${darajaBaseUrl(config.environment)}/oauth/v1/generate?grant_type=client_credentials`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(env.darajaTimeoutMs),
    });
  } catch (err) {
    throw toDarajaError(err);
  }

  const bodyText = await res.text();

  if (!res.ok) {
    // 400/401 here almost always means bad consumer key/secret, or the wrong
    // environment (sandbox credentials pointed at production, or vice versa).
    const code = res.status === 400 ? "INVALID_CREDENTIALS" : codeForStatus(res.status);
    throw new DarajaError(code, {
      status: res.status,
      // bodyText is Safaricom's error envelope; it never echoes our secret.
      detail: `OAuth ${res.status}: ${bodyText.slice(0, 300)}`,
    });
  }

  let data: TokenResponse;
  try {
    data = JSON.parse(bodyText) as TokenResponse;
  } catch {
    throw new DarajaError("AUTH_FAILED", {
      detail: `OAuth returned non-JSON: ${bodyText.slice(0, 200)}`,
    });
  }

  if (!data.access_token) {
    throw new DarajaError("AUTH_FAILED", {
      detail: `OAuth response missing access_token: ${data.errorMessage ?? bodyText.slice(0, 200)}`,
    });
  }

  const expiresInSec = Number(data.expires_in ?? 3599);
  const ttlMs = Number.isFinite(expiresInSec) && expiresInSec > 0
    ? expiresInSec * 1000
    : 3_599_000;

  return {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(ttlMs - EXPIRY_SKEW_MS, 30_000),
  };
}

/**
 * Get a valid Daraja access token, reusing a cached one when possible.
 * Concurrent callers with identical credentials share a single in-flight
 * request instead of hammering Safaricom's rate-limited OAuth endpoint.
 */
export async function getAccessToken(
  config: ResolvedMpesaConfig,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const key = cacheKey(config);

  if (!options.forceRefresh) {
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const promise = (async () => {
    const fresh = await requestToken(config);
    tokenCache.set(key, fresh);
    return fresh.token;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

/** Drop a cached token, e.g. after Daraja replies 401 to an API call. */
export function invalidateAccessToken(config: ResolvedMpesaConfig): void {
  tokenCache.delete(cacheKey(config));
}

/**
 * Verify credentials by fetching a token. Used by the "Test connection"
 * button in M-Pesa settings.
 */
export async function verifyCredentials(
  config: ResolvedMpesaConfig,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    await getAccessToken(config, { forceRefresh: true });
    return { ok: true };
  } catch (err) {
    const error = toDarajaError(err);
    return { ok: false, code: error.code, message: error.userMessage };
  }
}
