"use client";

import React from "react";

const ENDPOINT_GROUPS: Array<{ group: string; paths: string[] }> = [
  { group: "Payments", paths: ["GET /v1/payments", "POST /v1/payments", "GET /v1/payments/:id", "POST /v1/payments/:id/cancel"] },
  { group: "Payouts", paths: ["GET /v1/payouts", "POST /v1/payouts", "POST /v1/payouts/:id/cancel"] },
  { group: "Refunds", paths: ["GET /v1/refunds", "POST /v1/refunds", "GET /v1/refunds/:id"] },
  { group: "Ledger", paths: ["GET /v1/journal", "POST /v1/journal", "POST /v1/journal/:id/void"] },
  { group: "Accounts", paths: ["GET /v1/accounts", "POST /v1/accounts", "GET /v1/accounts/:id"] },
  { group: "Allocations", paths: ["GET /v1/allocations/rules", "POST /v1/allocations/rules", "GET /v1/allocations/applied"] },
  { group: "Reconciliation", paths: ["GET /v1/reconciliation/runs", "POST /v1/reconciliation/runs", "POST /v1/reconciliation/exceptions/:id/resolve"] },
  { group: "Customers", paths: ["GET /v1/customers", "POST /v1/customers", "GET /v1/customers/:id"] },
  { group: "Keys & Webhooks", paths: ["GET /v1/keys", "POST /v1/keys", "GET /v1/webhooks/endpoints", "POST /v1/webhooks/endpoints"] },
];

export function DocumentationTab() {
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
        <h3 className="text-headline-sm font-headline-sm text-primary font-bold mb-2">Authentication</h3>
        <p className="text-body-sm text-on-surface-variant mb-3">
          Every request to <code className="font-code-sm bg-surface-container px-1 rounded">/v1</code> is authenticated with a
          secret API key in the <code className="font-code-sm bg-surface-container px-1 rounded">Authorization</code> header.
          Browser sessions use a signed cookie instead — never a raw key.
        </p>
        <pre className="font-code-sm text-code-sm bg-surface-container border border-outline-variant rounded p-3 overflow-x-auto">
{`curl https://your-domain.com/v1/payments \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "X-Environment: LIVE"`}
        </pre>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
        <h3 className="text-headline-sm font-headline-sm text-primary font-bold mb-2">Environments</h3>
        <p className="text-body-sm text-on-surface-variant">
          Every request runs in <span className="font-medium text-amber-800">SANDBOX</span> or{" "}
          <span className="font-medium text-red-700">LIVE</span>, set via the{" "}
          <code className="font-code-sm bg-surface-container px-1 rounded">X-Environment</code> header (or the active
          environment selector in this console for browser sessions). SANDBOX data and LIVE data are fully isolated —
          nothing you do in SANDBOX ever touches real money or real ledgers.
        </p>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
        <h3 className="text-headline-sm font-headline-sm text-primary font-bold mb-2">Idempotency</h3>
        <p className="text-body-sm text-on-surface-variant">
          Mutating requests that move money (payments, payouts, refunds) accept an{" "}
          <code className="font-code-sm bg-surface-container px-1 rounded">idempotencyKey</code> in the request body.
          Reusing the same key returns the original result instead of creating a duplicate — always set one for any
          client that might retry a request.
        </p>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
        <div className="p-5 border-b border-outline-variant">
          <h3 className="text-headline-sm font-headline-sm text-primary font-bold">Endpoint Reference</h3>
        </div>
        <div className="divide-y divide-outline-variant">
          {ENDPOINT_GROUPS.map((g) => (
            <div key={g.group} className="p-4 px-5">
              <div className="text-body-sm font-semibold text-primary mb-2">{g.group}</div>
              <div className="flex flex-wrap gap-2">
                {g.paths.map((p) => (
                  <span key={p} className="font-code-sm text-code-sm bg-surface-container px-2 py-1 rounded">{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
