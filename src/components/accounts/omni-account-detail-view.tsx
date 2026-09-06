"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchAccountDetail, type AccountDetail } from "@/lib/api/accounts";
import { ApiClientError } from "@/lib/api/client";
import { formatMinorUnits, formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { OmniErrorBanner } from "@/components/shared/omni-empty-state";

export function OmniAccountDetailView({ accountId }: { accountId: string }) {
  const [data, setData] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const detail = await fetchAccountDetail(accountId);
      setData(detail);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load account.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return <OmniErrorBanner message={error} onRetry={() => void load()} />;
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/accounts" className="text-body-sm text-secondary hover:underline flex items-center gap-1 mb-2">
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          All accounts
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-headline-md font-headline-md text-primary font-bold">{data.name}</h1>
          <Badge variant="outline" className="uppercase">{data.type}</Badge>
          {!data.active && <Badge variant="muted">Inactive</Badge>}
        </div>
        <p className="text-body-sm text-on-surface-variant font-code-sm mt-1">
          {data.code} {data.parentName && `· under ${data.parentName}`}
        </p>
      </div>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
          <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
            Balance
          </span>
          <div className="text-headline-md font-headline-md text-primary font-bold mt-2">
            {formatMinorUnits(data.balance?.balanceMinor ?? "0", data.currency)}
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
          <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
            Total Debits
          </span>
          <div className="text-headline-md font-headline-md text-primary font-bold mt-2">
            {formatMinorUnits(data.balance?.debitMinor ?? "0", data.currency)}
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
          <span className="text-label-caps font-label-caps uppercase text-on-surface-variant tracking-wider">
            Total Credits
          </span>
          <div className="text-headline-md font-headline-md text-primary font-bold mt-2">
            {formatMinorUnits(data.balance?.creditMinor ?? "0", data.currency)}
          </div>
        </div>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="p-5 border-b border-outline-variant">
          <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Ledger Entries</h3>
          <p className="text-body-sm text-on-surface-variant">
            Immutable journal lines posted to this account. Reversals are made via new entries, never edits.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
              <tr>
                <th className="p-3 px-4">Description</th>
                <th className="p-3 px-4">Reference</th>
                <th className="p-3 px-4">Type</th>
                <th className="p-3 px-4 text-right">Amount</th>
                <th className="p-3 px-4">Posted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm">
              {data.entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-on-surface-variant">
                    No ledger entries posted to this account yet.
                  </td>
                </tr>
              ) : (
                data.entries.map((e) => (
                  <tr key={e.id} className={e.voided ? "opacity-50" : ""}>
                    <td className="p-3 px-4">
                      {e.description}
                      {e.voided && <Badge variant="muted" className="ml-2">Voided</Badge>}
                    </td>
                    <td className="p-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                      {e.reference || "—"}
                    </td>
                    <td className="p-3 px-4">
                      <span className={`text-label-caps font-label-caps uppercase ${e.type === "DEBIT" ? "text-secondary" : "text-primary"}`}>
                        {e.type}
                      </span>
                    </td>
                    <td className="p-3 px-4 text-right font-code-md text-code-md">
                      {formatMinorUnits(e.amountMinor)}
                    </td>
                    <td className="p-3 px-4 text-on-surface-variant">{formatDateTime(e.postedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
