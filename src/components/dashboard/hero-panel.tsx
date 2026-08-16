import Link from "next/link";
import { ArrowUpRight, Plus, Smartphone, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatKES } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Dashboard hero.
 *
 * The old dashboard opened with four equal-weight KPI tiles, so nothing led the
 * eye. This panel establishes a single focal point — today's takings — and
 * pairs it with the two actions a shop owner performs most.
 */
export function HeroPanel({
  greeting,
  firstName,
  dateLabel,
  todayRevenue,
  todaySalesCount,
  todayDelta,
  monthRevenue,
  monthProfit,
}: {
  greeting: string;
  firstName: string;
  dateLabel: string;
  todayRevenue: number;
  todaySalesCount: number;
  todayDelta: number | null;
  monthRevenue: number;
  monthProfit: number;
}) {
  const up = todayDelta !== null && todayDelta >= 0;
  const profitPositive = monthProfit >= 0;

  return (
    <Card
      variant="elevated"
      className="brand-glow card-sheen relative overflow-hidden border-border"
    >
      <div className="relative z-10 flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between lg:p-7">
        <div className="min-w-0 space-y-4">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {dateLabel}
            </p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {greeting}, {firstName}
            </h1>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Today&apos;s sales
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[40px] font-semibold leading-none tracking-tight tabular-nums sm:text-[48px]">
                {formatKES(todayRevenue)}
              </span>
              {todayDelta !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
                    up
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {up ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  {Math.abs(todayDelta).toFixed(0)}% vs yesterday
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {todaySalesCount} sale{todaySalesCount === 1 ? "" : "s"} recorded today
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild size="lg">
              <Link href="/sales">
                <Plus className="h-4 w-4" /> New sale
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/mpesa">
                <Smartphone className="h-4 w-4" /> Request payment
              </Link>
            </Button>
          </div>
        </div>

        {/* Month summary rail */}
        <div className="grid shrink-0 grid-cols-2 gap-3 lg:w-[300px]">
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Revenue
            </p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">
              {formatKES(monthRevenue)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">this month</p>
          </div>
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Net profit
            </p>
            <p
              className={cn(
                "mt-1.5 text-xl font-semibold tracking-tight tabular-nums",
                profitPositive ? "text-success" : "text-destructive",
              )}
            >
              {formatKES(monthProfit)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">this month</p>
          </div>
          <Link
            href="/reports"
            className="col-span-2 flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3 text-sm font-medium transition-colors hover:border-border-strong hover:bg-accent/50"
          >
            View full reports
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
      </div>
    </Card>
  );
}
