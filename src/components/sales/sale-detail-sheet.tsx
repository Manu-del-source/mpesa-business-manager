"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Smartphone, XCircle } from "lucide-react";
import { formatKES, formatPhone } from "@/lib/format";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PaymentMethodBadge, SaleStatusBadge } from "@/components/shared/status";
import { cancelSaleAction, completeMpesaSaleAction } from "@/app/actions/sales";
import { cn } from "@/lib/utils";

export type SaleForDetail = {
  id: string;
  receiptNo: string;
  status: string;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  total: number;
  mpesaReference: string | null;
  notes: string | null;
  createdAt: string;
  customer: { name: string; phone: string | null } | null;
  items: {
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
};

export function SaleDetailSheet({
  sale,
  children,
}: {
  sale: SaleForDetail;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const isPendingMpesa = sale.status === "PENDING" && sale.paymentMethod === "MPESA";

  async function completePayment() {
    setBusy("pay");
    try {
      const result = await completeMpesaSaleAction({ saleId: sale.id });
      if (result?.error) toast.error(result.error);
      else toast.success(result.success ?? "Payment received.");
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  async function cancelSale() {
    setBusy("cancel");
    try {
      const result = await cancelSaleAction({ saleId: sale.id });
      if (result?.error) toast.error(result.error);
      else toast.success(result.success ?? "Sale cancelled.");
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
        <SheetContent className="overflow-y-auto p-0">
          <SheetHeader className="border-b border-border p-5">
            <div className="flex items-center justify-between pr-8">
              <SheetTitle className="font-mono text-sm">{sale.receiptNo}</SheetTitle>
              <SaleStatusBadge status={sale.status} />
            </div>
            <SheetDescription className="text-xs">
              {new Date(sale.createdAt).toLocaleString("en-KE")}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{sale.customer?.name ?? "Walk-in customer"}</p>
                {sale.customer?.phone && (
                  <p className="text-xs text-muted-foreground">
                    {formatPhone(sale.customer.phone)}
                  </p>
                )}
              </div>
              <PaymentMethodBadge method={sale.paymentMethod} />
            </div>

            {sale.mpesaReference && (
              <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                <CheckCircle2 className="h-4 w-4" />
                M-Pesa receipt {sale.mpesaReference}
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Items
              </p>
              <div className="space-y-2">
                {sale.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span>
                      {item.productName}{" "}
                      <span className="text-muted-foreground">
                        × {item.quantity} @ {formatKES(item.unitPrice)}
                      </span>
                    </span>
                    <span className="font-medium tabular-nums">{formatKES(item.lineTotal)}</span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatKES(sale.subtotal)}</span>
              </div>
              {sale.discount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Discount</span>
                  <span>−{formatKES(sale.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span>{formatKES(sale.total)}</span>
              </div>
            </div>

            {sale.notes && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {sale.notes}
              </p>
            )}

            {isPendingMpesa && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
                <p className="flex items-center gap-2 text-xs font-medium text-warning">
                  <Smartphone className="h-4 w-4" /> Awaiting M-Pesa payment
                </p>
                <p className="text-xs text-muted-foreground">
                  In demo mode, simulate the customer entering their PIN to complete
                  the payment.
                </p>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={completePayment}
                    disabled={busy !== null}
                  >
                    {busy === "pay" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Simulate payment
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" disabled={busy !== null}>
                        <XCircle className="h-4 w-4" /> Cancel
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel this sale?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The pending M-Pesa payment will be cancelled and the sale
                          marked as cancelled. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep sale</AlertDialogCancel>
                        <AlertDialogAction
                          className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                          onClick={() => void cancelSale()}
                        >
                          Cancel sale
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
    </Sheet>
  );
}
