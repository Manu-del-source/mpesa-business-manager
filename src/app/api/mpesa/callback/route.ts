import { NextResponse, type NextRequest } from "next/server";
import { applyStkCallback, parseStkCallback } from "@/lib/mpesa/callback";
import { authenticateCallback, extractCallbackToken } from "@/lib/mpesa/callback-auth";
import { logMpesa, logMpesaError } from "@/lib/mpesa/log";
import { processPendingSettlements } from "@/lib/settlement";

/**
 * Safaricom Daraja STK Push callback endpoint.
 *
 * URL: POST /api/mpesa/callback[?token=...]
 *
 * Contract with Safaricom:
 * - Always answer HTTP 200 with `{ ResultCode: 0, ResultDesc: "..." }` once we
 *   have taken responsibility for the payload. Returning a non-200 (or a
 *   non-zero ResultCode) makes Daraja retry, which risks duplicate processing.
 * - Anything we *cannot* attribute (bad structure, unknown CheckoutRequestID)
 *   is still acknowledged — retrying will not make it valid — but it is logged
 *   loudly for investigation.
 *
 * Auth (FAIL CLOSED): Daraja cannot send custom headers, so the practical
 * control is an unguessable URL plus a shared token in the query string.
 *   - Production: MPESA_CALLBACK_TOKEN is REQUIRED. Without it every
 *     callback is rejected (403) — authentication never silently disables
 *     itself. Wrong/missing token → 401.
 *   - Development/sandbox: token enforced when configured, accepted when not.
 * Token comparison is constant-time. The token value is never logged.
 * For production also restrict ingress to Safaricom's published IP ranges.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daraja expects this exact acknowledgement envelope. */
function ack(description = "Accepted") {
  return NextResponse.json({ ResultCode: 0, ResultDesc: description }, { status: 200 });
}

function rejected(description: string, status: number) {
  return NextResponse.json({ ResultCode: 1, ResultDesc: description }, { status });
}

export async function POST(request: NextRequest) {
  // 1. Shared-secret check — fail closed in production (see callback-auth).
  const auth = authenticateCallback(extractCallbackToken(request.url));
  if (!auth.ok) {
    // 403 for the configuration error (retrying will not help; paging needed),
    // 401 for bad credentials. Never include the token in logs or responses.
    logMpesaError("callback.rejected_unauthorized", {
      reason: auth.reason,
      path: request.nextUrl.pathname,
    });
    return rejected("Unauthorized", auth.reason === "MISSING_TOKEN_CONFIG" ? 403 : 401);
  }

  // 2. Body must be JSON.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    logMpesaError("callback.invalid_json", {});
    return rejected("Invalid JSON body", 400);
  }

  // 3. Structural validation.
  const parsed = parseStkCallback(raw);
  if (!parsed.ok) {
    logMpesaError("callback.invalid_structure", { reason: parsed.error });
    // Malformed payloads will never become valid on retry — acknowledge.
    return ack("Malformed callback ignored");
  }

  // 4. Apply (idempotently). applyStkCallback persists the provider result
  //    AND enqueues settlement work in the same transaction; a failure here
  //    is a genuine server-side error, so we let Safaricom retry.
  let outcome: Awaited<ReturnType<typeof applyStkCallback>>;
  try {
    outcome = await applyStkCallback(parsed.data);
  } catch (err) {
    logMpesaError("callback.processing_error", {
      checkoutRequestId: parsed.data.checkoutRequestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return rejected("Temporary processing error", 500);
  }

  if (outcome.outcome === "unknown_transaction") {
    // Could be a callback for another environment/deployment sharing the URL.
    return ack("Unknown transaction ignored");
  }
  if (outcome.outcome === "duplicate") {
    // Safaricom retried a callback we already applied. The settlement work
    // for it is already queued/done — drive any pending retries forward.
    await drainSettlementsQuietly();
    return ack("Already processed");
  }

  logMpesa("callback.ok", {
    transactionId: outcome.transactionId,
    status: outcome.status,
  });

  // 5. Best-effort immediate settlement. Settlement is idempotent and
  //    retryable: if this pass fails (or the process dies here), the durable
  //    outbox record keeps the work pending and the worker / reconciliation
  //    sweep retries until it succeeds. The callback itself stays
  //    acknowledged so Daraja does not replay it.
  await drainSettlementsQuietly();

  return ack("Processed");
}

/** Run pending settlement work, never failing the callback response. */
async function drainSettlementsQuietly(): Promise<void> {
  try {
    await processPendingSettlements({ limit: 20 });
  } catch (err) {
    logMpesaError("settlement.drain_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Convenience probe so you can confirm the URL is reachable from outside. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "mpesa-stk-callback",
    method: "POST",
  });
}
