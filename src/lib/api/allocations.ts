import { apiFetch, RequestOptions } from "./client";

export type SplitDefinition = {
  accountId: string;
  type: "percentage" | "fixed";
  value: number;
};

export type AllocationRuleItem = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  priority: number;
  versions: Array<{
    id: string;
    version: number;
    splits: SplitDefinition[];
    roundingMode: string;
    active: boolean;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type AppliedAllocationItem = {
  id: string;
  paymentId: string;
  paymentReference: string | null;
  paymentAmountMinor: string;
  ruleName: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  amountMinor: string;
  currency: string;
  percentage: number | null;
  roundingApplied: string | null;
  createdAt: string;
};

export type CreateRulePayload = {
  name: string;
  description?: string;
  priority?: number;
  roundingMode?: "HALF_UP" | "HALF_DOWN" | "TRUNCATE" | "CEIL";
  splits: SplitDefinition[];
};

export async function fetchAllocationRules(options?: RequestOptions): Promise<AllocationRuleItem[]> {
  const res = await apiFetch<{ data: AllocationRuleItem[] }>("/api/v1/allocations/rules", options);
  return res.data;
}

export async function createAllocationRule(
  payload: CreateRulePayload,
  options?: RequestOptions
): Promise<AllocationRuleItem> {
  const res = await apiFetch<{ data: AllocationRuleItem }>("/api/v1/allocations/rules", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function createRuleVersion(
  ruleId: string,
  splits: SplitDefinition[],
  roundingMode: "HALF_UP" | "HALF_DOWN" | "TRUNCATE" | "CEIL" = "HALF_UP",
  options?: RequestOptions
) {
  const res = await apiFetch<{ data: unknown }>(`/api/v1/allocations/rules/${ruleId}/versions`, {
    ...options,
    method: "POST",
    body: JSON.stringify({ splits, roundingMode }),
  });
  return res.data;
}

export async function fetchAppliedAllocations(
  paymentId?: string,
  options?: RequestOptions
): Promise<AppliedAllocationItem[]> {
  const res = await apiFetch<{ data: AppliedAllocationItem[] }>("/api/v1/allocations", {
    ...options,
    params: { paymentId, ...options?.params },
  });
  return res.data;
}
