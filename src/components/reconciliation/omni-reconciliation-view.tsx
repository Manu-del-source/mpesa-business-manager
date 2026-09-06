"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  fetchReconciliationRuns,
  fetchReconciliationRunDetail,
  triggerReconciliation,
  resolveReconciliationException,
  type ReconciliationRunSummary,
  type ReconciliationRunDetail,
} from "@/lib/api/reconciliation";
import { ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status";
import { OmniPageHeader } from "@/components/shared/omni-page-header";
import { OmniEmptyState, OmniErrorBanner } from "@/components/shared/omni-empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OmniReconciliationView({ canRun }: { canRun: boolean }) {
  const [runs, setRuns] = useState<ReconciliationRunSummary[]>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReconciliationRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [triggering, setTriggering] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<{ id: string; description: string } | null>(null);
  const [resolution, setResolution] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchReconciliationRuns(20);
      setRuns(res.data);
      setUnresolvedCount(res.summary.unresolvedExceptions);
      if (res.data.length > 0 && !selectedRunId) setSelectedRunId(res.data[0].runId);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load reconciliation runs.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = useCallback(async (runId: string) => {
    try {
      setDetailLoading(true);
      const d = await fetchReconciliationRunDetail(runId);
      setDetail(d);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load run detail.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedRunId) void loadDetail(selectedRunId);
  }, [selectedRunId, loadDetail]);

  async function handleTrigger() {
    setTriggering(true);
    setError(null);
    try {
      const res = await triggerReconciliation();
      await load();
      setSelectedRunId(res.runId);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to start reconciliation run.");
    } finally {
      setTriggering(false);
    }
  }

  async function doResolve() {
    if (!resolveTarget) return;
    try {
      await resolveReconciliationException(resolveTarget.id, resolution);
      setResolveTarget(null);
      setResolution("");
      if (selectedRunId) await loadDetail(selectedRunId);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to resolve exception.");
      throw err;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <OmniPageHeader
        title="Reconciliation"
        description="Compare internal payment records against the provider's ledger to catch discrepancies."
      >
        {unresolvedCount > 0 && (
          <Badge variant="destructive">{unresolvedCount} unresolved exception{unresolvedCount === 1 ? "" : "s"}</Badge>
        )}
        {canRun && (
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">compare_arrows</span>
            {triggering ? "Running…" : "Run Reconciliation"}
          </button>
        )}
      </OmniPageHeader>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Run</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Status</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Checked</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Matched</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant text-right">Discrepancies</th>
                <th className="py-3 px-4 font-semibold border-b border-outline-variant">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm font-body-sm">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}><td className="p-4" colSpan={6}><Skeleton className="h-5 w-full" /></td></tr>
                ))
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <OmniEmptyState icon="compare_arrows" title="No reconciliation runs yet" description="Run a reconciliation to compare your ledger against the provider." />
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr
                    key={r.runId}
                    onClick={() => setSelectedRunId(r.runId)}
                    className={`cursor-pointer hover:bg-surface-container/60 transition-colors ${selectedRunId === r.runId ? "bg-surface-container/80" : ""}`}
                  >
                    <td className="p-4 font-code-sm text-code-sm text-on-surface-variant">{r.runId}</td>
                    <td className="p-4"><StatusBadge status={r.status} /></td>
                    <td className="p-4 text-right font-code-md text-code-md">{r.totalChecked}</td>
                    <td className="p-4 text-right font-code-md text-code-md text-emerald-700">{r.matched}</td>
                    <td className="p-4 text-right font-code-md text-code-md text-red-700">{r.discrepancies}</td>
                    <td className="p-4 text-on-surface-variant">{formatDateTime(r.startedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRunId && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          <div className="p-5 border-b border-outline-variant">
            <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Exceptions</h3>
            <p className="text-body-sm text-on-surface-variant">Discrepancies found in run {selectedRunId}.</p>
          </div>
          {detailLoading ? (
            <div className="p-5"><Skeleton className="h-24 w-full" /></div>
          ) : !detail || detail.exceptions.length === 0 ? (
            <OmniEmptyState icon="check_circle" title="No exceptions" description="Every checked payment matched the provider's record." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
                  <tr>
                    <th className="p-3 px-4">Payment</th>
                    <th className="p-3 px-4">Type</th>
                    <th className="p-3 px-4">Severity</th>
                    <th className="p-3 px-4">Description</th>
                    <th className="p-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant text-body-sm">
                  {detail.exceptions.map((ex) => (
                    <tr key={ex.id}>
                      <td className="p-3 px-4 font-code-sm text-code-sm">
                        {ex.paymentReference || ex.paymentId || "—"}
                      </td>
                      <td className="p-3 px-4">{ex.type}</td>
                      <td className="p-3 px-4">
                        <Badge variant={ex.severity === "HIGH" || ex.severity === "CRITICAL" ? "destructive" : "warning"}>
                          {ex.severity}
                        </Badge>
                      </td>
                      <td className="p-3 px-4 max-w-xs">
                        {ex.description}
                        {ex.suggestedAction && (
                          <div className="text-body-sm text-on-surface-variant mt-0.5">Suggested: {ex.suggestedAction}</div>
                        )}
                      </td>
                      <td className="p-3 px-4">
                        {ex.resolved ? (
                          <Badge variant="success">Resolved</Badge>
                        ) : canRun ? (
                          <button
                            onClick={() => setResolveTarget({ id: ex.id, description: ex.description })}
                            className="text-body-sm text-secondary hover:underline font-medium"
                          >
                            Resolve
                          </button>
                        ) : (
                          <Badge variant="muted">Open</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!resolveTarget} onOpenChange={(o) => !o && setResolveTarget(null)}>
        <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!resolution.trim()) return;
              void doResolve();
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-headline-sm font-headline-sm text-primary">Resolve Exception</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 my-4">
              <p className="text-body-sm text-on-surface-variant">{resolveTarget?.description}</p>
              <div className="space-y-1.5">
                <Label>Resolution notes</Label>
                <Input required value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. Matched manually against provider statement" />
              </div>
            </div>
            <DialogFooter>
              <button type="submit" className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90">
                Mark Resolved
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
