"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, PackagePlus } from "lucide-react";
import { adjustStockAction } from "@/app/actions/products";
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

export function StockAdjustButton({
  product,
}: {
  product: { id: string; name: string; stock: number; unit: string };
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const qty = parseInt(quantity, 10);
    if (!qty || qty === 0) {
      toast.error("Enter a quantity.");
      return;
    }
    const delta = mode === "add" ? qty : -qty;
    setBusy(true);
    try {
      const result = await adjustStockAction({ productId: product.id, quantity: delta });
      if (result?.error) toast.error(result.error);
      else {
        toast.success(result.success ?? "Stock updated.");
        setOpen(false);
        setQuantity("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="iconSm" aria-label={`Adjust stock for ${product.name}`}>
          <PackagePlus className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust stock — {product.name}</DialogTitle>
          <DialogDescription>
            Current stock: <span className="font-semibold text-foreground">{product.stock} {product.unit}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("add")}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "add"
                  ? "border-success/50 bg-success/10 text-success"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              + Add stock
            </button>
            <button
              type="button"
              onClick={() => setMode("remove")}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "remove"
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              − Remove stock
            </button>
          </div>

          <div>
            <Label>Quantity</Label>
            <Input
              className="mt-1.5"
              type="number"
              min={1}
              placeholder="10"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Update stock
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
