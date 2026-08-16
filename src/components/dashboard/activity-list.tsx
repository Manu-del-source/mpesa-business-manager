import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardToolbar } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Panel used by the dashboard activity feeds.
 *
 * Keeps the header/empty-state/footer treatment identical across M-Pesa,
 * sales and low-stock lists so they read as one family.
 */
export function ActivityPanel({
  title,
  href,
  linkLabel = "View all",
  isEmpty,
  emptyText,
  emptyIcon,
  children,
  className,
}: {
  title: string;
  href: string;
  linkLabel?: string;
  isEmpty: boolean;
  emptyText: string;
  emptyIcon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <CardToolbar>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {linkLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardToolbar>

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-12 text-center">
          {emptyIcon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              {emptyIcon}
            </div>
          )}
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        </div>
      ) : (
        <div className="divide-y divide-border">{children}</div>
      )}
    </Card>
  );
}

/** A single row inside an ActivityPanel. */
export function ActivityRow({
  icon,
  title,
  meta,
  value,
  valueClassName,
  badge,
  href,
}: {
  icon?: React.ReactNode;
  title: string;
  meta: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  badge?: React.ReactNode;
  href?: string;
}) {
  const inner = (
    <div className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/40">
      {icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={cn("text-sm font-semibold tabular-nums", valueClassName)}>
          {value}
        </span>
        {badge}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
