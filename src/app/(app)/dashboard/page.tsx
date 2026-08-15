import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
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
import { formatCompactKES, formatKES, formatRelative } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import {
  PaymentMethodDonut,
  RevenueAreaChart,
} from "@/components/dashboard/charts";
import {
  MpesaStatusBadge,
  PaymentMethodBadge,
} from "@/components/shared/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireAppContext();

  const month = thisMonthRange();
  const lastMonth = lastMonthRange();
  const today = { from: startOfDay(new Date()), to: new Date() };
  const yesterday = lastNDaysRange(1);

  const [todayRevenue, yesterdayRevenue, monthRevenue, lastMonthRevenue, monthMpesaIn, lastMonthMpesaIn, monthExpenses, lastMonthExpenses, lowStock, revenueSeries, paymentMethods, recentTxns, recentSales, lowStockProducts, todaySalesCount] =
    await Promise.all([
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
      prisma.sale.count({ where: { organizationId: ctx.orgId, createdAt: { gte: today.from } } }),
    ]);

  const monthProfit = monthRevenue - monthExpenses;
  const lastMonthProfit = lastMonthRevenue - lastMonthExpenses;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const kpis = [
    {
      label: "Today's sales",
      value: formatCompactKES(todayRevenue),
      delta: pctChange(todayRevenue, yesterdayRevenue),
      deltaLabel: "vs yesterday",
      icon: ReceiptText,
      sub: `${todaySalesCount} sale${todaySalesCount === 1 ? "" : "s"} today`,
    },
    {
      label: "Revenue this month",
      value: formatCompactKES(monthRevenue),
      delta: pctChange(monthRevenue, lastMonthRevenue),
      deltaLabel: "vs last month",
      icon: TrendingUp,
    },
    {
      label: "M-Pesa received",
      value: formatCompactKES(monthMpesaIn),
      delta: pctChange(monthMpesaIn, lastMonthMpesaIn),
      deltaLabel: "vs last month",
      icon: Smartphone,
    },
    {
      label: "Net profit",
      value: formatCompactKES(monthProfit),
      delta: pctChange(monthProfit, lastMonthProfit),
      deltaLabel: "vs last month",
      icon: Wallet,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${ctx.user.name.split(" ")[0]} 👋`}
        description={new Date().toLocaleDateString("en-KE", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      >
        <Button asChild>
          <Link href="/sales">
            <ReceiptText className="h-4 w-4" /> New sale
          </Link>
        </Button>
      </PageHeader>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                  <kpi.icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight">{kpi.value}</p>
              <div className="mt-2 flex items-center gap-2">
                {kpi.delta !== null ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                      kpi.delta >= 0
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {kpi.delta >= 0 ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {Math.abs(kpi.delta).toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">new</span>
                )}
                <span className="text-xs text-muted-foreground">{kpi.deltaLabel}</span>
              </div>
              {"sub" in kpi && kpi.sub ? (
                <p className="mt-1 text-xs text-muted-foreground">{kpi.sub}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Revenue — last 30 days</CardTitle>
            <Badge variant="outline">{formatKES(monthRevenue)} this month</Badge>
          </CardHeader>
          <CardContent>
            <RevenueAreaChart data={revenueSeries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales by payment method</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentMethodDonut data={paymentMethods} />
          </CardContent>
        </Card>
      </div>

      {/* Activity panels */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent M-Pesa transactions</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/mpesa">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {recentTxns.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No M-Pesa transactions yet.
              </p>
            )}
            {recentTxns.map((txn) => (
              <div
                key={txn.id}
                className="flex items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/15">
                    <Smartphone className="h-3.5 w-3.5 text-brand-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{txn.phone}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelative(txn.createdAt)} · {txn.receiptNo ?? txn.reference ?? "STK push"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <MpesaStatusBadge status={txn.status} />
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      txn.direction === "INCOMING" ? "text-success" : "text-destructive",
                    )}
                  >
                    {txn.direction === "INCOMING" ? "+" : "−"}
                    {formatKES(txn.amount)}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent sales</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/sales">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {recentSales.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sales yet — record your first one!
              </p>
            )}
            {recentSales.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Banknote className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{sale.customer?.name ?? "Walk-in"}</p>
                    <p className="text-xs text-muted-foreground">
                      {sale.receiptNo} · {formatRelative(sale.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <PaymentMethodBadge method={sale.paymentMethod} />
                  <span className="text-sm font-semibold tabular-nums">
                    {formatKES(sale.total)}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Low stock alerts</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/inventory">
                Inventory <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1">
            {lowStock === 0 && (
              <p className="flex items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <Package className="h-4 w-4" /> All products are well stocked. 🎉
              </p>
            )}
            {lowStockProducts.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between rounded-md px-2 py-2 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.category}</p>
                  </div>
                </div>
                <Badge variant={product.stock === 0 ? "destructive" : "warning"}>
                  {product.stock} {product.unit} left
                </Badge>
              </div>
            ))}
            {lowStock > lowStockProducts.length && (
              <p className="px-2 pt-2 text-xs text-muted-foreground">
                +{lowStock - lowStockProducts.length} more low-stock item
                {lowStock - lowStockProducts.length === 1 ? "" : "s"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
