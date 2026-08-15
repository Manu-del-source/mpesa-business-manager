"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { toggleProductActiveAction } from "@/app/actions/products";
import { Button } from "@/components/ui/button";

export function ArchiveToggleButton({
  product,
}: {
  product: { id: string; name: string; active: boolean };
}) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const result = await toggleProductActiveAction({ id: product.id });
      if (result?.error) toast.error(result.error);
      else toast.success(result.success ?? "Updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="iconSm"
      onClick={() => void toggle()}
      disabled={busy}
      aria-label={product.active ? `Archive ${product.name}` : `Restore ${product.name}`}
      title={product.active ? "Archive" : "Restore"}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : product.active ? (
        <Archive className="h-3.5 w-3.5" />
      ) : (
        <ArchiveRestore className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
