"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  fetchJournal,
  postJournalEntry,
  voidJournalEntry,
  type FlatLedgerEntry,
  type PostJournalPayload,
} from "@/lib/api/ledger";
import { fetchAccounts, type AccountItem } from "@/lib/api/accounts";
import { ApiClientError } from "@/lib/api/client";
import { formatMinorUnits, formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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

type DraftLine = { accountId: string; type: "DEBIT" | "CREDIT"; amount: string; description: string };

const emptyLine = (): DraftLine => ({ accountId: "", type: "DEBIT", amount: "", description: "" });

export function OmniLedgerView({
  environment,
  applicationName,
  canPost,
}: {
  environment: "SANDBOX" | "LIVE";
  applicationName: string;
  canPost: boolean;
}) {
  const [entries, setEntries] = useState<FlatLedgerEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [postOpen, setPostOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [postError, setPostError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [voidTarget, setVoidTarget] = useState<{ journalId: string; description: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async (opts?: { append?: boolean; cursor?: string | null }) => {
    try {
      if (opts?.append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      const res = await fetchJournal({ accountId: accountFilter || undefined, cursor: opts?.cursor ?? undefined, limit: 30 });
      setEntries((prev) => (opts?.append ? [...prev, ...res.flatEntries] : res.flatEntries));
      setCursor(res.pagination.nextCursor);
      setHasMore(res.pagination.hasMore);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load the ledger.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [accountFilter]);

  useEffect(() => {
    void load();
    fetchAccounts(false).then(setAccounts).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountFilter]);

  const totalDebit = lines.reduce((sum, l) => sum + (l.type === "DEBIT" ? parseFloat(l.amount || "0") : 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.type === "CREDIT" ? parseFloat(l.amount || "0") : 0), 0);
  const balanced = lines.length >= 2 && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  function openPost() {
    setDescription("");
    setReference("");
    setLines([emptyLine(), emptyLine()]);
    setPostError(null);
    setPostOpen(true);
  }

  function buildPayload(): PostJournalPayload {
    return {
      description,
      reference: reference || undefined,
      entries: lines
        .filter((l) => l.accountId && l.amount)
        .map((l) => ({
          accountId: l.accountId,
          type: l.type,
          amountMinor: Math.round(parseFloat(l.amount) * 100),
          description: l.description || undefined,
        })),
    };
  }

  async function doPost() {
    setSubmitting(true);
    try {
      await postJournalEntry(buildPayload());
      setPostOpen(false);
      setConfirmOpen(false);
      await load();
    } catch (err) {
      setPostError(err instanceof ApiClientError ? err.message : "Failed to post journal entry.");
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  function handlePostSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setPostError("Description is required.");
      return;
    }
    if (!balanced) {
      setPostError("Debits and credits must balance before posting.");
      return;
    }
    if (environment === "LIVE") {
      setPostOpen(false);
      setConfirmOpen(true);
    } else {
      void doPost();
    }
  }

  async function doVoid() {
    if (!voidTarget) return;
    try {
      await voidJournalEntry(voidTarget.journalId, voidReason);
      setVoidTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to void journal entry.");
      throw err;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader title="Ledger" description="General journal of every double-entry line posted by this application.">
        {canPost && (
          <button
            onClick={openPost}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">post_add</span>
            <span>Post Entry</span>
          </button>
        )}
      </OmniPageHeader>

      <div className="relative min-w-[200px] max-w-xs">
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="w-full h-10 pl-3 pr-8 appearance-none border border-outline-variant rounded-lg bg-surface-container-lowest text-body-md font-body-md focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
          ))}
        </select>
        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-outline text-[18px]">
          expand_more
        </span>
      </div>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Description</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Account</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Debit</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Credit</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Posted</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm font-body-sm">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-4" colSpan={6}><Skeleton className="h-5 w-full" /></td>
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <OmniEmptyState
                      icon="account_balance_wallet"
                      title="No ledger entries"
                      description="Journal entries posted by payments, payouts, refunds, and manual entries will appear here."
                    />
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className={`hover:bg-surface-container/60 transition-colors ${e.voided ? "opacity-50" : ""}`}>
                    <td className="p-4">
                      {e.description}
                      {e.voided && <Badge variant="muted" className="ml-2">Voided</Badge>}
                      {e.reference && <div className="text-code-sm font-code-sm text-outline">{e.reference}</div>}
                    </td>
                    <td className="p-4 text-on-surface-variant">
                      <span className="font-code-sm text-code-sm mr-1">{e.accountCode}</span>
                      {e.accountName}
                    </td>
                    <td className="p-4 text-right font-code-md text-code-md">
                      {e.type === "DEBIT" ? formatMinorUnits(e.amountMinor, e.currency) : ""}
                    </td>
                    <td className="p-4 text-right font-code-md text-code-md">
                      {e.type === "CREDIT" ? formatMinorUnits(e.amountMinor, e.currency) : ""}
                    </td>
                    <td className="p-4 text-on-surface-variant">{formatDateTime(e.timestamp)}</td>
                    <td className="p-4 text-right">
                      {canPost && !e.voided && (
                        <button
                          onClick={() => { setVoidTarget({ journalId: e.journalId, description: e.description }); setVoidReason(""); }}
                          className="text-outline hover:text-red-700 transition-colors"
                          title="Void this journal entry"
                        >
                          <span className="material-symbols-outlined text-[18px]">undo</span>
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

      {/* Post Entry Dialog */}
      <Dialog open={postOpen} onOpenChange={setPostOpen}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-lg">
          <form onSubmit={handlePostSubmit}>
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">Post Journal Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              {postError && (
                <p className="text-body-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{postError}</p>
              )}
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input required value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Reference (optional)</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Entry lines</Label>
                {lines.map((line, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Select value={line.accountId} onValueChange={(v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, accountId: v } : l)))}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Account" /></SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={line.type} onValueChange={(v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, type: v as "DEBIT" | "CREDIT" } : l)))}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DEBIT">Debit</SelectItem>
                        <SelectItem value="CREDIT">Credit</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      placeholder="0.00"
                      className="w-28"
                      value={line.amount}
                      onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, amount: e.target.value } : l)))}
                    />
                    <button
                      type="button"
                      onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((_, j) => j !== i) : ls))}
                      className="text-outline hover:text-red-700 disabled:opacity-30"
                      disabled={lines.length <= 2}
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setLines((ls) => [...ls, emptyLine()])}
                  className="text-body-sm text-secondary hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Add line
                </button>
              </div>

              <div className={`flex items-center justify-between p-3 rounded-lg text-body-sm font-medium ${balanced ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                <span>Debits {formatMinorUnits(Math.round(totalDebit * 100))} · Credits {formatMinorUnits(Math.round(totalCredit * 100))}</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">{balanced ? "check_circle" : "warning"}</span>
                  {balanced ? "Balanced" : "Not balanced"}
                </span>
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                disabled={!balanced || submitting}
                className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 disabled:opacity-50"
              >
                {submitting ? "Posting…" : environment === "LIVE" ? "Review & Confirm" : "Post Entry"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LiveActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm Live Journal Entry"
        actionName="Post Entry"
        environment={environment}
        applicationName={applicationName}
        amountMinor={Math.round(totalDebit * 100)}
        details={description}
        consequences="This posts an irreversible entry to the LIVE ledger. Corrections require a new reversing entry, not an edit."
        onConfirm={doPost}
      />

      {/* Void confirmation */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!voidReason.trim()) return;
              void doVoid();
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">Void Journal Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              <p className="text-body-sm text-on-surface-variant">
                {voidTarget?.description} — voiding marks this entry inactive. It remains visible with a void reason for audit purposes.
              </p>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Input required value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <button
                type="submit"
                className="w-full bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded text-body-sm font-medium"
              >
                Void Entry
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
