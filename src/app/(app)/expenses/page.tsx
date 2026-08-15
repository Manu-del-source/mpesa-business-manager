import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCompactKES, formatDate, formatKES } from "@/lib/format";
import { getExpensesByCategory, thisMonthRange } from "@/lib/stats";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { SearchInput } from "@/components/layout/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EXPENSE_CATEGORY_LABELS,
  ExpenseCategoryBadge,
} from "@/components/shared/status";
import { ExpenseFormDialog } from "@/components/expenses/expense-form-dialog";
import { Wallet } from "lucide-react";

export const metadata: Metadata = { title: "Expenses" };

type SearchParams = Promise<{ q?: string; category?: string }>;

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAppContext();
  const { q, category } = await searchParams;

  const where: Record<string, unknown> = { organizationId: ctx.orgId };
  if (category && category !== "ALL") where.category = category;
  if (q) {
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { vendor: { contains: q, mode: "insensitive" } },
    ];
  }

  const [expenses, monthTotal, categoryBreakdown] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { expenseDate: "desc" },
      take: 100,
    }),
    prisma.expense.aggregate({
      where: { organizationId: ctx.orgId, expenseDate: { gte: thisMonthRange().from } },
      _sum: { amount: true },
    }),
    getExpensesByCategory(ctx.orgId, thisMonthRange()),
  ]);

  const monthTotalValue = monthTotal._sum.amount?.toNumber() ?? 0;
  const topCategory = categoryBreakdown.sort((a, b) => b.value - a.value)[0];
  const maxCategory = Math.max(1, ...categoryBreakdown.map((c) => c.value));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Track every cost — rent, salaries, stock and utilities."
      >
        <ExpenseFormDialog />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Spent this month</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">
              {formatCompactKES(monthTotalValue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Top category</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">
              {topCategory ? EXPENSE_CATEGORY_LABELS[topCategory.category] : "—"}
            </p>
            {topCategory && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatKES(topCategory.value)} this month
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">This month by category</p>
            <div className="mt-2 space-y-1.5">
              {categoryBreakdown.slice(0, 4).map((c) => (
                <div key={c.category} className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-3"
                      style={{ width: `${(c.value / maxCategory) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 truncate text-right text-[11px] text-muted-foreground">
                    {EXPENSE_CATEGORY_LABELS[c.category]}
                  </span>
                </div>
              ))}
              {categoryBreakdown.length === 0 && (
                <p className="text-xs text-muted-foreground">No expenses yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="GET">
            <SearchInput
              name="q"
              defaultValue={q}
              placeholder="Search description, vendor…"
              className="sm:col-span-2"
            />
            <Select name="category" defaultValue={category ?? "ALL"}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div>
              <Button type="submit" variant="outline" size="sm">
                Apply filters
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {expenses.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-5 w-5" />}
          title="No expenses recorded"
          description="Record rent, salaries or stock purchases to see them here."
        />
      ) : (
        <Card className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell className="font-medium">{expense.description}</TableCell>
                  <TableCell>
                    <ExpenseCategoryBadge category={expense.category} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {expense.vendor ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatKES(expense.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(expense.expenseDate)}
                  </TableCell>
                  <TableCell className="text-right">
                    <ExpenseFormDialog expense={expense} variant="edit" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {expenses.length > 0 && (
        <div className="space-y-3 sm:hidden">
          {expenses.map((expense) => (
            <Card key={expense.id}>
              <CardContent className="flex items-start justify-between p-4">
                <div>
                  <p className="font-medium">{expense.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <ExpenseCategoryBadge category={expense.category} />
                    {expense.vendor && (
                      <span className="text-xs text-muted-foreground">{expense.vendor}</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {formatDate(expense.expenseDate)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="font-bold tabular-nums">{formatKES(expense.amount)}</p>
                  <ExpenseFormDialog expense={expense} variant="edit" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
