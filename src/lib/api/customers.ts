import { apiFetch, RequestOptions } from "./client";

export type CustomerItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  location: string | null;
  notes: string | null;
  paymentCount: number;
  totalVolumeMinor: string;
  lastActivity: string;
  createdAt: string;
};

export type CustomerDetail = CustomerItem & {
  loyaltyPoints?: number;
  payments: Array<{
    id: string;
    reference: string | null;
    amountMinor: string;
    currency: string;
    status: string;
    createdAt: string;
  }>;
};

export type CreateCustomerPayload = {
  name: string;
  phone?: string;
  email?: string;
  location?: string;
  notes?: string;
};

export async function fetchCustomers(
  search?: string,
  options?: RequestOptions
): Promise<CustomerItem[]> {
  const res = await apiFetch<{ data: CustomerItem[] }>("/api/v1/customers", {
    ...options,
    params: { search, ...options?.params },
  });
  return res.data;
}

export async function fetchCustomerDetail(id: string, options?: RequestOptions): Promise<CustomerDetail> {
  const res = await apiFetch<{ data: CustomerDetail }>(`/api/v1/customers/${id}`, options);
  return res.data;
}

export async function createCustomer(
  payload: CreateCustomerPayload,
  options?: RequestOptions
): Promise<CustomerItem> {
  const res = await apiFetch<{ data: CustomerItem }>("/api/v1/customers", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}
