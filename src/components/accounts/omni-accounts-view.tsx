"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  fetchAccounts,
  createAccount,
  type AccountItem,
  type CreateAccountPayload,
} from "@/lib/api/accounts";
import { ApiClientError } from "@/lib/api/client";
import { formatMinorUnits } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge, type BadgeProps } from "@/components/ui/badge";
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

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

const TYPE_COLORS: Record<string, string> = {
  ASSET: "success",
  LIABILITY: "warning",
  EQUITY: "info",
  REVENUE: "default",
  EXPENSE: "destructive",
};

export function OmniAccountsView({ canCreate }: { canCreate: boolean }) {
  const [items, setItems] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateAccountPayload>({ code: "", name: "", type: "ASSET" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchAccounts(true);
      setItems(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setForm({ code: "", name: "", type: "ASSET" });
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      setCreateError("Code and name are required.");
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const created = await createAccount(form);
      setItems((prev) => [...prev, created]);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Failed to create account.");
    } finally {
      setSubmitting(false);
    }
  }

  const grouped = ACCOUNT_TYPES.map((type) => ({
    type,
    accounts: items.filter((a) => a.type === type),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader title="Accounts" description="Chart of accounts underlying the double-entry ledger.">
        {canCreate && (
          <button
            onClick={openCreate}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>New Account</span>
          </button>
        )}
      </OmniPageHeader>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl">
          <OmniEmptyState
            icon="account_balance"
            title="No accounts yet"
            description="Create your chart of accounts to start posting ledger entries."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <div key={g.type} className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
              <div className="p-4 border-b border-outline-variant bg-surface-container flex items-center gap-2">
                <Badge variant={(TYPE_COLORS[g.type] as never) ?? "default"} className="uppercase">
                  {g.type}
                </Badge>
                <span className="text-body-sm text-on-surface-variant">{g.accounts.length} accounts</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <tbody className="divide-y divide-outline-variant text-body-sm">
                    {g.accounts.map((a) => (
                      <tr key={a.id} className="hover:bg-surface-container/60 transition-colors">
                        <td className="p-4 w-24 font-code-md text-code-md text-on-surface-variant">{a.code}</td>
                        <td className="p-4">
                          <Link href={`/accounts/${a.id}`} className="text-primary font-medium hover:text-secondary hover:underline">
                            {a.name}
                          </Link>
                          {a.description && <div className="text-body-sm text-on-surface-variant">{a.description}</div>}
                        </td>
                        <td className="p-4 text-right font-code-md text-code-md font-semibold text-primary">
                          {formatMinorUnits(a.balanceMinor ?? "0", a.currency)}
                        </td>
                        <td className="p-4 text-right w-24">
                          {!a.active && <Badge variant="muted">Inactive</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">New Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {createError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  {createError}
                </p>
              )}
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input
                  required
                  placeholder="e.g. 1000"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  required
                  placeholder="e.g. M-Pesa Collections"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as CreateAccountPayload["type"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Input
                  value={form.description ?? ""}
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
                {submitting ? "Creating…" : "Create Account"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
