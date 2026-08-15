import type { Metadata } from "next";
import Link from "next/link";
import { endOfMonth, endOfYear, startOfMonth, startOfYear, subMonths } from "date-fns";
import { requireAppContext } from "@/lib/auth";
import {
  getCogs,
  getDailyRevenueSeries,
  getExpenses,
  getExpensesByCategory,
  getMpesaIn,
  getMpesaOut,
  getMonthlyPnlSeries,
  getRevenue,
  getTopCustomers,
  getTopProducts,
} from "@/lib/stats";
import { formatCompactKES, formatKES } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ExpensesByCategoryChart,
  MonthlyPnlChart,
  RevenueAreaChart,
} from "@/components/dashboard/charts";
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp } from "lucide-react";

export const metadata: Metadata = { title: "Reports" };

type SearchParams = Promise<{ period?: string }>;

const PERIODS = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "3-months", label: "Last 3 months" },
  { key: "this-year", label: "This year" },
] as const;

function resolveRange(period: string) {
  const now = new Date();
  switch (period) {
    case "last-month":
      return { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) };
    case "3-months":
      return { from: startOfMonth(subMonths(now, 2)), to: endOfMonth(now) };
    case "this-year":
      return { from: startOfYear(now), to: endOfYear(now) };
    default:
      return { from: startOfMonth(now), to: endOfMonth(now) };
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAppContext();
  const { period = "this-month" } = await searchParams;
  const range = resolveRange(period);

  const [
    revenue,
    cogs,
    expenses,
    mpesaIn,
    mpesaOut,
    expensesByCategory,
    topProducts,
    topCustomers,
    pnlSeries,
    revenueSeries,
  ] = await Promise.all([
    getRevenue(ctx.orgId, range),
    getCogs(ctx.orgId, range),
    getExpenses(ctx.orgId, range),
    getMpesaIn(ctx.orgId, range),
    getMpesaOut(ctx.orgId, range),
    getExpensesByCategory(ctx.orgId, range),
    getTopProducts(ctx.orgId, range, 5),
    getTopCustomers(ctx.orgId, range, 5),
    getMonthlyPnlSeries(ctx.orgId, 6),
    getDailyRevenueSeries(ctx.orgId, 30),
  ]);

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenses;
  const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const maxProduct = Math.max(1, ...topProducts.map((p) => p.revenue));
  const maxCustomer = Math.max(1, ...topCustomers.map((c) => c.spend));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Profit & loss, cash flow and performance — know your numbers."
      >
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {PERIODS.map((p) => (
            <Button
              key={p.key}
              variant={period === p.key ? "default" : "ghost"}
              size="sm"
              asChild
              className={cn(period !== p.key && "text-muted-foreground")}
            >
              <Link href={`/reports?period=${p.key}`}>{p.label}</Link>
            </Button>
          ))}
        </div>
      </PageHeader>

      {/* P&L summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card>
          <CardContent className="p-5">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-success" /> Revenue
            </p>
            <p className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">
              {formatCompactKES(revenue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Cost of goods</p>
            <p className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">
              {formatCompactKES(cogs)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Gross profit</p>
            <p className="mt-2 text-xl font-bold tracking-tight sm:text-2xl text-success">
              {formatCompactKES(grossProfit)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Expenses</p>
            <p className="mt-2 text-xl font-bold tracking-tight sm:text-2xl text-destructive">
              {formatCompactKES(expenses)}
            </p>
          </CardContent>
        </Card>
        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="p-5">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {netProfit >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-success" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              )}
              Net profit
            </p>
            <p
              className={cn(
                "mt-2 text-xl font-bold tracking-tight sm:text-2xl",
                netProfit >= 0 ? "text-success" : "text-destructive",
              )}
            >
              {formatCompactKES(netProfit)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{margin.toFixed(1)}% margin</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Revenue — last 30 days</CardTitle>
          <Badge variant="outline">{formatCompactKES(revenueSeries.reduce((sum, d) => sum + d.revenue, 0))} total</Badge>
        </CardHeader>
        <CardContent>
          <RevenueAreaChart data={revenueSeries} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Revenue vs expenses — last 6 months</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyPnlChart data={pnlSeries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expenses by category</CardTitle>
          </CardHeader>
          <CardContent>
            {expensesByCategory.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No expenses in this period.</p>
            ) : (
              <ExpensesByCategoryChart data={expensesByCategory} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topProducts.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sales in this period.
              </p>
            )}
            {topProducts.map((product, i) => (
              <div key={product.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Badge variant="muted" className="w-6 justify-center">
                      {i + 1}
                    </Badge>
                    {product.name}
                  </span>
                  <span className="font-semibold tabular-nums">{formatKES(product.revenue)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                    style={{ width: `${(product.revenue / maxProduct) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top customers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topCustomers.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No named customers in this period.
              </p>
            )}
            {topCustomers.map((customer, i) => (
              <div key={customer.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Badge variant="muted" className="w-6 justify-center">
                      {i + 1}
                    </Badge>
                    {customer.name}
                    <span className="text-xs text-muted-foreground">
                      {customer.visits} visit{customer.visits === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatKES(customer.spend)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-chart-4 to-chart-5"
                    style={{ width: `${(customer.spend / maxCustomer) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* M-Pesa cash flow */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">M-Pesa cash flow — this period</CardTitle>
          <Badge variant="outline">{formatKES(mpesaIn - mpesaOut)} net</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-success/20 bg-success/5 p-4">
              <p className="text-sm text-muted-foreground">Received via M-Pesa</p>
              <p className="mt-1 text-xl font-bold text-success">{formatKES(mpesaIn)}</p>
            </div>
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <p className="text-sm text-muted-foreground">Sent via M-Pesa</p>
              <p className="mt-1 text-xl font-bold text-destructive">{formatKES(mpesaOut)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">Total sales (all methods)</p>
              <p className="mt-1 text-xl font-bold">{formatKES(revenue)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
