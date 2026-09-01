import { apiFetch, RequestOptions } from "./client";

export type ReconciliationRunSummary = {
  runId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  totalChecked: number;
  matched: number;
  discrepancies: number;
};

export type ReconciliationRunDetail = {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  totalChecked: number;
  matched: number;
  discrepancies: number;
  error: string | null;
  items: Array<{
    id: string;
    paymentId: string | null;
    paymentReference: string | null;
    paymentAmountMinor: string | null;
    externalId: string | null;
    internalStatus: string | null;
    externalStatus: string | null;
    match: boolean;
    discrepancyType: string | null;
    details: Record<string, unknown> | null;
    createdAt: string;
  }>;
  exceptions: Array<{
    id: string;
    paymentId: string | null;
    paymentReference: string | null;
    type: string;
    severity: string;
    description: string;
    suggestedAction: string | null;
    resolved: boolean;
    resolvedAt: string | null;
    resolvedBy: string | null;
    resolution: string | null;
    createdAt: string;
  }>;
};

export async function fetchReconciliationRuns(
  limit = 20,
  options?: RequestOptions
): Promise<{ data: ReconciliationRunSummary[]; summary: { unresolvedExceptions: number } }> {
  return apiFetch("/api/v1/reconciliation/runs", {
    ...options,
    params: { limit, ...options?.params },
  });
}

export async function fetchReconciliationRunDetail(
  id: string,
  options?: RequestOptions
): Promise<ReconciliationRunDetail> {
  const res = await apiFetch<{ data: ReconciliationRunDetail }>(`/api/v1/reconciliation/runs/${id}`, options);
  return res.data;
}

export async function triggerReconciliation(
  maxAgeMs?: number,
  options?: RequestOptions
): Promise<{ runId: string; status: string; totalChecked: number; matched: number; discrepancies: number; exceptions: number }> {
  const res = await apiFetch<{ data: { runId: string; status: string; totalChecked: number; matched: number; discrepancies: number; exceptions: number } }>(
    "/api/v1/reconciliation/runs",
    {
      ...options,
      method: "POST",
      body: JSON.stringify({ maxAge: maxAgeMs }),
    }
  );
  return res.data;
}

export async function resolveReconciliationException(
  exceptionId: string,
  resolution: string,
  options?: RequestOptions
): Promise<{ id: string; resolved: boolean; resolution: string }> {
  const res = await apiFetch<{ data: { id: string; resolved: boolean; resolution: string } }>(
    `/api/v1/reconciliation/exceptions/${exceptionId}/resolve`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify({ resolution }),
    }
  );
  return res.data;
}
