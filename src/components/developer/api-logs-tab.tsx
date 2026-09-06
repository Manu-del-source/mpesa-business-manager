"use client";

import React, { useEffect, useState, useCallback } from "react";
import { fetchApiLogs, type ApiLogItem } from "@/lib/api/api-logs";
import { ApiClientError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { OmniEmptyState, OmniErrorBanner } from "@/components/shared/omni-empty-state";

export function ApiLogsTab() {
  const [items, setItems] = useState<ApiLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setItems(await fetchApiLogs({ limit: 50 }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load API logs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-sm text-on-surface-variant">
        Request activity for this application. Authorization headers are always redacted before reaching the browser.
      </p>

      {error && <OmniErrorBanner message={error} onRetry={() => void load()} />}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container text-on-surface-variant text-label-caps font-label-caps uppercase">
              <tr>
                <th className="p-3 px-4">Time</th>
                <th className="p-3 px-4">Method</th>
                <th className="p-3 px-4">Endpoint</th>
                <th className="p-3 px-4">Action</th>
                <th className="p-3 px-4">Status</th>
                <th className="p-3 px-4">Env</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-body-sm">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td className="p-4" colSpan={6}><Skeleton className="h-5 w-full" /></td></tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={6}><OmniEmptyState icon="terminal" title="No API activity yet" /></td></tr>
              ) : (
                items.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr
                      className="cursor-pointer hover:bg-surface-container/60 transition-colors"
                      onClick={() => setExpanded((e) => (e === log.id ? null : log.id))}
                    >
                      <td className="p-3 px-4 text-on-surface-variant">{formatDateTime(log.timestamp)}</td>
                      <td className="p-3 px-4">
                        <Badge variant="outline" className="font-code-sm">{log.method}</Badge>
                      </td>
                      <td className="p-3 px-4 font-code-sm text-code-sm">{log.endpoint}</td>
                      <td className="p-3 px-4">{log.action}</td>
                      <td className="p-3 px-4">
                        <span className={`font-code-sm text-code-sm font-medium ${log.status < 300 ? "text-emerald-700" : log.status < 500 ? "text-amber-700" : "text-red-700"}`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="p-3 px-4">
                        <Badge variant={log.environment === "LIVE" ? "destructive" : "warning"}>{log.environment}</Badge>
                      </td>
                    </tr>
                    {expanded === log.id && (
                      <tr>
                        <td colSpan={6} className="p-4 bg-surface-container/40">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-body-sm">
                            <div>
                              <div className="text-label-caps font-label-caps uppercase text-on-surface-variant mb-1">Headers</div>
                              <pre className="font-code-sm text-code-sm bg-surface-container-lowest border border-outline-variant rounded p-2 overflow-x-auto">
                                {JSON.stringify(log.headers, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <div className="text-label-caps font-label-caps uppercase text-on-surface-variant mb-1">Metadata</div>
                              <pre className="font-code-sm text-code-sm bg-surface-container-lowest border border-outline-variant rounded p-2 overflow-x-auto">
                                {log.metadata ? JSON.stringify(log.metadata, null, 2) : "—"}
                              </pre>
                            </div>
                          </div>
                          <div className="text-body-sm text-on-surface-variant mt-2">
                            {log.latencyMs}ms · target {log.targetType} {log.targetId}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
