"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { clearOrganizationDataAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
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

export function DangerZone() {
  const [busy, setBusy] = useState(false);

  async function clearData() {
    setBusy(true);
    try {
      const result = await clearOrganizationDataAction();
      if (result?.error) toast.error(result.error);
      else toast.success(result.success ?? "All data cleared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div>
        <p className="text-sm font-semibold text-destructive">Danger zone</p>
        <p className="text-xs text-muted-foreground">
          Permanently delete all sales, products, customers, expenses and M-Pesa
          transactions for this business.
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" /> Clear all data
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all business data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every sale, product, customer, expense and
              M-Pesa transaction. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void clearData()}
              disabled={busy}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Yes, delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
