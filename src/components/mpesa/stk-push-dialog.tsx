"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Smartphone, XCircle } from "lucide-react";
import { formatKES, formatPhone } from "@/lib/format";
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
import {
  failTransactionAction,
  initiateStkPushAction,
  simulateCallbackAction,
} from "@/app/actions/mpesa";

type Phase = "form" | "push" | "success";

export function StkPushDialog() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  function resetAll() {
    setPhase("form");
    setPhone("");
    setAmount("");
    setReference("");
    setTransactionId(null);
    setReceipt(null);
  }

  function closeDialog() {
    setOpen(false);
    setTimeout(resetAll, 300);
  }

  async function submit() {
    const parsedAmount = parseFloat(amount);
    if (!phone.trim()) return toast.error("Enter the customer's M-Pesa number.");
    if (!parsedAmount || parsedAmount <= 0) return toast.error("Enter an amount.");

    setBusy(true);
    try {
      const result = await initiateStkPushAction({
        phone: phone.trim(),
        amount: parsedAmount,
        reference: reference.trim() || undefined,
        description: reference.trim() || "STK push request",
      });
      if (result?.error || !result?.data) {
        toast.error(result?.error ?? "Could not send the STK push.");
        return;
      }
      setTransactionId(result.data.transactionId);
      setPhase("push");
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
    } finally {
      setBusy(false);
    }
  }

  async function failPayment() {
    if (!transactionId) return;
    setBusy(true);
    try {
      const result = await failTransactionAction({ transactionId, status: "CANCELLED" });
      if (result?.error) toast.error(result.error);
      else toast.success("Request cancelled.");
      resetAll();
    } finally {
      setBusy(false);
    }
  }

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
              <DialogTitle>Request M-Pesa payment</DialogTitle>
              <DialogDescription>
                Send an STK push to a customer&apos;s phone. They enter their PIN and
                the money lands in your account instantly.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Customer phone</Label>
                <Input
                  className="mt-1.5"
                  inputMode="tel"
                  placeholder="0712 345 678"
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

        {phase === "push" && (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/15">
              <Smartphone className="h-8 w-8 text-brand-400" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">STK push sent</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatKES(parseFloat(amount))} requested from{" "}
              <span className="font-semibold text-foreground">{formatPhone(phone)}</span>.
              Ask the customer to enter their M-Pesa PIN.
            </p>
            <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
              <Button onClick={simulate} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Simulate payment
              </Button>
              <Button variant="outline" onClick={failPayment} disabled={busy}>
                <XCircle className="h-4 w-4" /> Cancel request
              </Button>
            </div>
          </div>
        )}

        {phase === "success" && (
          <div className="flex flex-col items-center py-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Payment received!</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatKES(parseFloat(amount))} from {formatPhone(phone)}
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
      </DialogContent>
    </Dialog>
  );
}
