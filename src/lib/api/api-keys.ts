import { apiFetch, RequestOptions } from "./client";

export type ApiKeyItem = {
  id: string;
  name: string;
  keyType: "PUBLIC" | "SECRET" | "WEBHOOK_SECRET";
  prefix: string;
  keyPreview: string;
  scopes: string[];
  environment: "SANDBOX" | "LIVE";
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type CreatedApiKey = ApiKeyItem & {
  secretKey: string;
};

export type CreateApiKeyPayload = {
  name: string;
  keyType: "PUBLIC" | "SECRET" | "WEBHOOK_SECRET";
  environment?: "SANDBOX" | "LIVE";
  scopes?: string[];
  expiresAt?: string;
};

export async function fetchApiKeys(options?: RequestOptions): Promise<ApiKeyItem[]> {
  const res = await apiFetch<{ data: ApiKeyItem[] }>("/api/v1/keys", options);
  return res.data;
}

export async function createApiKey(
  payload: CreateApiKeyPayload,
  options?: RequestOptions
): Promise<CreatedApiKey> {
  const res = await apiFetch<{ data: CreatedApiKey }>("/api/v1/keys", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function revokeApiKey(id: string, options?: RequestOptions): Promise<{ id: string; revoked: boolean }> {
  const res = await apiFetch<{ data: { id: string; revoked: boolean } }>(`/api/v1/keys/${id}/revoke`, {
    ...options,
    method: "POST",
  });
  return res.data;
}
