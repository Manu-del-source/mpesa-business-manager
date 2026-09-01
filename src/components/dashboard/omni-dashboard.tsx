"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { fetchDashboardMetrics, DashboardMetrics } from "@/lib/api/dashboard";
import { formatMinorUnits } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status";

export function OmniDashboardView({ initialData }: { initialData?: DashboardMetrics }) {
  const [period, setPeriod] = useState<"24H" | "7D" | "30D">("7D");
  const [data, setData] = useState<DashboardMetrics | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Retry" to re-run the fetch effect for the current period.
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    // Guard against a slow response for a previous period overwriting the
    // data for the period the user is now looking at.
    let cancelled = false;
    const controller = new AbortController();

    async function loadData() {
      setLoading(true);
      try {
        const metrics = await fetchDashboardMetrics(period, {
          signal: controller.signal,
        });
        if (cancelled) return;
        setData(metrics);
        setError(null);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "Failed to load dashboard metrics",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [period, reloadNonce]);

  return (
    <div className="flex flex-col gap-6">
      {/* Subtitle / Context */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-body-md font-body-md text-on-surface-variant">
            Monitor payments, balances, and real-time financial activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/payments"
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Create Payment</span>
          </Link>
          <Link
            href="/payouts"
            className="bg-surface-container-low hover:bg-surface-container text-primary border border-outline-variant px-3.5 py-2 rounded text-body-sm font-medium transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">outbox</span>
            <span>Send Payout</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">error</span>
            <span className="text-body-sm">{error}</span>
          </div>
          <button
            onClick={() => setReloadNonce((n) => n + 1)}
            className="text-body-sm underline font-semibold hover:text-red-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* Bento Grid: Financial Summaries */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Processed */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between shadow-[0px_1px_2px_rgba(0,0,0,0.03)]">
          <div className="flex justify-between items-start mb-3">
            <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
              Total Processed
            </span>
            <span className="material-symbols-outlined text-secondary text-[22px]">monitoring</span>
          </div>
          <div>
            {loading && !data ? (
              <Skeleton className="h-9 w-36 mb-2" />
            ) : (
              <div className="text-headline-md font-headline-md text-primary font-bold tracking-tight">
                {formatMinorUnits(data?.totalProcessedMinor ?? "0")}
              </div>
            )}
            <div className="flex items-center gap-1 mt-1.5 text-code-sm font-code-sm">
              <span className="text-[#059669] flex items-center font-medium">
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                {data?.succeededCount ?? 0}
              </span>
              <span className="text-on-surface-variant">settled payments</span>
            </div>
          </div>
        </div>

        {/* Card 2: Success Rate */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between shadow-[0px_1px_2px_rgba(0,0,0,0.03)]">
          <div className="flex justify-between items-start mb-3">
            <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
              Success Rate
            </span>
            <span className="material-symbols-outlined text-secondary text-[22px]">check_circle</span>
          </div>
          <div>
            {loading && !data ? (
              <Skeleton className="h-9 w-24 mb-2" />
            ) : (
              <div className="text-headline-md font-headline-md text-primary font-bold tracking-tight">
                {data?.successRatePercent ?? "100.0"}%
              </div>
            )}
            <div className="flex items-center gap-1 mt-1.5 text-code-sm font-code-sm">
              <span className="text-on-surface-variant">
                {data?.failedCount ?? 0} failed • {data?.pendingCount ?? 0} in-flight
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Pending Payouts */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between shadow-[0px_1px_2px_rgba(0,0,0,0.03)]">
          <div className="flex justify-between items-start mb-3">
            <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
              Pending Payouts
            </span>
            <span className="material-symbols-outlined text-secondary text-[22px]">outbox</span>
          </div>
          <div>
            {loading && !data ? (
              <Skeleton className="h-9 w-32 mb-2" />
            ) : (
              <div className="text-headline-md font-headline-md text-primary font-bold tracking-tight">
                {formatMinorUnits(data?.pendingPayoutsMinor ?? "0")}
              </div>
            )}
            <div className="flex items-center gap-1 mt-1.5 text-code-sm font-code-sm">
              <span className="text-on-surface-variant">
                {data?.pendingPayoutsCount ?? 0} payouts queued
              </span>
            </div>
          </div>
        </div>

        {/* Card 4: Available Balance */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 flex flex-col justify-between shadow-[0px_1px_2px_rgba(0,0,0,0.03)]">
          <div className="flex justify-between items-start mb-3">
            <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
              Available Balance
            </span>
            <span className="material-symbols-outlined text-secondary text-[22px]">account_balance_wallet</span>
          </div>
          <div>
            {loading && !data ? (
              <Skeleton className="h-9 w-36 mb-2" />
            ) : (
              <div className="text-headline-md font-headline-md text-primary font-bold tracking-tight">
                {formatMinorUnits(data?.availableBalanceMinor ?? "0")}
              </div>
            )}
            <div className="flex items-center gap-1 mt-1.5 text-code-sm font-code-sm">
              <span className="text-on-surface-variant">Liquid ledger assets</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart Section: Payment Volume */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-[0px_1px_2px_rgba(0,0,0,0.03)]">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
          <div>
            <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Payment Volume</h3>
            <p className="text-body-sm font-body-sm text-on-surface-variant">
              Aggregated settlement volume for the selected timeframe.
            </p>
          </div>
          <div className="flex gap-1.5 p-1 bg-surface-container-low border border-outline-variant rounded-lg">
            {(["24H", "7D", "30D"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded text-label-caps font-label-caps transition-all ${
                  period === p
                    ? "border border-secondary text-secondary bg-secondary-fixed/40 font-bold"
                    : "text-on-surface-variant hover:text-primary hover:bg-surface-container"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Recharts Area Chart */}
        <div className="w-full h-56 pt-2">
          {loading && !data ? (
            <Skeleton className="w-full h-full rounded-lg" />
          ) : data?.volumeChart && data.volumeChart.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.volumeChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="omniVolumeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#316bf3" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#316bf3" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  stroke="#76777d"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: "#c6c6cd" }}
                />
                <YAxis
                  stroke="#76777d"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: "#c6c6cd" }}
                  tickFormatter={(val) => `KES ${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload as { label: string; amountMinor: string; count: number };
                      return (
                        <div className="p-3 bg-slate-900 text-white rounded-lg shadow-lg border border-slate-700 text-xs">
                          <p className="font-semibold">{item.label}</p>
                          <p className="text-emerald-400 font-mono mt-1 font-bold">
                            {formatMinorUnits(item.amountMinor)}
                          </p>
                          <p className="text-slate-400 mt-0.5">{item.count} payments</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="#316bf3"
                  strokeWidth={2}
                  fill="url(#omniVolumeGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-on-surface-variant text-body-sm">
              No volume recorded in this period.
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions Table */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden shadow-[0px_1px_2px_rgba(0,0,0,0.03)]">
        <div className="p-5 border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest">
          <div>
            <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Recent Transactions</h3>
            <p className="text-body-sm font-body-sm text-on-surface-variant">
              Latest payment activity processed by the platform.
            </p>
          </div>
          <Link
            href="/payments"
            className="text-label-caps font-label-caps text-secondary hover:underline uppercase flex items-center gap-1 font-bold"
          >
            <span>View All</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant text-label-caps font-label-caps text-on-surface-variant uppercase tracking-wider">
                <th className="p-4 font-semibold">Transaction ID</th>
                <th className="p-4 font-semibold">Customer</th>
                <th className="p-4 font-semibold">Provider</th>
                <th className="p-4 font-semibold text-right">Amount</th>
                <th className="p-4 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm font-body-sm">
              {loading && !data ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-4"><Skeleton className="h-5 w-24" /></td>
                    <td className="p-4"><Skeleton className="h-5 w-32" /></td>
                    <td className="p-4"><Skeleton className="h-5 w-20" /></td>
                    <td className="p-4 text-right"><Skeleton className="h-5 w-24 ml-auto" /></td>
                    <td className="p-4 text-right"><Skeleton className="h-5 w-20 ml-auto" /></td>
                  </tr>
                ))
              ) : data?.recentTransactions && data.recentTransactions.length > 0 ? (
                data.recentTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-surface-container/60 transition-colors group cursor-pointer"
                  >
                    <td className="p-4 font-code-md text-code-md text-on-surface-variant">
                      <Link href={`/payments/${tx.id}`} className="hover:text-secondary hover:underline">
                        {tx.reference}
                      </Link>
                    </td>
                    <td className="p-4 text-primary font-medium">
                      {tx.customerName}
                    </td>
                    <td className="p-4 text-on-surface-variant flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-outline">
                        smartphone
                      </span>
                      <span>{tx.provider}</span>
                    </td>
                    <td className="p-4 font-code-md text-code-md text-right font-semibold text-primary">
                      {formatMinorUnits(tx.amountMinor, tx.currency)}
                    </td>
                    <td className="p-4 text-right">
                      <StatusBadge status={tx.status} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-on-surface-variant text-body-sm">
                    No transactions recorded yet. Create a payment to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
