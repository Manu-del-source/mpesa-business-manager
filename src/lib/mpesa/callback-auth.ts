import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env, isProduction } from "@/lib/env";

/**
 * M-Pesa callback authentication.
 *
 * Daraja cannot send custom headers, so the practical shared-secret control
 * is a token appended to the callback URL: the app registers
 * `...?token=<secret>` with Safaricom and rejects requests whose token does
 * not match.
 *
 * FAIL-CLOSED semantics:
 *   - PRODUCTION: the token is REQUIRED. A deployment without
 *     MPESA_CALLBACK_TOKEN rejects EVERY callback (configuration error —
 *     loud, not silent). Missing/invalid token → reject; valid token →
 *     accept.
 *   - DEVELOPMENT/SANDBOX: if a token is configured it is enforced exactly
 *     as in production; if unset, callbacks are accepted so local flows and
 *     CI work without secrets (the typical local Daraja-sandbox setup also
 *     relies on the unguessable callback URL).
 *
 * Comparison is constant-time (timingSafeEqual) to avoid leaking the token
 * through response-timing differences.
 */

export type CallbackAuthResult =
  | { ok: true }
  | {
      ok: false;
      /** Why the request is rejected (safe to return to the caller). */
      reason: "MISSING_TOKEN_CONFIG" | "MISSING_TOKEN" | "INVALID_TOKEN";
      /** Human-readable explanation for logs (never contains the token). */
      detail: string;
    };

/** Constant-time string comparison; length mismatch still runs a compare. */
export function safeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against itself to keep the timing profile uniform, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Token as sent by Safaricom: ?token=... query parameter. */
export function extractCallbackToken(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("token");
  } catch {
    return null;
  }
}

/**
 * Authenticate an incoming callback request.
 *
 * @param presentedToken the `token` query parameter from the request (may be
 *                       null), or a value already extracted upstream.
 */
export function authenticateCallback(
  presentedToken: string | null,
): CallbackAuthResult {
  const configured = env.mpesaCallbackToken;

  if (!configured) {
    if (isProduction()) {
      // FAIL CLOSED: production without a configured token must not accept
      // unauthenticated callbacks.
      return {
        ok: false,
        reason: "MISSING_TOKEN_CONFIG",
        detail:
          "MPESA_CALLBACK_TOKEN is not configured; production callbacks are " +
          "rejected until it is set.",
      };
    }
    // Development/sandbox without a token: accept (unguessable URL).
    return { ok: true };
  }

  if (presentedToken === null || presentedToken === "") {
    return {
      ok: false,
      reason: "MISSING_TOKEN",
      detail: "Callback is missing the required token.",
    };
  }

  if (!safeTokenEqual(presentedToken, configured)) {
    return {
      ok: false,
      reason: "INVALID_TOKEN",
      detail: "Callback token does not match.",
    };
  }

  return { ok: true };
}
