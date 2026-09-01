"use client";

import React, { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatMinorUnits } from "@/lib/format";

export type LiveActionConfirmationProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  actionName: string;
  environment: "SANDBOX" | "LIVE";
  applicationName: string;
  amountMinor?: number | bigint;
  recipient?: string;
  details?: string;
  consequences?: string;
  onConfirm: () => Promise<void> | void;
};

export function LiveActionDialog({
  open,
  onOpenChange,
  title,
  actionName,
  environment,
  applicationName,
  amountMinor,
  recipient,
  details,
  consequences = "This action will initiate an irreversible financial operation in the LIVE production environment.",
  onConfirm,
}: LiveActionConfirmationProps) {
  const [submitting, setSubmitting] = useState(false);

  const isLive = environment === "LIVE";

  const handleConfirm = async () => {
    try {
      setSubmitting(true);
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Error handled by caller
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            {isLive ? (
              <span className="p-2 rounded-full bg-red-100 text-red-700 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">warning</span>
              </span>
            ) : (
              <span className="p-2 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">science</span>
              </span>
            )}
            <AlertDialogTitle className="text-headline-sm font-headline-sm text-primary">
              {title || "Confirm Financial Action"}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-body-sm font-body-sm text-on-surface-variant pt-2">
            Please verify the transaction details before submitting:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="my-3 p-4 rounded-lg bg-surface-container-low border border-outline-variant space-y-2 text-body-sm">
          <div className="flex justify-between items-center py-1 border-b border-outline-variant/40">
            <span className="text-label-caps font-label-caps text-on-surface-variant">Environment</span>
            <span
              className={`px-2 py-0.5 rounded text-label-caps font-label-caps font-bold ${
                isLive ? "bg-red-600 text-white" : "bg-amber-500 text-amber-950"
              }`}
            >
              {environment}
            </span>
          </div>

          <div className="flex justify-between items-center py-1 border-b border-outline-variant/40">
            <span className="text-label-caps font-label-caps text-on-surface-variant">Application</span>
            <span className="font-medium text-primary">{applicationName}</span>
          </div>

          {amountMinor !== undefined && (
            <div className="flex justify-between items-center py-1 border-b border-outline-variant/40">
              <span className="text-label-caps font-label-caps text-on-surface-variant">Amount</span>
              <span className="font-code-md text-code-md font-semibold text-primary">
                {formatMinorUnits(amountMinor)}
              </span>
            </div>
          )}

          {recipient && (
            <div className="flex justify-between items-center py-1 border-b border-outline-variant/40">
              <span className="text-label-caps font-label-caps text-on-surface-variant">Recipient</span>
              <span className="font-code-sm text-code-sm text-primary">{recipient}</span>
            </div>
          )}

          {details && (
            <div className="py-1">
              <span className="text-label-caps font-label-caps text-on-surface-variant block mb-1">Details</span>
              <p className="text-body-sm text-on-surface">{details}</p>
            </div>
          )}
        </div>

        {isLive && (
          <p className="text-[12px] text-red-700 bg-red-50 p-2.5 rounded border border-red-200 leading-relaxed font-medium">
            ⚠️ {consequences}
          </p>
        )}

        <AlertDialogFooter className="mt-4 gap-2">
          <AlertDialogCancel disabled={submitting} className="rounded border-outline-variant text-body-sm">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={submitting}
            className={`rounded text-body-sm font-medium text-white ${
              isLive ? "bg-red-700 hover:bg-red-800" : "bg-primary hover:bg-opacity-90"
            }`}
          >
            {submitting ? "Processing..." : actionName || "Confirm Action"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
