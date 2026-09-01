import { apiFetch, RequestOptions } from "./client";

export type PayoutItem = {
  id: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  amountMinor: string;
  currency: string;
  recipientPhone: string;
  recipientName: string | null;
  description: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type CreatePayoutPayload = {
  amountMinor: number;
  currency?: string;
  recipientPhone: string;
  recipientName?: string;
  description?: string;
  reference?: string;
  idempotencyKey?: string;
};

export async function fetchPayouts(
  params?: {
    status?: string;
    limit?: number;
    cursor?: string;
  },
  options?: RequestOptions
): Promise<{ data: PayoutItem[]; pagination: { hasMore: boolean; nextCursor: string | null; limit: number } }> {
  return apiFetch("/api/v1/payouts", {
    ...options,
    params: { ...params, ...options?.params },
  });
}

export async function fetchPayoutDetail(id: string, options?: RequestOptions): Promise<PayoutItem> {
  const res = await apiFetch<{ data: PayoutItem }>(`/api/v1/payouts/${id}`, options);
  return res.data;
}

export async function createPayout(
  payload: CreatePayoutPayload,
  options?: RequestOptions
): Promise<PayoutItem> {
  const res = await apiFetch<{ data: PayoutItem }>("/api/v1/payouts", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function cancelPayout(id: string, options?: RequestOptions): Promise<PayoutItem> {
  const res = await apiFetch<{ data: PayoutItem }>(`/api/v1/payouts/${id}/cancel`, {
    ...options,
    method: "POST",
  });
  return res.data;
}
