import { apiFetch, RequestOptions } from "./client";

export type TenantContextData = {
  tenant: { id: string; name: string; slug: string };
  application: { id: string; name: string; slug: string };
  applications?: Array<{ id: string; name: string; slug: string; description: string | null; createdAt: string }>;
  environment: "SANDBOX" | "LIVE";
  tenantRole: "OWNER" | "ADMIN" | "DEVELOPER" | "FINANCE" | "VIEWER";
  permissions: string[];
};

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  applicationCount: number;
  memberCount: number;
  createdAt: string;
};

export type MemberItem = {
  id: string;
  userId: string;
  email: string;
  role: "OWNER" | "ADMIN" | "DEVELOPER" | "FINANCE" | "VIEWER";
  permissions: string[];
  createdAt: string;
};

export async function fetchTenantContext(options?: RequestOptions): Promise<TenantContextData> {
  const res = await apiFetch<{ data: TenantContextData }>("/api/v1/tenant", options);
  return res.data;
}

export async function fetchTenants(options?: RequestOptions): Promise<TenantSummary[]> {
  const res = await apiFetch<{ data: TenantSummary[] }>("/api/v1/tenant/tenants", options);
  return res.data;
}

export async function switchContext(
  payload: { tenantSlug?: string; environment?: "SANDBOX" | "LIVE" },
  options?: RequestOptions
): Promise<{ ok: boolean; activeTenantSlug: string; activeEnvironment: "SANDBOX" | "LIVE" }> {
  return apiFetch("/api/v1/tenant/switch", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchTenantMembers(
  options?: RequestOptions
): Promise<{ data: MemberItem[]; meta: { availableRoles: string[]; allPermissions: string[] } }> {
  return apiFetch("/api/v1/tenant/members", options);
}

export async function inviteTenantMember(
  payload: { email: string; role: "OWNER" | "ADMIN" | "DEVELOPER" | "FINANCE" | "VIEWER" },
  options?: RequestOptions
): Promise<MemberItem> {
  const res = await apiFetch<{ data: MemberItem }>("/api/v1/tenant/members", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}
