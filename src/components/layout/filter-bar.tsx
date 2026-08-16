import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared GET-form filter bar.
 *
 * Previously each page rendered its own card + grid + "Apply filters" button
 * with slightly different spacing. This centralises the treatment so filters
 * look identical on M-Pesa, Sales, Expenses and Inventory.
 */
export function FilterBar({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <form
      method="GET"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        {action ?? (
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 text-xs font-semibold transition-colors hover:bg-accent"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Apply
          </button>
        )}
      </div>
    </form>
  );
}
