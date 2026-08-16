import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { applyStkCallback, parseStkCallback } from "@/lib/mpesa/callback";
import { logMpesa, logMpesaError } from "@/lib/mpesa/log";

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
 * Auth: Daraja cannot send custom headers, so the practical control is an
 * unguessable URL. Set MPESA_CALLBACK_TOKEN and the app appends `?token=...`
 * to the CallBackURL it registers; requests with the wrong token are rejected.
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
  // 1. Shared-secret check (only when configured).
  if (env.mpesaCallbackToken) {
    const token = request.nextUrl.searchParams.get("token");
    if (token !== env.mpesaCallbackToken) {
      logMpesaError("callback.rejected_bad_token", {
        path: request.nextUrl.pathname,
      });
      return rejected("Unauthorized", 401);
    }
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

  // 4. Apply (idempotently).
  try {
    const result = await applyStkCallback(parsed.data);

    if (result.outcome === "unknown_transaction") {
      // Could be a callback for another environment/deployment sharing the URL.
      return ack("Unknown transaction ignored");
    }
    if (result.outcome === "duplicate") {
      return ack("Already processed");
    }

    logMpesa("callback.ok", {
      transactionId: result.transactionId,
      status: result.status,
    });
    return ack("Processed");
  } catch (err) {
    // A genuine server-side failure: let Safaricom retry.
    logMpesaError("callback.processing_error", {
      checkoutRequestId: parsed.data.checkoutRequestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return rejected("Temporary processing error", 500);
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
