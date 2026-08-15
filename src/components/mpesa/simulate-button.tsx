"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Zap } from "lucide-react";
import { simulateCallbackAction } from "@/app/actions/mpesa";

export function SimulateButton({ transactionId }: { transactionId: string }) {
  const [busy, setBusy] = useState(false);

  async function simulate() {
    setBusy(true);
    try {
      const result = await simulateCallbackAction({ transactionId });
      if (result?.error) toast.error(result.error);
      else toast.success(result.success ?? "Payment received.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={simulate}
      disabled={busy}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 text-warning" />}
      Simulate
    </button>
  );
}
