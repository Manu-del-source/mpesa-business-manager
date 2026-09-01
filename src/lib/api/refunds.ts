import { apiFetch, RequestOptions } from "./client";

export type RefundItem = {
  id: string;
  paymentId: string;
  paymentReference: string | null;
  paymentAmountMinor: string;
  customerPhone: string | null;
  customerName: string | null;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  amountMinor: string;
  currency: string;
  reason: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type CreateRefundPayload = {
  paymentId: string;
  amountMinor: number;
  reason?: string;
  reference?: string;
  idempotencyKey?: string;
};

export async function fetchRefunds(
  params?: {
    status?: string;
    paymentId?: string;
    limit?: number;
    cursor?: string;
  },
  options?: RequestOptions
): Promise<{ data: RefundItem[]; pagination: { hasMore: boolean; nextCursor: string | null; limit: number } }> {
  return apiFetch("/api/v1/refunds", {
    ...options,
    params: { ...params, ...options?.params },
  });
}

export async function fetchRefundDetail(id: string, options?: RequestOptions): Promise<RefundItem> {
  const res = await apiFetch<{ data: RefundItem }>(`/api/v1/refunds/${id}`, options);
  return res.data;
}

export async function createRefund(
  payload: CreateRefundPayload,
  options?: RequestOptions
): Promise<RefundItem> {
  const res = await apiFetch<{ data: RefundItem }>("/api/v1/refunds", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}
