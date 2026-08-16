import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * KPI tile.
 *
 * Deliberately opinionated about hierarchy: the value dominates, the label sits
 * above it in small caps, and the delta is a coloured pill so a shop owner can
 * read the trend at a glance without parsing text.
 *
 * `invertDelta` is for metrics where "up" is bad (e.g. expenses).
 */
export function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  sub,
  accent = "default",
  invertDelta = false,
  className,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  sub?: string;
  accent?: "default" | "success" | "warning" | "destructive" | "info";
  invertDelta?: boolean;
  className?: string;
}) {
  const accentRing: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
  };

  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const positive = hasDelta ? (invertDelta ? delta! < 0 : delta! > 0) : false;
  const flat = hasDelta && Math.abs(delta!) < 0.5;

  return (
    <Card className={cn("card-sheen overflow-hidden p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              accentRing[accent],
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>

      <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </p>

      <div className="mt-3 flex items-center gap-2">
        {hasDelta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              flat
                ? "bg-muted text-muted-foreground"
                : positive
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive",
            )}
          >
            {flat ? (
              <Minus className="h-3 w-3" />
            ) : delta! > 0 ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(delta!).toFixed(0)}%
          </span>
        )}
        {(deltaLabel || sub) && (
          <span className="truncate text-[11px] text-muted-foreground">
            {sub ?? deltaLabel}
          </span>
        )}
      </div>
    </Card>
  );
}
