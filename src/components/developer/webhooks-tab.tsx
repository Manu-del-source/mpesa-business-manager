"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  fetchWebhookEndpoints,
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  fetchWebhookDeliveries,
  type WebhookEndpointItem,
  type WebhookDeliveryItem,
  type CreateWebhookPayload,
} from "@/lib/api/webhooks";
import { ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status";
import { OmniEmptyState, OmniErrorBanner } from "@/components/shared/omni-empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecretRevealDialog } from "@/components/shared/secret-reveal-dialog";

const EVENT_OPTIONS = [
  "payment.succeeded",
  "payment.failed",
  "payout.succeeded",
  "payout.failed",
  "refund.succeeded",
  "reconciliation.discrepancy",
];

export function WebhooksTab({ canManage }: { canManage: boolean }) {
  const [endpoints, setEndpoints] = useState<WebhookEndpointItem[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<WebhookEndpointItem | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [eps, dels] = await Promise.all([fetchWebhookEndpoints(), fetchWebhookDeliveries()]);
      setEndpoints(eps);
      setDeliveries(dels);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load webhooks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setUrl("");
    setEvents([]);
    setDescription("");
    setCreateError(null);
    setCreateOpen(true);
  }

  function toggleEvent(evt: string) {
    setEvents((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !url.startsWith("https://")) {
      setCreateError("A valid HTTPS URL is required.");
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const payload: CreateWebhookPayload = { url, events: events.length ? events : undefined, description: description || undefined };
      const created = await createWebhookEndpoint(payload);
      setEndpoints((prev) => [{ ...created }, ...prev]);
      setCreateOpen(false);
      setRevealedSecret(created.secret);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Failed to create webhook endpoint.");
    } finally {
      setSubmitting(false);
    }
  }

  async function doDeactivate() {
    if (!deactivateTarget) return;
    try {
      await deactivateWebhookEndpoint(deactivateTarget.id);
      setDeactivateTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to deactivate webhook.");
      throw err;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-body-sm text-on-surface-variant">Endpoints that receive event notifications, signed with a per-endpoint secret.</p>
          {canManage && (
            <button
              onClick={openCreate}
              className="bg-primary text-on-primary px-3.5 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">webhook</span>
              New Endpoint
            </button>
          )}
        </div>

        {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
                <tr>
                  <th className="p-3 px-4">Endpoint</th>
                  <th className="p-3 px-4">Events</th>
                  <th className="p-3 px-4">Status</th>
                  <th className="p-3 px-4">Last triggered</th>
                  <th className="p-3 px-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-body-sm">
                {loading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <tr key={i}><td className="p-4" colSpan={5}><Skeleton className="h-5 w-full" /></td></tr>
                  ))
                ) : endpoints.length === 0 ? (
                  <tr><td colSpan={5}><OmniEmptyState icon="webhook" title="No webhook endpoints yet" /></td></tr>
                ) : (
                  endpoints.map((ep) => (
                    <tr key={ep.id}>
                      <td className="p-3 px-4 font-code-sm text-code-sm truncate max-w-[220px]">{ep.url}</td>
                      <td className="p-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {ep.events.length === 0 ? (
                            <span className="text-on-surface-variant">All events</span>
                          ) : (
                            ep.events.map((e) => <Badge key={e} variant="outline">{e}</Badge>)
                          )}
                        </div>
                      </td>
                      <td className="p-3 px-4">{ep.active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>}</td>
                      <td className="p-3 px-4 text-on-surface-variant">{ep.lastTriggeredAt ? formatDateTime(ep.lastTriggeredAt) : "Never"}</td>
                      <td className="p-3 px-4 text-right">
                        {canManage && ep.active && (
                          <button onClick={() => setDeactivateTarget(ep)} className="text-outline hover:text-red-700 transition-colors" title="Deactivate">
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
        </div>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="p-5 border-b border-outline-variant">
          <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Recent Deliveries</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
              <tr>
                <th className="p-3 px-4">Event</th>
                <th className="p-3 px-4">Endpoint</th>
                <th className="p-3 px-4">Status</th>
                <th className="p-3 px-4">HTTP</th>
                <th className="p-3 px-4">Attempts</th>
                <th className="p-3 px-4">Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm">
              {loading ? (
                <tr><td className="p-4" colSpan={6}><Skeleton className="h-5 w-full" /></td></tr>
              ) : deliveries.length === 0 ? (
                <tr><td colSpan={6}><OmniEmptyState icon="history" title="No deliveries yet" /></td></tr>
              ) : (
                deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="p-3 px-4">{d.eventType}</td>
                    <td className="p-3 px-4 font-code-sm text-code-sm truncate max-w-[180px]">{d.endpointUrl}</td>
                    <td className="p-3 px-4"><StatusBadge status={d.status} /></td>
                    <td className="p-3 px-4 font-code-sm text-code-sm">{d.httpStatusCode ?? "—"}</td>
                    <td className="p-3 px-4">{d.attempts}/{d.maxAttempts}</td>
                    <td className="p-3 px-4 text-on-surface-variant">{d.deliveredAt ? formatDateTime(d.deliveredAt) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">New Webhook Endpoint</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {createError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{createError}</p>
              )}
              <div className="space-y-1.5">
                <Label>Endpoint URL</Label>
                <Input required placeholder="https://example.com/webhooks" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Events (leave empty for all)</Label>
                <div className="flex flex-wrap gap-2">
                  {EVENT_OPTIONS.map((evt) => (
                    <button
                      key={evt}
                      type="button"
                      onClick={() => toggleEvent(evt)}
                      className={`px-2.5 py-1 rounded-md text-body-sm font-code-sm border transition-colors ${
                        events.includes(evt)
                          ? "bg-primary text-on-primary border-primary"
                          : "bg-surface-container border-outline-variant text-on-surface-variant"
                      }`}
                    >
                      {evt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create Endpoint"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SecretRevealDialog
        open={!!revealedSecret}
        onOpenChange={(o) => !o && setRevealedSecret(null)}
        title="Webhook Signing Secret"
        secret={revealedSecret}
        warning="Use this to verify webhook signatures. It won't be shown again — store it securely now."
      />

      <Dialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-headline-sm font-headline-sm text-primary">Deactivate Endpoint</DialogTitle>
          </DialogHeader>
          <p className="text-body-sm text-on-surface-variant my-2">
            <span className="font-code-sm">{deactivateTarget?.url}</span> will stop receiving event deliveries.
          </p>
          <DialogFooter>
            <button
              onClick={() => void doDeactivate()}
              className="w-full bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded text-body-sm font-medium"
            >
              Deactivate
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
