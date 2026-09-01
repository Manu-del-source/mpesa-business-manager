import { apiFetch, RequestOptions } from "./client";

export type DashboardMetrics = {
  totalProcessedMinor: string;
  succeededCount: number;
  availableBalanceMinor: string;
  pendingPayoutsMinor: string;
  pendingPayoutsCount: number;
  pendingCount: number;
  failedCount: number;
  cancelledCount: number;
  successRatePercent: string;
  volumeChart: Array<{
    label: string;
    amountMinor: string;
    amount: number;
    count: number;
  }>;
  recentTransactions: Array<{
    id: string;
    reference: string;
    amountMinor: string;
    currency: string;
    status: string;
    phone: string | null;
    customerName: string;
    provider: string;
    createdAt: string;
  }>;
};

export async function fetchDashboardMetrics(
  period: "24H" | "7D" | "30D" = "7D",
  options?: RequestOptions
): Promise<DashboardMetrics> {
  const res = await apiFetch<{ data: DashboardMetrics }>("/api/v1/dashboard", {
    ...options,
    params: { period, ...options?.params },
  });
  return res.data;
}
