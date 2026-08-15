"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  ReceiptText,
  Smartphone,
  Trash2,
  XCircle,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { cancelSaleAction, completeMpesaSaleAction, createSaleAction } from "@/app/actions/sales";

type PosProduct = {
  id: string;
  name: string;
  category: string;
  unit: string;
  sellingPrice: number;
  stock: number;
};

type PosCustomer = { id: string; name: string; phone: string | null };

type CartLine = {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  stock: number;
  unit: string;
};

type Method = "MPESA" | "CASH" | "CARD" | "BANK_TRANSFER" | "CREDIT";
type Phase = "cart" | "push" | "success";

const METHODS: { value: Method; label: string }[] = [
  { value: "MPESA", label: "M-Pesa" },
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank" },
  { value: "CREDIT", label: "Credit" },
];

export function PosDialog({
  products,
  customers,
}: {
  products: PosProduct[];
  customers: PosCustomer[];
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("cart");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState<Method>("MPESA");
  const [phone, setPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    receiptNo: string;
    total: number;
    saleId: string;
  } | null>(null);

  const activeProducts = useMemo(
    () => products.filter((p) => p.stock > 0),
    [products],
  );

  const subtotal = cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const discountValue = Math.min(parseFloat(discount) || 0, subtotal);
  const total = subtotal - discountValue;

  function resetAll() {
    setCart([]);
    setCustomerId("");
    setPhone("");
    setDiscount("");
    setPhase("cart");
    setResult(null);
  }

  function closeDialog() {
    setOpen(false);
    setTimeout(resetAll, 300);
  }

  function addProduct(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    if (product.stock <= 0) {
      toast.error(`${product.name} is out of stock.`);
      return;
    }
    setCart((prev) => {
      const line = prev.find((l) => l.productId === productId);
      if (line) {
        if (line.quantity >= product.stock) {
          toast.error(`Only ${product.stock} in stock.`);
          return prev;
        }
        return prev.map((l) =>
          l.productId === productId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          unitPrice: product.sellingPrice,
          quantity: 1,
          stock: product.stock,
          unit: product.unit,
        },
      ];
    });
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.productId !== productId) return l;
          const q = l.quantity + delta;
          if (q > l.stock) {
            toast.error(`Only ${l.stock} in stock.`);
            return l;
          }
          return { ...l, quantity: Math.max(1, q) };
        })
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  function onCustomerChange(value: string) {
    setCustomerId(value);
    if (method === "MPESA") {
      const customer = customers.find((c) => c.id === value);
      if (customer?.phone) setPhone(customer.phone);
    }
  }

  async function submit() {
    if (cart.length === 0) {
      toast.error("Add at least one item to the sale.");
      return;
    }
    if (method === "MPESA" && !phone.trim()) {
      toast.error("Enter the customer's M-Pesa number.");
      return;
    }
    setBusy(true);
    try {
      const res = await createSaleAction({
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        customerId: customerId || undefined,
        paymentMethod: method,
        discount: discountValue,
        mpesaPhone: method === "MPESA" ? phone.trim() : undefined,
      });
      if (res?.error || !res?.data) {
        toast.error(res?.error ?? "Could not record the sale.");
        return;
      }
      const data = res.data;
      if (data.mpesaError) {
        await cancelSaleAction({ saleId: data.saleId });
        toast.error(data.mpesaError);
        return;
      }
      setResult({ receiptNo: data.receiptNo, total: parseFloat(data.total), saleId: data.saleId });
      setPhase(data.paymentMethod === "MPESA" ? "push" : "success");
    } finally {
      setBusy(false);
    }
  }

  async function simulatePayment() {
    if (!result) return;
    setBusy(true);
    try {
      const res = await completeMpesaSaleAction({ saleId: result.saleId });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(res.success ?? "Payment received.");
      setPhase("success");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPush() {
    if (!result) return;
    setBusy(true);
    try {
      const res = await cancelSaleAction({ saleId: result.saleId });
      if (res?.error) toast.error(res.error);
      else toast.success(res.success ?? "Sale cancelled.");
      resetAll();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeDialog())}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> New sale
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
        {phase === "cart" && (
          <>
            <DialogHeader>
              <DialogTitle>New sale</DialogTitle>
              <DialogDescription>
                Ring up items and accept payment — M-Pesa, cash or card.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
              {/* Left — picker */}
              <div className="space-y-4">
                <div>
                  <Label>Add items</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Select onValueChange={(v) => addProduct(v)} value="">
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Choose a product…" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeProducts.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} — {formatKES(p.sellingPrice)} ({p.stock} {p.unit})
                          </SelectItem>
                        ))}
                        {activeProducts.length === 0 && (
                          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                            No products in stock. Add products in Inventory first.
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Customer</Label>
                  <Select onValueChange={onCustomerChange} value={customerId}>
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Walk-in customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__walkin">Walk-in customer</SelectItem>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.phone ? ` · ${c.phone}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {method === "MPESA" && (
                  <div>
                    <Label>M-Pesa number</Label>
                    <Input
                      className="mt-1.5"
                      inputMode="tel"
                      placeholder="0712 345 678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      An STK push will be sent to this number for payment.
                    </p>
                  </div>
                )}

                <div>
                  <Label>Payment method</Label>
                  <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {METHODS.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMethod(m.value)}
                        className={cn(
                          "rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                          method === m.value
                            ? "border-brand-500/60 bg-brand-500/15 text-brand-300"
                            : "border-border text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right — cart */}
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Cart</p>
                  {cart.length > 0 && (
                    <Badge variant="muted">{cart.length} line{cart.length === 1 ? "" : "s"}</Badge>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  {cart.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      Cart is empty — add items on the left.
                    </p>
                  )}
                  {cart.map((line) => (
                    <div key={line.productId} className="rounded-md border border-border p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{line.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatKES(line.unitPrice)} / {line.unit}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.productId)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                          aria-label={`Remove ${line.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => changeQty(line.productId, -1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-sm font-semibold tabular-nums">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => changeQty(line.productId, 1)}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent"
                            aria-label="Increase quantity"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <span className="text-sm font-semibold tabular-nums">
                          {formatKES(line.unitPrice * line.quantity)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <Label htmlFor="discount">Discount (KSh)</Label>
                  <Input
                    id="discount"
                    className="mt-1.5"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </div>

                <Separator className="my-4" />

                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatKES(subtotal)}</span>
                  </div>
                  {discountValue > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Discount</span>
                      <span className="tabular-nums">−{formatKES(discountValue)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatKES(total)}</span>
                  </div>
                </div>

                <Button className="mt-4 w-full" onClick={submit} disabled={busy || cart.length === 0}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
                  {method === "MPESA" ? "Send STK push & record" : "Record sale"}
                </Button>
              </div>
            </div>
          </>
        )}

        {phase === "push" && result && (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/15">
              <Smartphone className="h-8 w-8 text-brand-400" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">STK push sent</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              A payment request of <span className="font-semibold text-foreground">{formatKES(result.total)}</span> was
              sent to <span className="font-semibold text-foreground">{formatPhone(phone)}</span>.
              Ask the customer to enter their M-Pesa PIN.
            </p>
            <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
              <Button onClick={simulatePayment} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Simulate payment
              </Button>
              <Button variant="outline" onClick={cancelPush} disabled={busy}>
                <XCircle className="h-4 w-4" /> Cancel sale
              </Button>
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground">
              Demo mode simulates the Safaricom callback. In production the sale
              completes automatically via the Daraja webhook.
            </p>
          </div>
        )}

        {phase === "success" && result && (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
              <CheckCircle2 className="h-8 w-8 text-success" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">Sale complete!</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Receipt <span className="font-mono font-medium text-foreground">{result.receiptNo}</span>
            </p>
            <p className="mt-3 text-3xl font-bold tracking-tight">{formatKES(result.total)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {cart.reduce((n, l) => n + l.quantity, 0)} item
              {cart.reduce((n, l) => n + l.quantity, 0) === 1 ? "" : "s"} · stock updated
            </p>
            <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
              <Button onClick={resetAll}>
                <Plus className="h-4 w-4" /> New sale
              </Button>
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
