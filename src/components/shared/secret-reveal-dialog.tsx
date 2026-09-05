"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

/**
 * Shows a secret exactly once, immediately after creation. The backend
 * only ever returns the raw value at creation time — this dialog never
 * persists it (no localStorage/sessionStorage), and it disappears from
 * memory the moment the dialog is closed since it lives in the parent's
 * transient React state only.
 */
export function SecretRevealDialog({
  open,
  onOpenChange,
  title,
  secret,
  warning = "This is the only time this value will be shown. Store it securely now — it cannot be retrieved again.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  secret: string | null;
  warning?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — user can still select the text manually
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setCopied(false);
        onOpenChange(o);
      }}
    >
      <DialogContent className="bg-surface-container-lowest border-outline-variant max-w-md">
        <DialogHeader>
          <DialogTitle className="text-headline-sm font-headline-sm text-primary">{title}</DialogTitle>
        </DialogHeader>
        <div className="my-3 space-y-3">
          <p className="text-[12px] text-red-700 bg-red-50 p-2.5 rounded border border-red-200 leading-relaxed font-medium">
            ⚠️ {warning}
          </p>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
            <code className="flex-1 font-code-sm text-code-sm break-all text-primary">{secret}</code>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 px-2.5 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-body-sm font-medium transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">{copied ? "check" : "content_copy"}</span>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="w-full bg-primary text-on-primary px-4 py-2 rounded text-body-sm font-medium hover:bg-opacity-90"
          >
            I&apos;ve saved it — Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
