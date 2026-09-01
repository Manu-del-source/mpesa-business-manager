import { apiFetch, RequestOptions } from "./client";

export type WebhookEndpointItem = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  createdAt: string;
  lastTriggeredAt: string | null;
};

export type CreatedWebhookEndpoint = WebhookEndpointItem & {
  secret: string;
};

export type WebhookDeliveryItem = {
  id: string;
  endpointId: string;
  endpointUrl: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "SENT" | "FAILED";
  httpStatusCode: number | null;
  responseBody: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

export type CreateWebhookPayload = {
  url: string;
  events?: string[];
  description?: string;
};

export async function fetchWebhookEndpoints(options?: RequestOptions): Promise<WebhookEndpointItem[]> {
  const res = await apiFetch<{ data: WebhookEndpointItem[] }>("/api/v1/webhooks/endpoints", options);
  return res.data;
}

export async function createWebhookEndpoint(
  payload: CreateWebhookPayload,
  options?: RequestOptions
): Promise<CreatedWebhookEndpoint> {
  const res = await apiFetch<{ data: WebhookEndpointItem; secret: string }>("/api/v1/webhooks/endpoints", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    ...res.data,
    secret: res.secret,
  };
}

export async function deactivateWebhookEndpoint(
  id: string,
  options?: RequestOptions
): Promise<{ id: string; active: boolean }> {
  const res = await apiFetch<{ data: { id: string; active: boolean } }>(`/api/v1/webhooks/endpoints/${id}`, {
    ...options,
    method: "DELETE",
  });
  return res.data;
}

export async function fetchWebhookDeliveries(
  endpointId?: string,
  options?: RequestOptions
): Promise<WebhookDeliveryItem[]> {
  const res = await apiFetch<{ data: WebhookDeliveryItem[] }>("/api/v1/webhooks/deliveries", {
    ...options,
    params: { endpointId, ...options?.params },
  });
  return res.data;
}
