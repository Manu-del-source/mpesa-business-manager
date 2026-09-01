import { apiFetch, RequestOptions } from "./client";

export type JournalTransactionItem = {
  id: string;
  description: string;
  reference: string | null;
  postedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  entries: Array<{
    id: string;
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    type: "DEBIT" | "CREDIT";
    amountMinor: string;
    currency: string;
    description: string | null;
  }>;
};

export type FlatLedgerEntry = {
  id: string;
  journalId: string;
  timestamp: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  accountId: string;
  debitMinor: string;
  creditMinor: string;
  type: "DEBIT" | "CREDIT";
  amountMinor: string;
  currency: string;
  reference: string;
  description: string;
  voided: boolean;
};

export type PostJournalPayload = {
  description: string;
  reference?: string;
  entries: Array<{
    accountId: string;
    type: "DEBIT" | "CREDIT";
    amountMinor: number;
    currency?: string;
    description?: string;
  }>;
};

export async function fetchJournal(
  params?: {
    accountId?: string;
    search?: string;
    limit?: number;
    cursor?: string;
  },
  options?: RequestOptions
): Promise<{
  data: JournalTransactionItem[];
  flatEntries: FlatLedgerEntry[];
  pagination: { hasMore: boolean; nextCursor: string | null; limit: number };
}> {
  return apiFetch("/api/v1/journal", {
    ...options,
    params: { ...params, ...options?.params },
  });
}

export async function fetchJournalDetail(id: string, options?: RequestOptions): Promise<JournalTransactionItem> {
  const res = await apiFetch<{ data: JournalTransactionItem }>(`/api/v1/journal/${id}`, options);
  return res.data;
}

export async function postJournalEntry(
  payload: PostJournalPayload,
  options?: RequestOptions
): Promise<JournalTransactionItem> {
  const res = await apiFetch<{ data: JournalTransactionItem }>("/api/v1/journal", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export type JournalReversal = {
  id: string;
  reversalId: string;
  reversedBy: string;
  reason: string;
  reversal: {
    id: string;
    description: string;
    reference: string | null;
    postedAt: string;
  } | null;
};

/**
 * "Void" a journal entry. The server posts a compensating reversal journal —
 * the original entries are preserved for audit.
 */
export async function voidJournalEntry(
  id: string,
  reason: string,
  options?: RequestOptions
): Promise<JournalReversal> {
  const res = await apiFetch<{ data: JournalReversal }>(
    `/api/v1/journal/${id}/void`,
    {
      ...options,
      method: "POST",
      body: JSON.stringify({ reason }),
    }
  );
  return res.data;
}
