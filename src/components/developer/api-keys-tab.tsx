"use client";

import React, { useEffect, useState, useCallback } from "react";
import { fetchApiKeys, createApiKey, revokeApiKey, type ApiKeyItem, type CreateApiKeyPayload } from "@/lib/api/api-keys";
import { ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { OmniEmptyState, OmniErrorBanner } from "@/components/shared/omni-empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SecretRevealDialog } from "@/components/shared/secret-reveal-dialog";

export function ApiKeysTab({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateApiKeyPayload>({ name: "", keyType: "SECRET", environment: "SANDBOX" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyItem | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setItems(await fetchApiKeys());
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm({ name: "", keyType: "SECRET", environment: "SANDBOX" });
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const created = await createApiKey(form);
      setItems((prev) => [{ ...created }, ...prev]);
      setCreateOpen(false);
      // Never persisted anywhere — held only in transient state until the
      // reveal dialog is dismissed.
      setRevealedSecret(created.secretKey);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Failed to create API key.");
    } finally {
      setSubmitting(false);
    }
  }

  async function doRevoke() {
    if (!revokeTarget) return;
    try {
      await revokeApiKey(revokeTarget.id);
      setRevokeTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to revoke API key.");
      throw err;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-body-sm text-on-surface-variant">
          Secret keys are shown once at creation. Public keys are safe to embed client-side.
        </p>
        {canManage && (
          <button
            onClick={openCreate}
            className="bg-primary text-on-primary px-3.5 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">vpn_key</span>
            New Key
          </button>
        )}
      </div>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
              <tr>
                <th className="p-3 px-4">Key</th>
                <th className="p-3 px-4">Type</th>
                <th className="p-3 px-4">Environment</th>
                <th className="p-3 px-4">Last used</th>
                <th className="p-3 px-4">Status</th>
                <th className="p-3 px-4 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}><td className="p-4" colSpan={6}><Skeleton className="h-5 w-full" /></td></tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={6}><OmniEmptyState icon="vpn_key" title="No API keys yet" /></td></tr>
              ) : (
                items.map((k) => (
                  <tr key={k.id}>
                    <td className="p-3 px-4">
                      <div className="text-primary font-medium">{k.name}</div>
                      <div className="text-code-sm font-code-sm text-outline">{k.keyPreview}</div>
                    </td>
                    <td className="p-3 px-4">
                      <Badge variant="outline">{k.keyType}</Badge>
                    </td>
                    <td className="p-3 px-4">
                      <Badge variant={k.environment === "LIVE" ? "destructive" : "warning"}>{k.environment}</Badge>
                    </td>
                    <td className="p-3 px-4 text-on-surface-variant">
                      {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "Never"}
                    </td>
                    <td className="p-3 px-4">
                      {k.revokedAt ? <Badge variant="muted">Revoked</Badge> : <Badge variant="success">Active</Badge>}
                    </td>
                    <td className="p-3 px-4 text-right">
                      {canManage && !k.revokedAt && (
                        <button onClick={() => setRevokeTarget(k)} className="text-outline hover:text-red-700 transition-colors" title="Revoke key">
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">New API Key</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {createError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{createError}</p>
              )}
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input required placeholder="e.g. Production backend" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={form.keyType} onValueChange={(v) => setForm((f) => ({ ...f, keyType: v as CreateApiKeyPayload["keyType"] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SECRET">Secret</SelectItem>
                      <SelectItem value="PUBLIC">Public</SelectItem>
                      <SelectItem value="WEBHOOK_SECRET">Webhook Secret</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Environment</Label>
                  <Select value={form.environment} onValueChange={(v) => setForm((f) => ({ ...f, environment: v as "SANDBOX" | "LIVE" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SANDBOX">Sandbox</SelectItem>
                      <SelectItem value="LIVE">Live</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create Key"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <SecretRevealDialog
        open={!!revealedSecret}
        onOpenChange={(o) => !o && setRevealedSecret(null)}
        title="API Key Created"
        secret={revealedSecret}
      />

      <Dialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-headline-sm font-headline-sm text-primary">Revoke API Key</DialogTitle>
          </DialogHeader>
          <p className="text-body-sm text-on-surface-variant my-2">
            Revoking <span className="font-medium text-primary">{revokeTarget?.name}</span> immediately invalidates it.
            Any integration still using this key will start failing authentication.
          </p>
          <DialogFooter>
            <button
              onClick={() => void doRevoke()}
              className="w-full bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded text-body-sm font-medium"
            >
              Revoke Key
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
