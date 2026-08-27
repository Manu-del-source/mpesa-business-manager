/**
 * Centralized, typed access to environment variables.
 *
 * Demo mode is explicit: set DEMO_MODE=true for local/demo environments.
 * Supabase credentials may still be omitted in demo mode.
 *
 * SECURITY: every Daraja/M-Pesa value below is server-only. None of them are
 * `NEXT_PUBLIC_*`, so they are never inlined into the client bundle. Do not
 * import this module's Daraja fields from a "use client" component.
 */
export const env = {
  /**
   * The four values below are read lazily (getters) rather than snapshotted
   * at module load: the process may receive them after import (delayed env
   * injection, test harnesses), and reading them at point-of-use keeps a
   * single source of truth in process.env.
   */
  get nodeEnv() {
    return process.env.NODE_ENV ?? "development";
  },
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  demoMode: process.env.DEMO_MODE === "true",

  /**
   * Publicly reachable base URL Safaricom will POST callbacks to. Must be
   * HTTPS and internet-reachable in sandbox/production (use a tunnel locally).
   * Falls back to NEXT_PUBLIC_APP_URL when unset.
   */
  mpesaCallbackBaseUrl: process.env.MPESA_CALLBACK_BASE_URL ?? "",
  /**
   * Shared secret appended to the callback URL as `?token=...`.
   * Daraja cannot send custom headers, so a URL token plus payload validation
   * is the practical way to reject spoofed callbacks.
   *
   * REQUIRED IN PRODUCTION (fail closed): when NODE_ENV=production and no
   * token is configured, ALL callbacks are rejected — authentication never
   * silently disables itself. See src/lib/mpesa/callback-auth.ts.
   */
  get mpesaCallbackToken() {
    return process.env.MPESA_CALLBACK_TOKEN ?? "";
  },
  /**
   * 32-byte key (base64 or 64-char hex) used to encrypt Daraja consumer
   * secrets and passkeys at rest. Strongly recommended in production.
   */
  get mpesaCredentialsKey() {
    return process.env.MPESA_CREDENTIALS_KEY ?? "";
  },
  /** Milliseconds before a Daraja HTTP request is aborted. */
  darajaTimeoutMs: Number(process.env.DARAJA_TIMEOUT_MS ?? 20_000),

  // --- Legacy single-tenant fallback ---------------------------------------
  // Pre-existing deployments configured Daraja through env vars. These are
  // still honoured as a fallback when an organization has no MpesaConfig row.
  darajaEnabled: process.env.DARAJA_ENABLED === "true",
  darajaConsumerKey: process.env.DARAJA_CONSUMER_KEY ?? "",
  darajaConsumerSecret: process.env.DARAJA_CONSUMER_SECRET ?? "",
  darajaPasskey: process.env.DARAJA_PASSKEY ?? "",
  darajaShortcode: process.env.DARAJA_SHORTCODE ?? "",
  darajaEnvironment: process.env.DARAJA_ENVIRONMENT ?? "sandbox",
} as const;

export function isDemoMode(): boolean {
  return env.demoMode;
}

/**
 * True when running in production (`NODE_ENV=production`). Used by
 * fail-closed security checks: features that are optional in development
 * (e.g. the M-Pesa callback token) become REQUIRED here.
 */
export function isProduction(): boolean {
  return env.nodeEnv === "production";
}

/**
 * True when the legacy env-var Daraja credentials are complete and enabled.
 * Per-organization configuration (MpesaConfig) takes precedence over this.
 */
export function isDarajaConfigured(): boolean {
  return (
    env.darajaEnabled &&
    Boolean(
      env.darajaConsumerKey &&
        env.darajaConsumerSecret &&
        env.darajaShortcode &&
        env.darajaPasskey,
    )
  );
}

/** Base URL Safaricom should call back on, without a trailing slash. */
export function callbackBaseUrl(): string {
  const base = env.mpesaCallbackBaseUrl || env.appUrl;
  return base.replace(/\/+$/, "");
}

export function assertDatabaseConfigured(): void {
  if (!env.databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Start PostgreSQL and set DATABASE_URL in .env.",
    );
  }
}
