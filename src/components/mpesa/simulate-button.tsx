"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import {
  reconcileTransactionAction,
  simulateCallbackAction,
} from "@/app/actions/mpesa";

/**
 * Row action for a PENDING transaction.
 *
 * - Simulated transaction (no Daraja checkoutRequestId): "Simulate" completes
 *   it locally, standing in for the callback.
 * - Live transaction: simulating is not allowed, so we offer "Check" instead,
 *   which asks Safaricom via STK Push Query and applies the real result.
 */
export function SimulateButton({
  transactionId,
  isLive = false,
}: {
  transactionId: string;
  isLive?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const result = isLive
        ? await reconcileTransactionAction({ transactionId })
        : await simulateCallbackAction({ transactionId });

      if (result?.error) toast.error(result.error);
      else toast.success(result.success ?? "Updated.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title={
        isLive
          ? "Ask Safaricom for the latest status of this payment"
          : "Complete this simulated payment"
      }
      className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : isLive ? (
        <RefreshCw className="h-3 w-3 text-brand-400" />
      ) : (
        <Zap className="h-3 w-3 text-warning" />
      )}
      {isLive ? "Check" : "Simulate"}
    </button>
  );
}
