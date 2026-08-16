"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Settings2,
  Smartphone,
  XCircle,
} from "lucide-react";
import { formatKES, formatPhone } from "@/lib/format";
import type { SafeMpesaConfig } from "@/lib/mpesa/config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  failTransactionAction,
  getTransactionStatusAction,
  initiateStkPushAction,
  reconcileTransactionAction,
  simulateCallbackAction,
} from "@/app/actions/mpesa";
import { resolveConfigState } from "@/components/mpesa/mpesa-state";

/**
 * STK Push interface.
 *
 * Phases map to the states the task calls for:
 *   form       — collect phone/amount/reference (blocked when unusable)
 *   processing — request accepted, waiting on the customer / callback
 *   success | failed | cancelled | timeout — terminal states
 *
 * In live mode the dialog polls `getTransactionStatusAction` because only the
 * Safaricom callback can settle the transaction. In demo mode it exposes the
 * simulate/cancel buttons instead.
 */

type Phase = "form" | "processing" | "success" | "failed" | "timeout" | "cancelled";

/** Stop polling after this long and show the timeout state. */
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

export function StkPushDialog({ config }: { config: SafeMpesaConfig }) {
  const router = useRouter();
  const state = resolveConfigState(config);
  const isDemo = state === "demo" || state === "not_configured" || state === "disabled";

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [liveTxn, setLiveTxn] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const resetAll = useCallback(() => {
    stopPolling();
    setPhase("form");
    setPhone("");
    setAmount("");
    setReference("");
    setTransactionId(null);
    setLiveTxn(false);
    setStatusMessage(null);
    setReceipt(null);
    setErrorMessage(null);
  }, [stopPolling]);

  function closeDialog() {
    setOpen(false);
    stopPolling();
    router.refresh();
    setTimeout(resetAll, 300);
  }

  /** Apply a status snapshot from the server to the dialog's phase. */
  const applyStatus = useCallback(
    (status: string, data?: { receiptNo: string | null; resultDesc: string | null }) => {
      switch (status) {
        case "SUCCESS":
          stopPolling();
          setReceipt(data?.receiptNo ?? null);
          setPhase("success");
          router.refresh();
          return true;
        case "FAILED":
          stopPolling();
          setErrorMessage(data?.resultDesc ?? "The payment failed.");
          setPhase("failed");
          router.refresh();
          return true;
        case "CANCELLED":
          stopPolling();
          setErrorMessage(data?.resultDesc ?? "The customer cancelled the request.");
          setPhase("cancelled");
          router.refresh();
          return true;
        case "TIMEOUT":
          stopPolling();
          setErrorMessage(data?.resultDesc ?? "The customer did not respond in time.");
          setPhase("timeout");
          router.refresh();
          return true;
        default:
          return false;
      }
    },
    [router, stopPolling],
  );

  const startPolling = useCallback(
    (txnId: string) => {
      stopPolling();
      deadlineRef.current = Date.now() + POLL_TIMEOUT_MS;

      pollRef.current = setInterval(async () => {
        const result = await getTransactionStatusAction({ transactionId: txnId });
        if (result.data) {
          const settled = applyStatus(result.data.status, {
            receiptNo: result.data.receiptNo,
            resultDesc: result.data.resultDesc,
          });
          if (settled) return;
        }

        if (Date.now() > deadlineRef.current) {
          stopPolling();
          setPhase("timeout");
          setErrorMessage(
            "No confirmation from Safaricom yet. The customer may not have entered their PIN, or the callback could not reach this server.",
          );
        }
      }, POLL_INTERVAL_MS);
    },
    [applyStatus, stopPolling],
  );

  async function submit() {
    const parsedAmount = parseFloat(amount);
    if (!phone.trim()) return toast.error("Enter the customer's M-Pesa number.");
    if (!parsedAmount || parsedAmount <= 0) return toast.error("Enter an amount.");

    setBusy(true);
    setErrorMessage(null);
    try {
      const result = await initiateStkPushAction({
        phone: phone.trim(),
        amount: parsedAmount,
        reference: reference.trim() || undefined,
        description: reference.trim() || "STK push request",
      });

      if (result?.error || !result?.data) {
        setErrorMessage(result?.error ?? "Could not send the STK push.");
        setPhase("failed");
        toast.error(result?.error ?? "Could not send the STK push.");
        return;
      }

      setTransactionId(result.data.transactionId);
      setLiveTxn(result.data.mode === "daraja");
      setStatusMessage(result.data.message);
      setPhase("processing");
      router.refresh();

      if (result.data.mode === "daraja") startPolling(result.data.transactionId);
    } finally {
      setBusy(false);
    }
  }

  async function simulate() {
    if (!transactionId) return;
    setBusy(true);
    try {
      const result = await simulateCallbackAction({ transactionId });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setReceipt(result.success ?? "Payment received.");
      setPhase("success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (!transactionId) return;
    setBusy(true);
    try {
      const result = liveTxn
        ? await reconcileTransactionAction({ transactionId })
        : await getTransactionStatusAction({ transactionId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.data) {
        const settled = applyStatus(result.data.status, {
          receiptNo: result.data.receiptNo,
          resultDesc: result.data.resultDesc,
        });
        if (!settled) toast.info("Still waiting for the customer to pay.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest() {
    if (!transactionId) return;
    setBusy(true);
    try {
      const result = await failTransactionAction({ transactionId, status: "CANCELLED" });
      if (result?.error) toast.error(result.error);
      else toast.success("Request cancelled.");
      stopPolling();
      router.refresh();
      resetAll();
    } finally {
      setBusy(false);
    }
  }

  const amountValue = parseFloat(amount);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeDialog())}>
      <DialogTrigger asChild>
        <Button>
          <Smartphone className="h-4 w-4" /> Request payment
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        {phase === "form" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Request M-Pesa payment
                {state === "ready" && (
                  <Badge variant={config.environment === "production" ? "success" : "secondary"}>
                    {config.environment === "production" ? "Live" : "Sandbox"}
                  </Badge>
                )}
                {isDemo && <Badge variant="warning">Simulated</Badge>}
              </DialogTitle>
              <DialogDescription>
                {state === "ready"
                  ? "Send a real STK push. The customer enters their M-Pesa PIN and Safaricom confirms the payment."
                  : state === "not_configured"
                    ? "M-Pesa isn't configured yet, so this runs as a simulation."
                    : state === "disabled"
                      ? "M-Pesa is switched off, so this runs as a simulation."
                      : "Demo mode — no requests are sent to Safaricom."}
              </DialogDescription>
            </DialogHeader>

            {(state === "not_configured" || state === "disabled") && (
              <Link
                href="/settings/mpesa"
                className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {state === "not_configured"
                  ? "Configure Daraja to accept real payments"
                  : "Enable M-Pesa payments in settings"}
              </Link>
            )}

            <div className="space-y-4">
              <div>
                <Label>Customer phone</Label>
                <Input
                  className="mt-1.5"
                  inputMode="tel"
                  placeholder={config.environment === "sandbox" ? "254708374149" : "0712 345 678"}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <Label>Amount (KSh)</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  min={1}
                  max={150000}
                  placeholder="500"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Reference (optional)</Label>
                <Input
                  className="mt-1.5"
                  placeholder="e.g. Invoice INV-001"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
              <Button className="w-full" onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                Send STK push
              </Button>
            </div>
          </>
        )}

        {phase === "processing" && (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/15">
              <Smartphone className="h-8 w-8 text-brand-400" />
              {liveTxn && (
                <span className="absolute inset-0 animate-ping rounded-full border-2 border-brand-500/40" />
              )}
            </div>
            <h3 className="mt-4 text-lg font-semibold">
              {liveTxn ? "Waiting for the customer…" : "STK push sent"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {Number.isFinite(amountValue) ? formatKES(amountValue) : ""} requested from{" "}
              <span className="font-semibold text-foreground">{formatPhone(phone)}</span>.
            </p>
            {statusMessage && (
              <p className="mt-2 text-xs text-muted-foreground">{statusMessage}</p>
            )}

            {liveTxn ? (
              <>
                <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking for Safaricom&apos;s confirmation…
                </p>
                <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
                  <Button variant="outline" onClick={refreshStatus} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Check now
                  </Button>
                  <Button variant="ghost" onClick={closeDialog}>
                    Continue in background
                  </Button>
                </div>
              </>
            ) : (
              <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
                <Button onClick={simulate} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Simulate payment
                </Button>
                <Button variant="outline" onClick={cancelRequest} disabled={busy}>
                  <XCircle className="h-4 w-4" /> Cancel request
                </Button>
              </div>
            )}
          </div>
        )}

        {phase === "success" && (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Payment received!</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {Number.isFinite(amountValue) ? formatKES(amountValue) : ""} from {formatPhone(phone)}
            </p>
            {receipt && (
              <p className="mt-2 rounded-md bg-success/10 px-3 py-1 font-mono text-xs text-success">
                {receipt}
              </p>
            )}
            <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
              <Button onClick={resetAll}>Send another</Button>
              <Button variant="outline" onClick={closeDialog}>
                Done
              </Button>
            </div>
          </div>
        )}

        {(phase === "failed" || phase === "cancelled" || phase === "timeout") && (
          <div className="flex flex-col items-center py-4 text-center">
            <div
              className={
                phase === "timeout"
                  ? "flex h-16 w-16 items-center justify-center rounded-full bg-warning/15"
                  : "flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15"
              }
            >
              {phase === "timeout" ? (
                <Clock className="h-8 w-8 text-warning" />
              ) : phase === "cancelled" ? (
                <XCircle className="h-8 w-8 text-destructive" />
              ) : (
                <AlertCircle className="h-8 w-8 text-destructive" />
              )}
            </div>
            <h3 className="mt-4 text-lg font-semibold">
              {phase === "timeout"
                ? "No response yet"
                : phase === "cancelled"
                  ? "Request cancelled"
                  : "Payment failed"}
            </h3>
            {errorMessage && (
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">{errorMessage}</p>
            )}
            <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
              {phase === "timeout" && transactionId && (
                <Button variant="outline" onClick={refreshStatus} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Check again
                </Button>
              )}
              <Button onClick={resetAll}>Try again</Button>
              <Button variant="ghost" onClick={closeDialog}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
