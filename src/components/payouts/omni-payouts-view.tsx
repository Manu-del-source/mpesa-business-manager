"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  fetchPayouts,
  createPayout,
  cancelPayout,
  type PayoutItem,
  type CreatePayoutPayload,
} from "@/lib/api/payouts";
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
import { LiveActionDialog } from "@/components/layout/live-action-dialog";

const STATUS_OPTIONS = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"];

export function OmniPayoutsView({
  environment,
  applicationName,
  canCreate,
}: {
  environment: "SANDBOX" | "LIVE";
  applicationName: string;
  canCreate: boolean;
}) {
  const [items, setItems] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreatePayoutPayload>({ amountMinor: 0, recipientPhone: "", recipientName: "", description: "" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PayoutItem | null>(null);

  const load = useCallback(async (opts?: { append?: boolean; cursor?: string | null }) => {
    try {
      if (opts?.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      const res = await fetchPayouts({ status: statusFilter || undefined, cursor: opts?.cursor ?? undefined, limit: 25 });
      setItems((prev) => (opts?.append ? [...prev, ...res.data] : res.data));
      setCursor(res.pagination.nextCursor);
      setHasMore(res.pagination.hasMore);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load payouts.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  function openCreate() {
    setForm({ amountMinor: 0, recipientPhone: "", recipientName: "", description: "" });
    setCreateError(null);
    setCreateOpen(true);
  }

  async function doCreate() {
    setSubmitting(true);
    try {
      const payload: CreatePayoutPayload = { ...form, idempotencyKey: crypto.randomUUID() };
      const created = await createPayout(payload);
      setItems((prev) => [created, ...prev]);
      setCreateOpen(false);
      setConfirmOpen(false);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Failed to create payout.");
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amountMinor || form.amountMinor <= 0 || !form.recipientPhone.trim()) {
      setCreateError("Amount and recipient phone are required.");
      return;
    }
    if (environment === "LIVE") {
      setCreateOpen(false);
      setConfirmOpen(true);
    } else {
      void doCreate();
    }
  }

  async function doCancel() {
    if (!cancelTarget) return;
    try {
      await cancelPayout(cancelTarget.id);
      setCancelTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to cancel payout.");
      throw err;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader title="Payouts" description="Send money out to recipients via M-Pesa B2C.">
        {canCreate && (
          <button
            onClick={openCreate}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">outbox</span>
            <span>Send Payout</span>
          </button>
        )}
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
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Recipient</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Amount</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Status</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Created</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm font-body-sm">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td className="p-4" colSpan={5}><Skeleton className="h-5 w-full" /></td></tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <OmniEmptyState icon="outbox" title="No payouts yet" description="Payouts sent from this application will appear here." />
                  </td>
                </tr>
              ) : (
                items.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-container/60 transition-colors">
                    <td className="p-4">
                      <div className="text-primary font-medium">{p.recipientName || formatPhone(p.recipientPhone)}</div>
                      <div className="text-code-sm font-code-sm text-outline">{formatPhone(p.recipientPhone)}</div>
                    </td>
                    <td className="p-4 text-right font-code-md text-code-md font-semibold text-primary">
                      {formatMinorUnits(p.amountMinor, p.currency)}
                    </td>
                    <td className="p-4">
                      <StatusBadge status={p.status} />
                      {p.errorMessage && <div className="text-body-sm text-red-700 mt-0.5">{p.errorMessage}</div>}
                    </td>
                    <td className="p-4 text-on-surface-variant">{formatDateTime(p.createdAt)}</td>
                    <td className="p-4 text-right">
                      {canCreate && (p.status === "PENDING" || p.status === "PROCESSING") && (
                        <button onClick={() => setCancelTarget(p)} className="text-outline hover:text-red-700 transition-colors" title="Cancel payout">
                          <span className="material-symbols-outlined text-[18px]">block</span>
                        </button>
                      )}
                    </td>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">Send Payout</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {createError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{createError}</p>
              )}
              <div className="space-y-1.5">
                <Label>Amount (KES)</Label>
                <Input
                  type="number"
                  min={1}
                  step="0.01"
                  required
                  value={form.amountMinor ? form.amountMinor / 100 : ""}
                  onChange={(e) => setForm((f) => ({ ...f, amountMinor: Math.round(parseFloat(e.target.value || "0") * 100) }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Recipient phone</Label>
                <Input required placeholder="2547XXXXXXXX" value={form.recipientPhone} onChange={(e) => setForm((f) => ({ ...f, recipientPhone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Recipient name (optional)</Label>
                <Input value={form.recipientName} onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {environment === "LIVE" ? "Review & Confirm" : "Send Payout"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LiveActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm Live Payout"
        actionName="Send Payout"
        environment={environment}
        applicationName={applicationName}
        amountMinor={form.amountMinor}
        recipient={form.recipientName || form.recipientPhone}
        details={form.description}
        consequences="This sends real money to the recipient in the LIVE production environment. This cannot be undone."
        onConfirm={doCreate}
      />

      <LiveActionDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Confirm Cancel Payout"
        actionName="Cancel Payout"
        environment={environment}
        applicationName={applicationName}
        amountMinor={cancelTarget?.amountMinor}
        recipient={cancelTarget?.recipientName || (cancelTarget ? formatPhone(cancelTarget.recipientPhone) : undefined)}
        consequences="Cancelling only stops payouts that have not yet been sent to the provider."
        onConfirm={doCancel}
      />
    </div>
  );
}
