import { apiFetch, RequestOptions } from "./client";

export type AccountItem = {
  id: string;
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  currency: string;
  active: boolean;
  description: string | null;
  balanceMinor?: string;
  debitMinor?: string;
  creditMinor?: string;
  entryCount?: number;
  createdAt: string;
};

export type AccountDetail = AccountItem & {
  parentId: string | null;
  parentName: string | null;
  balance: {
    debitMinor: string;
    creditMinor: string;
    balanceMinor: string;
  } | null;
  entries: Array<{
    id: string;
    journalId: string;
    type: "DEBIT" | "CREDIT";
    amountMinor: string;
    description: string;
    reference: string | null;
    postedAt: string;
    voided: boolean;
  }>;
};

export type CreateAccountPayload = {
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  parentId?: string;
  currency?: string;
  description?: string;
};

export async function fetchAccounts(
  includeBalances = true,
  options?: RequestOptions
): Promise<AccountItem[]> {
  const res = await apiFetch<{ data: AccountItem[] }>("/api/v1/accounts", {
    ...options,
    params: { balances: includeBalances, ...options?.params },
  });
  return res.data;
}

export async function fetchAccountDetail(id: string, options?: RequestOptions): Promise<AccountDetail> {
  const res = await apiFetch<{ data: AccountDetail }>(`/api/v1/accounts/${id}`, options);
  return res.data;
}

export async function createAccount(
  payload: CreateAccountPayload,
  options?: RequestOptions
): Promise<AccountItem> {
  const res = await apiFetch<{ data: AccountItem }>("/api/v1/accounts", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}
