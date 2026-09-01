import { apiFetch, RequestOptions } from "./client";

export type ApiLogItem = {
  id: string;
  timestamp: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  status: number;
  latencyMs: number;
  method: string;
  endpoint: string;
  environment: "SANDBOX" | "LIVE";
  headers: Record<string, string>;
  metadata: Record<string, unknown> | null;
};

export async function fetchApiLogs(
  params?: {
    action?: string;
    targetType?: string;
    limit?: number;
  },
  options?: RequestOptions
): Promise<ApiLogItem[]> {
  const res = await apiFetch<{ data: ApiLogItem[] }>("/api/v1/api-logs", {
    ...options,
    params: { ...params, ...options?.params },
  });
  return res.data;
}
