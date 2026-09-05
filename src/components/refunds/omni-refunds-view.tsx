"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchRefunds, type RefundItem } from "@/lib/api/refunds";
import { ApiClientError } from "@/lib/api/client";
import { formatMinorUnits, formatDateTime, formatPhone } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status";
import { OmniPageHeader } from "@/components/shared/omni-page-header";
import { OmniEmptyState, OmniErrorBanner } from "@/components/shared/omni-empty-state";

const STATUS_OPTIONS = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"];

export function OmniRefundsView() {
  const [items, setItems] = useState<RefundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (opts?: { append?: boolean; cursor?: string | null }) => {
    try {
      if (opts?.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      const res = await fetchRefunds({ status: statusFilter || undefined, cursor: opts?.cursor ?? undefined, limit: 25 });
      setItems((prev) => (opts?.append ? [...prev, ...res.data] : res.data));
      setCursor(res.pagination.nextCursor);
      setHasMore(res.pagination.hasMore);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load refunds.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader
        title="Refunds"
        description="Refunds are issued from a payment's detail page and tracked here for the full picture."
      >
        <Link
          href="/payments"
          className="bg-surface-container-low hover:bg-surface-container text-primary border border-outline-variant px-3.5 py-2 rounded text-body-sm font-medium transition-colors flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[18px]">search</span>
          Find a payment to refund
        </Link>
      </OmniPageHeader>

      <div className="relative min-w-[150px] max-w-xs">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full h-10 pl-3 pr-8 appearance-none border border-outline-variant rounded-lg bg-surface-container-lowest text-body-md font-body-md focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-outline text-[18px]">expand_more</span>
      </div>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Refund</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Payment</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Customer</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Amount</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Status</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm font-body-sm">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td className="p-4" colSpan={6}><Skeleton className="h-5 w-full" /></td></tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <OmniEmptyState
                      icon="sync"
                      title="No refunds yet"
                      description={statusFilter ? "No refunds match this filter." : "Refunds issued for payments will be tracked here."}
                    />
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-container/60 transition-colors">
                    <td className="p-4 font-code-sm text-code-sm text-on-surface-variant">{r.id}</td>
                    <td className="p-4">
                      <Link href={`/payments/${r.paymentId}`} className="text-secondary hover:underline font-code-sm text-code-sm">
                        {r.paymentReference || r.paymentId}
                      </Link>
                    </td>
                    <td className="p-4 text-primary font-medium">{r.customerName || formatPhone(r.customerPhone) || "—"}</td>
                    <td className="p-4 text-right font-code-md text-code-md font-semibold text-primary">
                      {formatMinorUnits(r.amountMinor, r.currency)}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={r.status} />
                      {r.errorMessage && <div className="text-body-sm text-red-700 mt-0.5">{r.errorMessage}</div>}
                    </td>
                    <td className="p-4 text-on-surface-variant">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {hasMore && !loading && (
          <div className="p-3 border-t border-outline-variant bg-surface-container flex items-center justify-center">
            <button onClick={() => void load({ append: true, cursor })} disabled={loadingMore} className="text-body-sm font-medium text-secondary hover:underline disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
