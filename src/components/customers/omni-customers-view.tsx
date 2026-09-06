"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  fetchCustomers,
  createCustomer,
  type CustomerItem,
  type CreateCustomerPayload,
} from "@/lib/api/customers";
import { ApiClientError } from "@/lib/api/client";
import { formatMinorUnits, formatPhone, formatRelative } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
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

export function OmniCustomersView({ canCreate }: { canCreate: boolean }) {
  const [items, setItems] = useState<CustomerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateCustomerPayload>({ name: "", phone: "", email: "", location: "" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (q?: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchCustomers(q || undefined);
      setItems(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function openCreate() {
    setForm({ name: "", phone: "", email: "", location: "" });
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
      const created = await createCustomer(form);
      setItems((prev) => [created, ...prev]);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Failed to create customer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader title="Customers" description="People who have paid or been paid by this application.">
        {canCreate && (
          <button
            onClick={openCreate}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>Add Customer</span>
          </button>
        )}
      </OmniPageHeader>

      <div className="relative flex-1 min-w-[200px] max-w-md">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
          search
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, or email..."
          className="w-full h-10 pl-10 pr-3 border border-outline-variant rounded-lg bg-surface-container-lowest text-body-md font-body-md placeholder:text-outline focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
        />
      </div>

      {error && <OmniErrorBanner message={error} onRetry={() => void load(search)} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Customer</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Contact</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Payments</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Total volume</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm font-body-sm">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-4"><Skeleton className="h-5 w-32" /></td>
                    <td className="p-4"><Skeleton className="h-5 w-32" /></td>
                    <td className="p-4 text-right"><Skeleton className="h-5 w-10 ml-auto" /></td>
                    <td className="p-4 text-right"><Skeleton className="h-5 w-24 ml-auto" /></td>
                    <td className="p-4"><Skeleton className="h-5 w-20" /></td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <OmniEmptyState
                      icon="group"
                      title="No customers yet"
                      description="Customers who pay through this application will be tracked here automatically."
                    />
                  </td>
                </tr>
              ) : (
                items.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-container/60 transition-colors">
                    <td className="p-4 text-primary font-medium">
                      {c.name}
                      {c.location && <div className="text-body-sm text-on-surface-variant">{c.location}</div>}
                    </td>
                    <td className="p-4 text-on-surface-variant">{formatPhone(c.phone) || c.email || "—"}</td>
                    <td className="p-4 text-right font-code-md text-code-md">{c.paymentCount}</td>
                    <td className="p-4 text-right font-code-md text-code-md font-semibold text-primary">
                      {formatMinorUnits(c.totalVolumeMinor)}
                    </td>
                    <td className="p-4 text-on-surface-variant">
                      {c.lastActivity ? formatRelative(c.lastActivity) : "—"}
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
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">Add Customer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {createError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  {createError}
                </p>
              )}
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Add Customer"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
