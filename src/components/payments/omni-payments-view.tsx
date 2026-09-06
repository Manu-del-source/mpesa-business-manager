"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  fetchPayments,
  createPayment,
  type PaymentListItem,
  type CreatePaymentPayload,
} from "@/lib/api/payments";
import { ApiClientError } from "@/lib/api/client";
import { formatMinorUnits, formatDateTime, formatPhone } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status";
import { OmniPageHeader } from "@/components/shared/omni-page-header";
import { OmniEmptyState, OmniErrorBanner } from "@/components/shared/omni-empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LiveActionDialog } from "@/components/layout/live-action-dialog";

const STATUS_OPTIONS = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED"];

export function OmniPaymentsView({
  environment,
  applicationName,
  canCreate,
}: {
  environment: "SANDBOX" | "LIVE";
  applicationName: string;
  canCreate: boolean;
}) {
  const [items, setItems] = useState<PaymentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreatePaymentPayload>({
    amountMinor: 0,
    direction: "INCOMING",
    phone: "",
    customerName: "",
    description: "",
  });
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (opts?: { append?: boolean; cursor?: string | null }) => {
    try {
      if (opts?.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      const res = await fetchPayments({
        status: statusFilter || undefined,
        cursor: opts?.cursor ?? undefined,
        limit: 25,
      });
      setItems((prev) => (opts?.append ? [...prev, ...res.data] : res.data));
      setCursor(res.pagination.nextCursor);
      setHasMore(res.pagination.hasMore);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load payments.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = search
    ? items.filter(
        (p) =>
          p.reference?.toLowerCase().includes(search.toLowerCase()) ||
          p.id.toLowerCase().includes(search.toLowerCase()) ||
          p.customerName?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  function openCreate() {
    setForm({ amountMinor: 0, direction: "INCOMING", phone: "", customerName: "", description: "" });
    setIdempotencyKey(crypto.randomUUID());
    setCreateError(null);
    setCreateOpen(true);
  }

  async function doCreate() {
    setSubmitting(true);
    setCreateError(null);
    try {
      const payload: CreatePaymentPayload = { ...form, idempotencyKey };
      const created = await createPayment(payload);
      setItems((prev) => [created, ...prev]);
      setCreateOpen(false);
      setConfirmOpen(false);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Failed to create payment.");
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amountMinor || form.amountMinor <= 0) {
      setCreateError("Enter an amount greater than zero.");
      return;
    }
    if (environment === "LIVE") {
      setCreateOpen(false);
      setConfirmOpen(true);
    } else {
      void doCreate();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader
        title="Payments"
        description="Collect and monitor payment requests processed by this application."
      >
        {canCreate && (
          <button
            onClick={openCreate}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Create Payment</span>
          </button>
        )}
      </OmniPageHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
            search
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, reference, or customer..."
            className="w-full h-10 pl-10 pr-3 border border-outline-variant rounded-lg bg-surface-container-lowest text-body-md font-body-md placeholder:text-outline focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
          />
        </div>
        <div className="relative min-w-[150px]">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full h-10 pl-3 pr-8 appearance-none border border-outline-variant rounded-lg bg-surface-container-lowest text-body-md font-body-md focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-outline text-[18px]">
            expand_more
          </span>
        </div>
      </div>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase tracking-wider">
              <tr>
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
                  <tr key={i}>
                    <td className="p-4"><Skeleton className="h-5 w-28" /></td>
                    <td className="p-4"><Skeleton className="h-5 w-32" /></td>
                    <td className="p-4 text-right"><Skeleton className="h-5 w-24 ml-auto" /></td>
                    <td className="p-4"><Skeleton className="h-5 w-20" /></td>
                    <td className="p-4"><Skeleton className="h-5 w-28" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <OmniEmptyState
                      icon="payments"
                      title="No payments found"
                      description={
                        search || statusFilter
                          ? "No payments match your current filters."
                          : "Payments created by this application will appear here."
                      }
                    />
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-container/60 transition-colors">
                    <td className="p-4 font-code-md text-code-md text-on-surface-variant">
                      <Link href={`/payments/${p.id}`} className="hover:text-secondary hover:underline">
                        {p.reference || p.id}
                      </Link>
                      <div className="text-code-sm font-code-sm text-outline">{p.direction}</div>
                    </td>
                    <td className="p-4 text-primary font-medium">
                      {p.customerName || formatPhone(p.phone) || "—"}
                    </td>
                    <td className="p-4 font-code-md text-code-md text-right font-semibold text-primary">
                      {formatMinorUnits(p.amountMinor, p.currency)}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="p-4 text-on-surface-variant">{formatDateTime(p.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {hasMore && !loading && (
          <div className="p-3 border-t border-outline-variant bg-surface-container flex items-center justify-center">
            <button
              onClick={() => void load({ append: true, cursor })}
              disabled={loadingMore}
              className="text-body-sm font-medium text-secondary hover:underline disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>

      {/* Create Payment Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form onSubmit={handleFormSubmit}>
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">
                Create Payment
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {createError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  {createError}
                </p>
              )}
              <div className="space-y-1.5">
                <Label>Direction</Label>
                <Select
                  value={form.direction}
                  onValueChange={(v) => setForm((f) => ({ ...f, direction: v as "INCOMING" | "OUTGOING" }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INCOMING">Incoming (collection)</SelectItem>
                    <SelectItem value="OUTGOING">Outgoing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount (KES)</Label>
                <Input
                  type="number"
                  min={1}
                  step="0.01"
                  required
                  value={form.amountMinor ? form.amountMinor / 100 : ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amountMinor: Math.round(parseFloat(e.target.value || "0") * 100) }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone (M-Pesa)</Label>
                <Input
                  placeholder="2547XXXXXXXX"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Customer name</Label>
                <Input
                  value={form.customerName}
                  onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {environment === "LIVE" ? "Review & Confirm" : "Create Payment"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LiveActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm Live Payment"
        actionName="Create Payment"
        environment={environment}
        applicationName={applicationName}
        amountMinor={form.amountMinor}
        recipient={form.phone || form.customerName || undefined}
        details={form.description}
        onConfirm={doCreate}
      />
    </div>
  );
}
