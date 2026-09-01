import { apiFetch, RequestOptions } from "./client";

export type PaymentListItem = {
  id: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "REFUNDED";
  direction: "INCOMING" | "OUTGOING";
  amountMinor: string;
  currency: string;
  phone: string | null;
  email: string | null;
  customerName: string | null;
  description: string | null;
  reference: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type PaymentDetail = PaymentListItem & {
  feeMinor: string;
  netMinor: string;
  provider: {
    name: string;
    checkoutRequestId: string | null;
    receiptNumber: string | null;
    resultCode: number | null;
    status: string;
    customerMsisdn: string | null;
  };
  ledgerImpact: Array<{
    id: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    type: "DEBIT" | "CREDIT";
    amountMinor: string;
    currency: string;
    description: string;
    postedAt: string;
    voided: boolean;
  }>;
  allocations: Array<{
    id: string;
    accountCode: string;
    accountName: string;
    amountMinor: string;
    percentage: number | null;
    roundingApplied: string | null;
  }>;
  refunds: Array<{
    id: string;
    amountMinor: string;
    status: string;
    reason: string | null;
    createdAt: string;
  }>;
  timeline: Array<{
    title: string;
    timestamp: string;
    status: string;
    details?: string;
  }>;
  webhooks: Array<{
    id: string;
    endpointUrl: string;
    eventType: string;
    status: string;
    statusCode: number | null;
    deliveredAt: string | null;
  }>;
  metadata: Record<string, unknown>;
};

export type CreatePaymentPayload = {
  amountMinor: number;
  currency?: string;
  direction?: "INCOMING" | "OUTGOING";
  phone?: string;
  email?: string;
  customerName?: string;
  description?: string;
  idempotencyKey?: string;
  reference?: string;
};

export async function fetchPayments(
  params?: {
    status?: string;
    limit?: number;
    cursor?: string;
    since?: string;
    until?: string;
  },
  options?: RequestOptions
): Promise<{ data: PaymentListItem[]; pagination: { hasMore: boolean; nextCursor: string | null; limit: number } }> {
  return apiFetch("/api/v1/payments", {
    ...options,
    params: { ...params, ...options?.params },
  });
}

export async function fetchPaymentDetail(id: string, options?: RequestOptions): Promise<PaymentDetail> {
  const res = await apiFetch<{ data: PaymentDetail }>(`/api/v1/payments/${id}`, options);
  return res.data;
}

export async function createPayment(payload: CreatePaymentPayload, options?: RequestOptions): Promise<PaymentListItem> {
  const res = await apiFetch<{ data: PaymentListItem }>("/api/v1/payments", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function cancelPayment(id: string, options?: RequestOptions): Promise<PaymentListItem> {
  const res = await apiFetch<{ data: PaymentListItem }>(`/api/v1/payments/${id}/cancel`, {
    ...options,
    method: "POST",
  });
  return res.data;
}
