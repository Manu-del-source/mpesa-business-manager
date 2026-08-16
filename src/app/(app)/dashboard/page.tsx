import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Package,
  ReceiptText,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { startOfDay } from "date-fns";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getDailyRevenueSeries,
  getExpenses,
  getLowStockCount,
  getMpesaIn,
  getRevenue,
  getSalesByPaymentMethod,
  lastMonthRange,
  lastNDaysRange,
  pctChange,
  thisMonthRange,
} from "@/lib/stats";
import { formatCompactKES, formatKES, formatPhone, formatRelative } from "@/lib/format";
import { Card, CardContent, CardToolbar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/layout/stat-card";
import { HeroPanel } from "@/components/dashboard/hero-panel";
import { ActivityPanel, ActivityRow } from "@/components/dashboard/activity-list";
import { PaymentMethodDonut, RevenueAreaChart } from "@/components/dashboard/charts";
import { MpesaStatusBadge, PaymentMethodBadge } from "@/components/shared/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAppContext();

  const month = thisMonthRange();
  const lastMonth = lastMonthRange();
  const today = { from: startOfDay(new Date()), to: new Date() };
  const yesterday = lastNDaysRange(1);

  const [
    todayRevenue,
    yesterdayRevenue,
    monthRevenue,
    lastMonthRevenue,
    monthMpesaIn,
    lastMonthMpesaIn,
    monthExpenses,
    lastMonthExpenses,
    lowStock,
    revenueSeries,
    paymentMethods,
    recentTxns,
    recentSales,
    lowStockProducts,
    todaySalesCount,
  ] = await Promise.all([
    getRevenue(ctx.orgId, today),
    getRevenue(ctx.orgId, yesterday),
    getRevenue(ctx.orgId, month),
    getRevenue(ctx.orgId, lastMonth),
    getMpesaIn(ctx.orgId, month),
    getMpesaIn(ctx.orgId, lastMonth),
    getExpenses(ctx.orgId, month),
    getExpenses(ctx.orgId, lastMonth),
    getLowStockCount(ctx.orgId),
    getDailyRevenueSeries(ctx.orgId, 30),
    getSalesByPaymentMethod(ctx.orgId, month),
    prisma.mpesaTransaction.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.sale.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { customer: true },
    }),
    prisma.product.findMany({
      where: { organizationId: ctx.orgId, active: true },
      orderBy: { stock: "asc" },
      take: 5,
    }),
    prisma.sale.count({
      where: { organizationId: ctx.orgId, createdAt: { gte: today.from } },
    }),
  ]);

  const monthProfit = monthRevenue - monthExpenses;
  const lastMonthProfit = lastMonthRevenue - lastMonthExpenses;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const kpis = [
    {
      label: "Revenue",
      value: formatCompactKES(monthRevenue),
      delta: pctChange(monthRevenue, lastMonthRevenue),
      sub: "vs last month",
      icon: TrendingUp,
      accent: "default" as const,
    },
    {
      label: "M-Pesa in",
      value: formatCompactKES(monthMpesaIn),
      delta: pctChange(monthMpesaIn, lastMonthMpesaIn),
      sub: "vs last month",
      icon: Smartphone,
      accent: "success" as const,
    },
    {
      label: "Expenses",
      value: formatCompactKES(monthExpenses),
      delta: pctChange(monthExpenses, lastMonthExpenses),
      sub: "vs last month",
      icon: Wallet,
      accent: "warning" as const,
      invertDelta: true,
    },
    {
      label: "Net profit",
      value: formatCompactKES(monthProfit),
      delta: pctChange(monthProfit, lastMonthProfit),
      sub: "vs last month",
      icon: Banknote,
      accent: monthProfit >= 0 ? ("success" as const) : ("destructive" as const),
    },
  ];

  return (
    <div className="space-y-6">
      <HeroPanel
        greeting={greeting}
        firstName={ctx.user.name.split(" ")[0]}
        dateLabel={new Date().toLocaleDateString("en-KE", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        todayRevenue={todayRevenue}
        todaySalesCount={todaySalesCount}
        todayDelta={pctChange(todayRevenue, yesterdayRevenue)}
        monthRevenue={monthRevenue}
        monthProfit={monthProfit}
      />

      {/* Low-stock alert — actionable, so it sits above the fold. */}
      {lowStock > 0 && (
        <Link
          href="/inventory?filter=low"
          className="flex items-center gap-3 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3 transition-colors hover:bg-warning/10"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/15">
            <AlertTriangle className="h-4 w-4 text-warning" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {lowStock} product{lowStock === 1 ? "" : "s"} running low
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Restock before you run out — tap to review.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {/* This month at a glance */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">This month</h2>
          <Badge variant="muted" size="sm">
            {new Date().toLocaleDateString("en-KE", { month: "long", year: "numeric" })}
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <StatCard key={kpi.label} {...kpi} />
          ))}
        </div>
      </section>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardToolbar>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Revenue trend</h3>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
            </div>
            <Badge variant="outline" size="sm">
              {formatKES(monthRevenue)} MTD
            </Badge>
          </CardToolbar>
          <CardContent className="pt-4">
            <RevenueAreaChart data={revenueSeries} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardToolbar>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Payment methods</h3>
              <p className="text-xs text-muted-foreground">How customers pay</p>
            </div>
          </CardToolbar>
          <CardContent className="pt-4">
            <PaymentMethodDonut data={paymentMethods} />
          </CardContent>
        </Card>
      </div>

      {/* Activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ActivityPanel
          title="Recent M-Pesa"
          href="/mpesa"
          isEmpty={recentTxns.length === 0}
          emptyText="No M-Pesa transactions yet."
          emptyIcon={<Smartphone className="h-5 w-5" />}
        >
          {recentTxns.map((txn) => (
            <ActivityRow
              key={txn.id}
              icon={<Smartphone className="h-4 w-4 text-brand-500" />}
              title={formatPhone(txn.phone)}
              meta={
                <>
                  {formatRelative(txn.createdAt)}
                  {(txn.receiptNo ?? txn.reference) && (
                    <> · {txn.receiptNo ?? txn.reference}</>
                  )}
                </>
              }
              value={
                <>
                  {txn.direction === "INCOMING" ? "+" : "−"}
                  {formatKES(txn.amount)}
                </>
              }
              valueClassName={
                txn.direction === "INCOMING" ? "text-success" : "text-destructive"
              }
              badge={<MpesaStatusBadge status={txn.status} />}
            />
          ))}
        </ActivityPanel>

        <ActivityPanel
          title="Recent sales"
          href="/sales"
          isEmpty={recentSales.length === 0}
          emptyText="No sales yet — record your first one."
          emptyIcon={<ReceiptText className="h-5 w-5" />}
        >
          {recentSales.map((sale) => (
            <ActivityRow
              key={sale.id}
              icon={<ReceiptText className="h-4 w-4 text-muted-foreground" />}
              title={sale.customer?.name ?? "Walk-in customer"}
              meta={
                <>
                  {sale.receiptNo} · {formatRelative(sale.createdAt)}
                </>
              }
              value={formatKES(sale.total)}
              badge={<PaymentMethodBadge method={sale.paymentMethod} />}
            />
          ))}
        </ActivityPanel>

        <ActivityPanel
          title="Low stock"
          href="/inventory"
          linkLabel="Manage"
          isEmpty={lowStockProducts.length === 0}
          emptyText="Everything is well stocked."
          emptyIcon={<Package className="h-5 w-5" />}
        >
          {lowStockProducts.map((product) => {
            const critical = product.stock <= 0;
            const low = product.stock <= product.lowStockThreshold;
            return (
              <ActivityRow
                key={product.id}
                icon={
                  <Package
                    className={cn(
                      "h-4 w-4",
                      critical
                        ? "text-destructive"
                        : low
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}
                  />
                }
                title={product.name}
                meta={<>Reorder at {product.lowStockThreshold} {product.unit}</>}
                value={`${product.stock} ${product.unit}`}
                valueClassName={
                  critical ? "text-destructive" : low ? "text-warning" : undefined
                }
                badge={
                  critical ? (
                    <Badge variant="destructive" size="sm">
                      Out
                    </Badge>
                  ) : low ? (
                    <Badge variant="warning" size="sm">
                      Low
                    </Badge>
                  ) : undefined
                }
              />
            );
          })}
        </ActivityPanel>
      </div>
    </div>
  );
}
