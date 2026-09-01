import { type NextRequest } from "next/server";
import { withApiKeyAuth, requirePermission, apiError } from "@/lib/middleware";
import { prisma } from "@/lib/prisma";
import { getAccountBalances } from "@/lib/ledger";

/**
 * GET /v1/dashboard
 *
 * Provides authoritative dashboard metrics for the active application and environment:
 * - totalProcessedMinor: sum of SUCCEEDED payments
 * - availableBalanceMinor: net balance of ASSET accounts
 * - pendingPayoutsMinor: sum of PENDING / PROCESSING payouts
 * - successRatePercent: SUCCEEDED / (SUCCEEDED + FAILED + CANCELLED) * 100
 * - paymentVolume: aggregate volume series (7d / 30d)
 * - recentTransactions: latest transactions
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKeyAuth(request, { requiredScopes: ["payments:read"] });
  if (ctx instanceof Response) return ctx;

  const permErr = requirePermission(ctx, "payments:read");
  if (permErr) return permErr;

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "7D"; // 24H, 7D, 30D

  const now = new Date();
  let periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "24H") {
    periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === "30D") {
    periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  // 1. Total processed (SUCCEEDED payments)
  const succeededAgg = await prisma.payment.aggregate({
    where: {
      applicationId: ctx.application.id,
      environment: ctx.environment,
      status: "SUCCEEDED",
    },
    _sum: { amountMinor: true },
    _count: true,
  });
  const totalProcessedMinor = (succeededAgg._sum.amountMinor ?? 0n).toString();
  const succeededCount = succeededAgg._count;

  // 2. Total failed & cancelled count for success rate calculation
  const otherStatusCounts = await prisma.payment.groupBy({
    by: ["status"],
    where: {
      applicationId: ctx.application.id,
      environment: ctx.environment,
    },
    _count: { id: true },
  });

  let failedCount = 0;
  let cancelledCount = 0;
  let pendingCount = 0;

  for (const row of otherStatusCounts) {
    if (row.status === "FAILED") failedCount = row._count.id;
    if (row.status === "CANCELLED") cancelledCount = row._count.id;
    if (row.status === "PENDING" || row.status === "PROCESSING") pendingCount += row._count.id;
  }

  const completedTotal = succeededCount + failedCount + cancelledCount;
  const successRate = completedTotal > 0 ? ((succeededCount / completedTotal) * 100).toFixed(1) : "100.0";

  // 3. Pending Payouts
  const pendingPayoutsAgg = await prisma.payout.aggregate({
    where: {
      applicationId: ctx.application.id,
      environment: ctx.environment,
      status: { in: ["PENDING", "PROCESSING"] },
    },
    _sum: { amountMinor: true },
    _count: true,
  });
  const pendingPayoutsMinor = (pendingPayoutsAgg._sum.amountMinor ?? 0n).toString();
  const pendingPayoutsCount = pendingPayoutsAgg._count;

  // 4. Balances from ledger accounts
  let availableBalanceMinor = "0";
  try {
    const balances = await getAccountBalances(ctx.application.id, ctx.environment);
    let assetNet = 0n;
    for (const b of balances) {
      if (b.type === "ASSET") {
        assetNet += b.balanceMinor;
      }
    }
    availableBalanceMinor = assetNet.toString();
  } catch {
    availableBalanceMinor = totalProcessedMinor;
  }

  // 5. Recent transactions
  const recentPayments = await prisma.payment.findMany({
    where: {
      applicationId: ctx.application.id,
      environment: ctx.environment,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      providerRefs: { take: 1 },
    },
  });

  const recentTransactions = recentPayments.map((p) => ({
    id: p.id,
    reference: p.reference || p.idempotencyKey || `TXN_${p.id.slice(-6).toUpperCase()}`,
    amountMinor: p.amountMinor.toString(),
    currency: p.currency,
    status: p.status,
    phone: p.phone,
    customerName: p.customerName || p.phone || "Walk-in Customer",
    provider: p.providerRefs[0]?.provider || "M-Pesa (Daraja)",
    createdAt: p.createdAt.toISOString(),
  }));

  // 6. Payment volume breakdown (daily buckets for chart)
  const volumePayments = await prisma.payment.findMany({
    where: {
      applicationId: ctx.application.id,
      environment: ctx.environment,
      createdAt: { gte: periodStart },
    },
    select: {
      createdAt: true,
      amountMinor: true,
      status: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const daysMap = new Map<string, { totalMinor: bigint; count: number }>();
  const daysCount = period === "24H" ? 24 : period === "30D" ? 30 : 7;

  if (period === "24H") {
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60 * 1000);
      const label = d.getHours().toString().padStart(2, "0") + ":00";
      daysMap.set(label, { totalMinor: 0n, count: 0 });
    }
    for (const p of volumePayments) {
      const d = new Date(p.createdAt);
      const label = d.getHours().toString().padStart(2, "0") + ":00";
      const bucket = daysMap.get(label);
      if (bucket) {
        bucket.totalMinor += p.amountMinor;
        bucket.count++;
      }
    }
  } else {
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const label = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
      daysMap.set(label, { totalMinor: 0n, count: 0 });
    }
    for (const p of volumePayments) {
      const d = new Date(p.createdAt);
      const label = d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
      const bucket = daysMap.get(label);
      if (bucket) {
        bucket.totalMinor += p.amountMinor;
        bucket.count++;
      }
    }
  }

  const volumeChart = Array.from(daysMap.entries()).map(([label, val]) => ({
    label,
    amountMinor: val.totalMinor.toString(),
    amount: Number(val.totalMinor) / 100,
    count: val.count,
  }));

  return Response.json({
    data: {
      totalProcessedMinor,
      succeededCount,
      availableBalanceMinor,
      pendingPayoutsMinor,
      pendingPayoutsCount,
      pendingCount,
      failedCount,
      cancelledCount,
      successRatePercent: successRate,
      volumeChart,
      recentTransactions,
    },
    meta: {
      requestId: ctx.requestId,
      environment: ctx.environment,
      application: ctx.application.slug,
    },
  });
}
