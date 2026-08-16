import "server-only";
import type { MpesaConfig } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { callbackBaseUrl, env, isDarajaConfigured, isDemoMode } from "@/lib/env";
import { decryptSecret, encryptSecret, encryptionEnabled, maskTail } from "@/lib/mpesa/crypto";
import { MPESA_KEEP_EXISTING } from "@/lib/validations";

/**
 * Per-organization Daraja configuration.
 *
 * Two shapes exist deliberately:
 *
 * - `ResolvedMpesaConfig` — contains live secrets. SERVER ONLY. Never return
 *   it from a server action, never pass it as a prop to a client component.
 * - `SafeMpesaConfig` — masked, boolean-flag view that is safe to send to the
 *   browser. Everything the settings UI renders comes from this type.
 */

export type MpesaEnvironmentName = "sandbox" | "production";

/** Secrets included — must never cross the server/client boundary. */
export type ResolvedMpesaConfig = {
  source: "organization" | "environment";
  environment: MpesaEnvironmentName;
  shortcode: string;
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  enabled: boolean;
  callbackUrl: string;
};

/** Masked view — safe for client components. */
export type SafeMpesaConfig = {
  configured: boolean;
  enabled: boolean;
  source: "organization" | "environment" | "none";
  environment: MpesaEnvironmentName;
  shortcode: string;
  /** Consumer key is an identifier, not a secret, but we still mask it. */
  consumerKeyMasked: string;
  hasConsumerSecret: boolean;
  hasPasskey: boolean;
  callbackUrl: string;
  /** False when Safaricom could not reach this callback URL (http/localhost). */
  callbackReachable: boolean;
  /** Actionable reason when `callbackReachable` is false. */
  callbackWarning: string | null;
  /** True when secrets are encrypted at rest (MPESA_CREDENTIALS_KEY set). */
  encryptionEnabled: boolean;
  /** True when the deployment runs in demo mode (no real Daraja calls). */
  demoMode: boolean;
  updatedAt: string | null;
};

export const DARAJA_BASE_URLS: Record<MpesaEnvironmentName, string> = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
};

/**
 * Base URL for Daraja calls.
 *
 * `DARAJA_BASE_URL_OVERRIDE` exists solely so the integration can be exercised
 * against a local mock in offline CI/sandboxes. It is deliberately ignored
 * for the production environment so a stray env var can never redirect real
 * money traffic to another host.
 */
export function darajaBaseUrl(environment: MpesaEnvironmentName): string {
  const override = process.env.DARAJA_BASE_URL_OVERRIDE?.trim();
  if (override && environment !== "production") {
    return override.replace(/\/+$/, "");
  }
  return DARAJA_BASE_URLS[environment];
}

function normalizeEnvironment(value: string): MpesaEnvironmentName {
  return value.toLowerCase() === "production" ? "production" : "sandbox";
}

/** Default callback endpoint, optionally guarded by a shared token. */
export function defaultCallbackUrl(): string {
  const url = `${callbackBaseUrl()}/api/mpesa/callback`;
  return env.mpesaCallbackToken
    ? `${url}?token=${encodeURIComponent(env.mpesaCallbackToken)}`
    : url;
}

/** The canonical path Safaricom must POST to. */
export const MPESA_CALLBACK_PATH = "/api/mpesa/callback";

export type CallbackUrlProblem =
  | "NOT_A_URL"
  | "NOT_HTTPS"
  | "NOT_PUBLIC"
  | "WRONG_PATH";

export type CallbackUrlCheck = {
  ok: boolean;
  url: string;
  problem?: CallbackUrlProblem;
  message?: string;
};

/**
 * Validate a callback URL against Safaricom's requirements *before* we send it
 * to Daraja.
 *
 * Safaricom will not accept a CallBackURL that is plain HTTP or that points at
 * a private/loopback host, and it cannot resolve `localhost`. Catching this
 * locally turns the single most common first-time sandbox failure — an opaque
 * Daraja rejection, or an STK prompt that succeeds but never settles — into an
 * actionable message.
 */
export function checkCallbackUrl(raw: string): CallbackUrlCheck {
  const url = raw.trim();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      url,
      problem: "NOT_A_URL",
      message: "Callback URL is not a valid URL.",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      url,
      problem: "NOT_HTTPS",
      message:
        "Safaricom only accepts an HTTPS callback URL. Expose this app over HTTPS (e.g. an ngrok/Cloudflare tunnel) and set MPESA_CALLBACK_BASE_URL.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (isPrivate) {
    return {
      ok: false,
      url,
      problem: "NOT_PUBLIC",
      message: `Safaricom cannot reach "${parsed.hostname}". The callback URL must be a public host, not localhost or a private network address.`,
    };
  }

  if (!parsed.pathname.startsWith(MPESA_CALLBACK_PATH)) {
    return {
      ok: false,
      url,
      problem: "WRONG_PATH",
      message: `Callback URL should point at ${MPESA_CALLBACK_PATH}.`,
    };
  }

  return { ok: true, url };
}

async function findConfigRow(orgId: string): Promise<MpesaConfig | null> {
  return prisma.mpesaConfig.findUnique({ where: { organizationId: orgId } });
}

/**
 * Resolve the effective Daraja credentials for an organization.
 *
 * Precedence: the organization's own MpesaConfig row, then the legacy
 * DARAJA_* environment variables (single-tenant deployments). Returns null
 * when nothing is configured.
 *
 * SERVER ONLY — the result contains live secrets.
 */
export async function resolveMpesaConfig(
  orgId: string,
): Promise<ResolvedMpesaConfig | null> {
  const row = await findConfigRow(orgId);

  if (row) {
    return {
      source: "organization",
      environment: row.environment === "PRODUCTION" ? "production" : "sandbox",
      shortcode: row.shortcode,
      consumerKey: row.consumerKey,
      consumerSecret: decryptSecret(row.consumerSecret),
      passkey: decryptSecret(row.passkey),
      enabled: row.enabled,
      callbackUrl: row.callbackUrl?.trim() || defaultCallbackUrl(),
    };
  }

  if (isDarajaConfigured()) {
    return {
      source: "environment",
      environment: normalizeEnvironment(env.darajaEnvironment),
      shortcode: env.darajaShortcode,
      consumerKey: env.darajaConsumerKey,
      consumerSecret: env.darajaConsumerSecret,
      passkey: env.darajaPasskey,
      enabled: true,
      callbackUrl: defaultCallbackUrl(),
    };
  }

  return null;
}

/**
 * True when the org can actually talk to Daraja: credentials complete AND
 * enabled. Demo mode always short-circuits to the simulated flow.
 */
export function isLive(config: ResolvedMpesaConfig | null): config is ResolvedMpesaConfig {
  return Boolean(
    config &&
      config.enabled &&
      config.shortcode &&
      config.consumerKey &&
      config.consumerSecret &&
      config.passkey,
  );
}

/** Masked, browser-safe view of the org's configuration. */
export async function getSafeMpesaConfig(orgId: string): Promise<SafeMpesaConfig> {
  const row = await findConfigRow(orgId);

  if (row) {
    const orgCallbackCheck = checkCallbackUrl(
      row.callbackUrl?.trim() || defaultCallbackUrl(),
    );
    return {
      configured: true,
      enabled: row.enabled,
      source: "organization",
      environment: row.environment === "PRODUCTION" ? "production" : "sandbox",
      shortcode: row.shortcode,
      consumerKeyMasked: maskTail(row.consumerKey),
      hasConsumerSecret: Boolean(row.consumerSecret),
      hasPasskey: Boolean(row.passkey),
      callbackUrl: row.callbackUrl?.trim() || defaultCallbackUrl(),
      callbackReachable: orgCallbackCheck.ok,
      callbackWarning: orgCallbackCheck.message ?? null,
      encryptionEnabled: encryptionEnabled(),
      demoMode: isDemoMode(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  if (isDarajaConfigured()) {
    const envCallbackCheck = checkCallbackUrl(defaultCallbackUrl());
    return {
      configured: true,
      enabled: true,
      source: "environment",
      environment: normalizeEnvironment(env.darajaEnvironment),
      shortcode: env.darajaShortcode,
      consumerKeyMasked: maskTail(env.darajaConsumerKey),
      hasConsumerSecret: true,
      hasPasskey: true,
      callbackUrl: defaultCallbackUrl(),
      callbackReachable: envCallbackCheck.ok,
      callbackWarning: envCallbackCheck.message ?? null,
      encryptionEnabled: encryptionEnabled(),
      demoMode: isDemoMode(),
      updatedAt: null,
    };
  }

  const noneCallbackCheck = checkCallbackUrl(defaultCallbackUrl());
  return {
    configured: false,
    enabled: false,
    source: "none",
    environment: "sandbox",
    shortcode: "",
    consumerKeyMasked: "",
    hasConsumerSecret: false,
    hasPasskey: false,
    callbackUrl: defaultCallbackUrl(),
    callbackReachable: noneCallbackCheck.ok,
    callbackWarning: noneCallbackCheck.message ?? null,
    encryptionEnabled: encryptionEnabled(),
    demoMode: isDemoMode(),
    updatedAt: null,
  };
}

export type SaveMpesaConfigInput = {
  environment: MpesaEnvironmentName;
  shortcode: string;
  consumerKey: string;
  /** Omit/blank to keep the currently stored secret. */
  consumerSecret?: string;
  /** Omit/blank to keep the currently stored passkey. */
  passkey?: string;
  enabled: boolean;
  callbackUrl?: string;
};

/**
 * Create or update the organization's Daraja configuration.
 *
 * Blank secret fields mean "leave unchanged", so an admin can flip the
 * environment or toggle `enabled` without re-typing credentials that the UI
 * never displays back to them.
 */
export async function saveMpesaConfig(orgId: string, input: SaveMpesaConfigInput) {
  const existing = await findConfigRow(orgId);

  const consumerSecret = input.consumerSecret?.trim();
  const passkey = input.passkey?.trim();

  // The form sends a sentinel when the admin didn't retype the consumer key.
  const rawKey = input.consumerKey.trim();
  const consumerKey =
    rawKey === MPESA_KEEP_EXISTING ? (existing?.consumerKey ?? "") : rawKey;

  if (!consumerKey) {
    throw new Error("Consumer key is required.");
  }
  if (!existing && (!consumerSecret || !passkey)) {
    throw new Error("Consumer secret and passkey are required the first time you save.");
  }

  const data = {
    environment: (input.environment === "production" ? "PRODUCTION" : "SANDBOX") as
      | "PRODUCTION"
      | "SANDBOX",
    shortcode: input.shortcode.trim(),
    consumerKey,
    enabled: input.enabled,
    callbackUrl: input.callbackUrl?.trim() || null,
    ...(consumerSecret ? { consumerSecret: encryptSecret(consumerSecret) } : {}),
    ...(passkey ? { passkey: encryptSecret(passkey) } : {}),
  };

  await prisma.mpesaConfig.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      consumerSecret: encryptSecret(consumerSecret ?? ""),
      passkey: encryptSecret(passkey ?? ""),
      ...data,
    },
    update: data,
  });

  return getSafeMpesaConfig(orgId);
}

/** Remove stored Daraja credentials for the organization. */
export async function deleteMpesaConfig(orgId: string) {
  await prisma.mpesaConfig.deleteMany({ where: { organizationId: orgId } });
}
