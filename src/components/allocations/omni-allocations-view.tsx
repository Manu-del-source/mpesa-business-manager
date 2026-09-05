"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  fetchAllocationRules,
  createAllocationRule,
  fetchAppliedAllocations,
  type AllocationRuleItem,
  type AppliedAllocationItem,
  type SplitDefinition,
  type CreateRulePayload,
} from "@/lib/api/allocations";
import { fetchAccounts, type AccountItem } from "@/lib/api/accounts";
import { ApiClientError } from "@/lib/api/client";
import { formatMinorUnits, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

type DraftSplit = SplitDefinition;

export function OmniAllocationsView({ canManage }: { canManage: boolean }) {
  const [rules, setRules] = useState<AllocationRuleItem[]>([]);
  const [applied, setApplied] = useState<AppliedAllocationItem[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(0);
  const [roundingMode, setRoundingMode] = useState<CreateRulePayload["roundingMode"]>("HALF_UP");
  const [splits, setSplits] = useState<DraftSplit[]>([{ accountId: "", type: "percentage", value: 0 }]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [r, a] = await Promise.all([fetchAllocationRules(), fetchAppliedAllocations()]);
      setRules(r);
      setApplied(a);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load allocations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetchAccounts(false).then(setAccounts).catch(() => {});
  }, [load]);

  function openCreate() {
    setName("");
    setDescription("");
    setPriority(0);
    setRoundingMode("HALF_UP");
    setSplits([{ accountId: "", type: "percentage", value: 0 }]);
    setCreateError(null);
    setCreateOpen(true);
  }

  const percentTotal = splits.filter((s) => s.type === "percentage").reduce((sum, s) => sum + Number(s.value), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || splits.some((s) => !s.accountId || !s.value)) {
      setCreateError("Name and every split's account and value are required.");
      return;
    }
    setSubmitting(true);
    setCreateError(null);
    try {
      const created = await createAllocationRule({ name, description: description || undefined, priority, roundingMode, splits });
      setRules((prev) => [...prev, created]);
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof ApiClientError ? err.message : "Failed to create allocation rule.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader title="Allocations" description="Split payment revenue automatically across ledger accounts.">
        {canManage && (
          <button
            onClick={openCreate}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>New Rule</span>
          </button>
        )}
      </OmniPageHeader>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="applied">Applied</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          {loading ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : rules.length === 0 ? (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl">
              <OmniEmptyState icon="pie_chart" title="No allocation rules" description="Create a rule to automatically split incoming payments across accounts." />
            </div>
          ) : (
            <div className="space-y-4">
              {rules.map((r) => {
                const active = r.versions.find((v) => v.active) ?? r.versions[r.versions.length - 1];
                return (
                  <div key={r.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div>
                        <h3 className="text-body-md font-semibold text-primary">{r.name}</h3>
                        {r.description && <p className="text-body-sm text-on-surface-variant">{r.description}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {!r.active && <Badge variant="muted">Inactive</Badge>}
                        <Badge variant="outline">Priority {r.priority}</Badge>
                      </div>
                    </div>
                    {active && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {active.splits.map((s, i) => {
                          const account = accounts.find((a) => a.id === s.accountId);
                          return (
                            <span key={i} className="px-2.5 py-1 rounded-md bg-surface-container text-body-sm font-code-sm">
                              {account?.code ?? s.accountId}: {s.type === "percentage" ? `${s.value}%` : formatMinorUnits(s.value)}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="applied" className="mt-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
                  <tr>
                    <th className="p-3 px-4">Payment</th>
                    <th className="p-3 px-4">Rule</th>
                    <th className="p-3 px-4">Account</th>
                    <th className="p-3 px-4 text-right">Amount</th>
                    <th className="p-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant text-body-sm">
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}><td className="p-4" colSpan={5}><Skeleton className="h-5 w-full" /></td></tr>
                    ))
                  ) : applied.length === 0 ? (
                    <tr><td colSpan={5}><OmniEmptyState icon="pie_chart" title="No allocations applied yet" /></td></tr>
                  ) : (
                    applied.map((a) => (
                      <tr key={a.id}>
                        <td className="p-3 px-4 font-code-sm text-code-sm">{a.paymentReference || a.paymentId}</td>
                        <td className="p-3 px-4">{a.ruleName}</td>
                        <td className="p-3 px-4 text-on-surface-variant">
                          <span className="font-code-sm text-code-sm mr-1">{a.accountCode}</span>{a.accountName}
                        </td>
                        <td className="p-3 px-4 text-right font-code-md text-code-md">{formatMinorUnits(a.amountMinor, a.currency)}</td>
                        <td className="p-3 px-4 text-on-surface-variant">{formatDate(a.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">New Allocation Rule</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {createError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{createError}</p>
              )}
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Input type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value || "0", 10))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Rounding</Label>
                  <Select value={roundingMode} onValueChange={(v) => setRoundingMode(v as CreateRulePayload["roundingMode"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HALF_UP">Half up</SelectItem>
                      <SelectItem value="HALF_DOWN">Half down</SelectItem>
                      <SelectItem value="TRUNCATE">Truncate</SelectItem>
                      <SelectItem value="CEIL">Ceiling</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Splits</Label>
                {splits.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select value={s.accountId} onValueChange={(v) => setSplits((ss) => ss.map((x, j) => (j === i ? { ...x, accountId: v } : x)))}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Account" /></SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={s.type} onValueChange={(v) => setSplits((ss) => ss.map((x, j) => (j === i ? { ...x, type: v as "percentage" | "fixed" } : x)))}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">%</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.01"
                      className="w-24"
                      value={s.value || ""}
                      onChange={(e) => setSplits((ss) => ss.map((x, j) => (j === i ? { ...x, value: parseFloat(e.target.value || "0") } : x)))}
                    />
                    <button
                      type="button"
                      onClick={() => setSplits((ss) => (ss.length > 1 ? ss.filter((_, j) => j !== i) : ss))}
                      disabled={splits.length <= 1}
                      className="text-outline hover:text-red-700 disabled:opacity-30"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSplits((ss) => [...ss, { accountId: "", type: "percentage", value: 0 }])}
                  className="text-body-sm text-secondary hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add split
                </button>
                {percentTotal > 100 && (
                  <p className="text-body-sm text-red-700">Percentage splits total {percentTotal}%, which exceeds 100%.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create Rule"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
