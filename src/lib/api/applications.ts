import { apiFetch, RequestOptions } from "./client";

export type ApplicationItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  paymentCount: number;
  apiKeyCount: number;
  accountCount: number;
  webhookCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateApplicationPayload = {
  name: string;
  slug: string;
  description?: string;
};

export async function fetchApplications(options?: RequestOptions): Promise<ApplicationItem[]> {
  const res = await apiFetch<{ data: ApplicationItem[] }>("/api/v1/tenant/applications", options);
  return res.data;
}

export async function createApplication(
  payload: CreateApplicationPayload,
  options?: RequestOptions
): Promise<ApplicationItem> {
  const res = await apiFetch<{ data: ApplicationItem }>("/api/v1/tenant/applications", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}
