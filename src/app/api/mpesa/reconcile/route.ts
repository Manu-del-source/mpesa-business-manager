import { NextResponse, type NextRequest } from "next/server";
import { reconcilePendingTransactions } from "@/lib/mpesa/reconcile";
import { logMpesaError } from "@/lib/mpesa/log";

/**
 * Scheduled reconciliation endpoint.
 *
 * POST (or GET) /api/mpesa/reconcile
 *   Authorization: Bearer <MPESA_CRON_SECRET>
 *   — or —  ?token=<MPESA_CRON_SECRET>
 *
 * Sweeps STK pushes stuck in PENDING because their callback never arrived and
 * settles them from Safaricom's own STK Push Query result.
 *
 * Wire this to a scheduler (Vercel Cron, GitHub Actions, systemd timer, k8s
 * CronJob) every 5–15 minutes. It is a no-op when nothing is stale, and it is
 * safe to run concurrently: every write is guarded by `status: PENDING`.
 *
 * The endpoint refuses to run unless MPESA_CRON_SECRET is configured, so it
 * can never be left publicly triggerable by accident.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(request: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.MPESA_CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "Reconciliation is disabled: MPESA_CRON_SECRET is not configured.",
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const token = bearer || request.nextUrl.searchParams.get("token") || "";

  if (token !== secret) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

async function handle(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    if (auth.status === 401) logMpesaError("reconcile.unauthorized", {});
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const orgId = request.nextUrl.searchParams.get("orgId") ?? undefined;
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : undefined;

  try {
    const summary = await reconcilePendingTransactions({ orgId, limit });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    logMpesaError("reconcile.route_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "Reconciliation failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

/** Some schedulers can only issue GETs. */
export async function GET(request: NextRequest) {
  return handle(request);
}
