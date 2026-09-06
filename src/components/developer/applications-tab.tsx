"use client";

import React, { useEffect, useState, useCallback } from "react";
import { fetchApplications, createApplication, type ApplicationItem, type CreateApplicationPayload } from "@/lib/api/applications";
import { ApiClientError } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { OmniEmptyState, OmniErrorBanner } from "@/components/shared/omni-empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function ApplicationsTab({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setItems(await fetchApplications());
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load applications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      setCreateError("Name and slug are required.");
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const payload: CreateApplicationPayload = { name, slug, description: description || undefined };
      const created = await createApplication(payload);
      setItems((prev) => [...prev, created]);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Failed to create application.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-body-sm text-on-surface-variant">
          Applications isolate API keys, payments, and ledgers within your tenant.
        </p>
        {canManage && (
          <button
            onClick={openCreate}
            className="bg-primary text-on-primary px-3.5 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Application
          </button>
        )}
      </div>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
              <tr>
                <th className="p-3 px-4">Application</th>
                <th className="p-3 px-4 text-right">Payments</th>
                <th className="p-3 px-4 text-right">API Keys</th>
                <th className="p-3 px-4 text-right">Accounts</th>
                <th className="p-3 px-4 text-right">Webhooks</th>
                <th className="p-3 px-4">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}><td className="p-4" colSpan={6}><Skeleton className="h-5 w-full" /></td></tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={6}><OmniEmptyState icon="apps" title="No applications yet" /></td></tr>
              ) : (
                items.map((a) => (
                  <tr key={a.id}>
                    <td className="p-3 px-4">
                      <div className="text-primary font-medium">{a.name}</div>
                      <div className="text-code-sm font-code-sm text-outline">{a.slug}</div>
                    </td>
                    <td className="p-3 px-4 text-right font-code-md text-code-md">{a.paymentCount}</td>
                    <td className="p-3 px-4 text-right font-code-md text-code-md">{a.apiKeyCount}</td>
                    <td className="p-3 px-4 text-right font-code-md text-code-md">{a.accountCount}</td>
                    <td className="p-3 px-4 text-right font-code-md text-code-md">{a.webhookCount}</td>
                    <td className="p-3 px-4 text-on-surface-variant">{formatDate(a.createdAt)}</td>
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
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">New Application</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {createError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{createError}</p>
              )}
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input
                  required
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                />
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
                {submitting ? "Creating…" : "Create Application"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
