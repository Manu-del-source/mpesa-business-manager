"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  fetchPaymentDetail,
  cancelPayment,
  type PaymentDetail,
} from "@/lib/api/payments";
import { createRefund } from "@/lib/api/refunds";
import { ApiClientError } from "@/lib/api/client";
import { formatMinorUnits, formatDateTime, formatPhone } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status";
import { OmniErrorBanner } from "@/components/shared/omni-empty-state";
import { LiveActionDialog } from "@/components/layout/live-action-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OmniPaymentDetailView({
  paymentId,
  environment,
  applicationName,
  canCancel,
  canRefund,
}: {
  paymentId: string;
  environment: "SANDBOX" | "LIVE";
  applicationName: string;
  canCancel: boolean;
  canRefund: boolean;
}) {
  const [data, setData] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundConfirmOpen, setRefundConfirmOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const detail = await fetchPaymentDetail(paymentId);
      setData(detail);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load payment.");
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doCancel() {
    try {
      await cancelPayment(paymentId);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Failed to cancel payment.");
      throw err;
    }
  }

  async function doRefund() {
    setRefundSubmitting(true);
    try {
      await createRefund({
        paymentId,
        amountMinor: refundAmount,
        reason: refundReason || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setRefundDialogOpen(false);
      setRefundConfirmOpen(false);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : "Failed to create refund.");
      throw err;
    } finally {
      setRefundSubmitting(false);
    }
  }

  function openRefund() {
    if (!data) return;
    const alreadyRefunded = data.refunds
      .filter((r) => r.status !== "FAILED" && r.status !== "CANCELLED")
      .reduce((sum, r) => sum + Number(r.amountMinor), 0);
    setRefundAmount(Math.max(Number(data.amountMinor) - alreadyRefunded, 0));
    setRefundReason("");
    setActionError(null);
    setRefundDialogOpen(true);
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return <OmniErrorBanner message={error} onRetry={() => void load()} />;
  }

  if (!data) return null;

  const refundableMinor =
    Number(data.amountMinor) -
    data.refunds
      .filter((r) => r.status !== "FAILED" && r.status !== "CANCELLED")
      .reduce((sum, r) => sum + Number(r.amountMinor), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Link href="/payments" className="text-body-sm text-secondary hover:underline flex items-center gap-1 mb-2">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            All payments
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-headline-md font-headline-md text-primary font-bold">
              {data.reference || data.id}
            </h1>
            <StatusBadge status={data.status} />
          </div>
          <p className="text-body-sm text-on-surface-variant font-code-sm mt-1">{data.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {canRefund && data.status === "SUCCEEDED" && refundableMinor > 0 && (
            <button
              onClick={openRefund}
              className="bg-surface-container-low hover:bg-surface-container text-primary border border-outline-variant px-3.5 py-2 rounded text-body-sm font-medium transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">sync</span>
              Refund
            </button>
          )}
          {canCancel && (data.status === "PENDING" || data.status === "PROCESSING") && (
            <button
              onClick={() => setCancelConfirmOpen(true)}
              className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3.5 py-2 rounded text-body-sm font-medium transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">block</span>
              Cancel
            </button>
          )}
        </div>
      </div>

      {(error || actionError) && (
        <OmniErrorBanner message={actionError || error || ""} onRetry={() => void load()} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
          <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
            Amount
          </span>
          <div className="text-headline-md font-headline-md text-primary font-bold mt-2">
            {formatMinorUnits(data.amountMinor, data.currency)}
          </div>
          <div className="text-body-sm text-on-surface-variant mt-1">
            Fee {formatMinorUnits(data.feeMinor, data.currency)} · Net {formatMinorUnits(data.netMinor, data.currency)}
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
          <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
            Customer
          </span>
          <div className="text-body-md font-medium text-primary mt-2">{data.customerName || "—"}</div>
          <div className="text-body-sm text-on-surface-variant mt-1">
            {formatPhone(data.phone) || data.email || "No contact on file"}
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
          <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
            Provider
          </span>
          <div className="text-body-md font-medium text-primary mt-2">{data.provider.name}</div>
          <div className="text-body-sm text-on-surface-variant mt-1 font-code-sm">
            {data.provider.receiptNumber || data.provider.checkoutRequestId || "Awaiting provider reference"}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
        <h3 className="text-headline-sm font-headline-sm text-primary font-bold mb-4">Timeline</h3>
        <div className="space-y-4">
          {data.timeline.length === 0 && (
            <p className="text-body-sm text-on-surface-variant">No timeline events recorded.</p>
          )}
          {data.timeline.map((t, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-secondary mt-1.5" />
                {i < data.timeline.length - 1 && <div className="w-px flex-1 bg-outline-variant" />}
              </div>
              <div className="pb-4">
                <p className="text-body-sm font-medium text-primary">{t.title}</p>
                {t.details && <p className="text-body-sm text-on-surface-variant">{t.details}</p>}
                <p className="text-code-sm font-code-sm text-outline mt-0.5">{formatDateTime(t.timestamp)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ledger Impact */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="p-5 border-b border-outline-variant">
          <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Ledger Impact</h3>
          <p className="text-body-sm text-on-surface-variant">Double-entry journal lines posted for this payment.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
              <tr>
                <th className="p-3 px-4">Account</th>
                <th className="p-3 px-4">Type</th>
                <th className="p-3 px-4 text-right">Amount</th>
                <th className="p-3 px-4">Posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm">
              {data.ledgerImpact.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-on-surface-variant">
                    No ledger entries yet.
                  </td>
                </tr>
              ) : (
                data.ledgerImpact.map((l) => (
                  <tr key={l.id}>
                    <td className="p-3 px-4">
                      <span className="font-code-sm text-code-sm text-outline mr-1.5">{l.accountCode}</span>
                      {l.accountName}
                    </td>
                    <td className="p-3 px-4">
                      <span
                        className={`text-label-caps font-label-caps uppercase ${l.type === "DEBIT" ? "text-secondary" : "text-primary"}`}
                      >
                        {l.type}
                      </span>
                    </td>
                    <td className="p-3 px-4 text-right font-code-md text-code-md">
                      {formatMinorUnits(l.amountMinor, l.currency)}
                    </td>
                    <td className="p-3 px-4 text-on-surface-variant">{formatDateTime(l.postedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Allocations */}
      {data.allocations.length > 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          <div className="p-5 border-b border-outline-variant">
            <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Allocations</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
                <tr>
                  <th className="p-3 px-4">Account</th>
                  <th className="p-3 px-4 text-right">Amount</th>
                  <th className="p-3 px-4 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-body-sm">
                {data.allocations.map((a) => (
                  <tr key={a.id}>
                    <td className="p-3 px-4">
                      <span className="font-code-sm text-code-sm text-outline mr-1.5">{a.accountCode}</span>
                      {a.accountName}
                    </td>
                    <td className="p-3 px-4 text-right font-code-md text-code-md">
                      {formatMinorUnits(a.amountMinor)}
                    </td>
                    <td className="p-3 px-4 text-right text-on-surface-variant">
                      {a.percentage !== null ? `${a.percentage}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Refunds */}
      {data.refunds.length > 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          <div className="p-5 border-b border-outline-variant">
            <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Refunds</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
                <tr>
                  <th className="p-3 px-4">Refund</th>
                  <th className="p-3 px-4 text-right">Amount</th>
                  <th className="p-3 px-4">Status</th>
                  <th className="p-3 px-4">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-body-sm">
                {data.refunds.map((r) => (
                  <tr key={r.id}>
                    <td className="p-3 px-4 font-code-sm text-code-sm text-on-surface-variant">{r.id}</td>
                    <td className="p-3 px-4 text-right font-code-md text-code-md">
                      {formatMinorUnits(r.amountMinor)}
                    </td>
                    <td className="p-3 px-4"><StatusBadge status={r.status} /></td>
                    <td className="p-3 px-4 text-on-surface-variant">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Webhook deliveries */}
      {data.webhooks.length > 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          <div className="p-5 border-b border-outline-variant">
            <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Webhook Deliveries</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
                <tr>
                  <th className="p-3 px-4">Endpoint</th>
                  <th className="p-3 px-4">Event</th>
                  <th className="p-3 px-4">Status</th>
                  <th className="p-3 px-4">Delivered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-body-sm">
                {data.webhooks.map((w) => (
                  <tr key={w.id}>
                    <td className="p-3 px-4 font-code-sm text-code-sm truncate max-w-[220px]">{w.endpointUrl}</td>
                    <td className="p-3 px-4">{w.eventType}</td>
                    <td className="p-3 px-4"><StatusBadge status={w.status} /></td>
                    <td className="p-3 px-4 text-on-surface-variant">
                      {w.deliveredAt ? formatDateTime(w.deliveredAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <LiveActionDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="Confirm Cancel Payment"
        actionName="Cancel Payment"
        environment={environment}
        applicationName={applicationName}
        amountMinor={data.amountMinor}
        recipient={data.customerName || formatPhone(data.phone) || undefined}
        consequences="Cancelling a LIVE payment stops further processing but cannot reverse funds already settled."
        onConfirm={doCancel}
      />

      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (refundAmount <= 0 || refundAmount > refundableMinor) {
                setActionError(`Refund amount must be between 1 and ${formatMinorUnits(refundableMinor)}.`);
                return;
              }
              if (environment === "LIVE") {
                setRefundDialogOpen(false);
                setRefundConfirmOpen(true);
              } else {
                void doRefund();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">Refund Payment</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              <p className="text-body-sm text-on-surface-variant">
                Refundable balance: {formatMinorUnits(refundableMinor, data.currency)}
              </p>
              <div className="space-y-1.5">
                <Label>Amount (KES)</Label>
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={refundAmount / 100}
                  onChange={(e) => setRefundAmount(Math.round(parseFloat(e.target.value || "0") * 100))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Reason (optional)</Label>
                <Input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={refundSubmitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {refundSubmitting ? "Submitting…" : environment === "LIVE" ? "Review & Confirm" : "Issue Refund"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LiveActionDialog
        open={refundConfirmOpen}
        onOpenChange={setRefundConfirmOpen}
        title="Confirm Live Refund"
        actionName="Issue Refund"
        environment={environment}
        applicationName={applicationName}
        amountMinor={refundAmount}
        recipient={data.customerName || formatPhone(data.phone) || undefined}
        details={refundReason}
        consequences="This will refund real money to the customer in the LIVE production environment. This cannot be undone."
        onConfirm={doRefund}
      />
    </div>
  );
}
