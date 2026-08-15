import {
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { prisma } from "@/lib/prisma";

type Range = { from: Date; to: Date };

export function thisMonthRange(): Range {
  return { from: startOfMonth(new Date()), to: endOfMonth(new Date()) };
}

export function lastMonthRange(): Range {
  return {
    from: startOfMonth(subMonths(new Date(), 1)),
    to: endOfMonth(subMonths(new Date(), 1)),
  };
}

export function lastNDaysRange(days: number): Range {
  return { from: startOfDay(subDays(new Date(), days - 1)), to: endOfDay(new Date()) };
}

/** Sum of COMPLETED sale totals in a period. */
export async function getRevenue(orgId: string, { from, to }: Range): Promise<number> {
  const agg = await prisma.sale.aggregate({
    where: { organizationId: orgId, status: "COMPLETED", createdAt: { gte: from, lte: to } },
    _sum: { total: true },
  });
  return agg._sum.total?.toNumber() ?? 0;
}

/** Sum of expense amounts in a period. */
export async function getExpenses(orgId: string, { from, to }: Range): Promise<number> {
  const agg = await prisma.expense.aggregate({
    where: { organizationId: orgId, expenseDate: { gte: from, lte: to } },
    _sum: { amount: true },
  });
  return agg._sum.amount?.toNumber() ?? 0;
}

/** Sum of successful INCOMING M-Pesa transactions in a period. */
export async function getMpesaIn(orgId: string, { from, to }: Range): Promise<number> {
  const agg = await prisma.mpesaTransaction.aggregate({
    where: {
      organizationId: orgId,
      direction: "INCOMING",
      status: "SUCCESS",
      createdAt: { gte: from, lte: to },
    },
    _sum: { amount: true },
  });
  return agg._sum.amount?.toNumber() ?? 0;
}

/** Sum of successful OUTGOING M-Pesa transactions in a period. */
export async function getMpesaOut(orgId: string, { from, to }: Range): Promise<number> {
  const agg = await prisma.mpesaTransaction.aggregate({
    where: {
      organizationId: orgId,
      direction: "OUTGOING",
      status: "SUCCESS",
      createdAt: { gte: from, lte: to },
    },
    _sum: { amount: true },
  });
  return agg._sum.amount?.toNumber() ?? 0;
}

/** Daily revenue series (zero-filled) for the last N days. */
export async function getDailyRevenueSeries(orgId: string, days: number) {
  const range = lastNDaysRange(days);
  const sales = await prisma.sale.findMany({
    where: { organizationId: orgId, status: "COMPLETED", createdAt: { gte: range.from, lte: range.to } },
    select: { total: true, createdAt: true },
  });

  const byDay = new Map<string, number>();
  for (const s of sales) {
    const key = format(s.createdAt, "yyyy-MM-dd");
    byDay.set(key, (byDay.get(key) ?? 0) + s.total.toNumber());
  }

  return eachDayOfInterval({ start: range.from, end: range.to }).map((day) => {
    const key = format(day, "yyyy-MM-dd");
    return { date: format(day, "d MMM"), revenue: Math.round(byDay.get(key) ?? 0) };
  });
}

/** Sales totals grouped by payment method. */
export async function getSalesByPaymentMethod(orgId: string, { from, to }: Range) {
  const sales = await prisma.sale.findMany({
    where: { organizationId: orgId, status: "COMPLETED", createdAt: { gte: from, lte: to } },
    select: { paymentMethod: true, total: true },
  });

  const map = new Map<string, number>();
  for (const s of sales) {
    map.set(s.paymentMethod, (map.get(s.paymentMethod) ?? 0) + s.total.toNumber());
  }
  return [...map.entries()].map(([name, value]) => ({ name, value: Math.round(value) }));
}

/** Expense totals grouped by category. */
export async function getExpensesByCategory(orgId: string, { from, to }: Range) {
  const agg = await prisma.expense.groupBy({
    by: ["category"],
    where: { organizationId: orgId, expenseDate: { gte: from, lte: to } },
    _sum: { amount: true },
  });
  return agg.map((g) => ({ category: g.category, value: Math.round(g._sum.amount?.toNumber() ?? 0) }));
}

/** Top products by line total in a period. */
export async function getTopProducts(orgId: string, { from, to }: Range, limit = 5) {
  const items = await prisma.saleItem.findMany({
    where: { sale: { organizationId: orgId, status: "COMPLETED", createdAt: { gte: from, lte: to } } },
    select: { productName: true, quantity: true, lineTotal: true },
  });

  const map = new Map<string, { revenue: number; qty: number }>();
  for (const i of items) {
    const cur = map.get(i.productName) ?? { revenue: 0, qty: 0 };
    cur.revenue += i.lineTotal.toNumber();
    cur.qty += i.quantity;
    map.set(i.productName, cur);
  }

  return [...map.entries()]
    .map(([name, v]) => ({ name, revenue: Math.round(v.revenue), qty: v.qty }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/** Top customers by total spend in a period. */
export async function getTopCustomers(orgId: string, { from, to }: Range, limit = 5) {
  const sales = await prisma.sale.findMany({
    where: {
      organizationId: orgId,
      status: "COMPLETED",
      customerId: { not: null },
      createdAt: { gte: from, lte: to },
    },
    select: { total: true, customer: { select: { name: true } } },
  });

  const map = new Map<string, { spend: number; visits: number }>();
  for (const s of sales) {
    const name = s.customer?.name ?? "Unknown";
    const cur = map.get(name) ?? { spend: 0, visits: 0 };
    cur.spend += s.total.toNumber();
    cur.visits += 1;
    map.set(name, cur);
  }

  return [...map.entries()]
    .map(([name, v]) => ({ name, spend: Math.round(v.spend), visits: v.visits }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, limit);
}

/** Cost of goods sold in a period (current cost price × quantity sold). */
export async function getCogs(orgId: string, { from, to }: Range): Promise<number> {
  const items = await prisma.saleItem.findMany({
    where: {
      sale: { organizationId: orgId, status: "COMPLETED", createdAt: { gte: from, lte: to } },
    },
    select: { quantity: true, product: { select: { costPrice: true } } },
  });

  return items.reduce((sum, i) => {
    const cost = i.product?.costPrice?.toNumber() ?? 0;
    return sum + cost * i.quantity;
  }, 0);
}

/** Monthly revenue vs expenses series for the last N months. */
export async function getMonthlyPnlSeries(orgId: string, months: number) {
  const to = endOfMonth(new Date());
  const from = startOfMonth(subMonths(new Date(), months - 1));

  const sales = await prisma.sale.findMany({
    where: { organizationId: orgId, status: "COMPLETED", createdAt: { gte: from, lte: to } },
    select: { total: true, createdAt: true },
  });
  const expenses = await prisma.expense.findMany({
    where: { organizationId: orgId, expenseDate: { gte: from, lte: to } },
    select: { amount: true, expenseDate: true },
  });

  const revByMonth = new Map<string, number>();
  const expByMonth = new Map<string, number>();
  for (const s of sales) {
    const key = format(s.createdAt, "MMM yyyy");
    revByMonth.set(key, (revByMonth.get(key) ?? 0) + s.total.toNumber());
  }
  for (const e of expenses) {
    const key = format(e.expenseDate, "MMM yyyy");
    expByMonth.set(key, (expByMonth.get(key) ?? 0) + e.amount.toNumber());
  }

  return eachMonthOfInterval({ start: from, end: to }).map((month) => {
    const key = format(month, "MMM yyyy");
    const revenue = Math.round(revByMonth.get(key) ?? 0);
    const expense = Math.round(expByMonth.get(key) ?? 0);
    return { month: key, revenue, expenses: expense, profit: revenue - expense };
  });
}

/** Count of products at or below their low-stock threshold. */
export async function getLowStockCount(orgId: string): Promise<number> {
  return prisma.product.count({
    where: { organizationId: orgId, active: true, stock: { lte: prisma.product.fields.lowStockThreshold } },
  });
}

/** Stock value at cost for all active products. */
export async function getStockValue(orgId: string): Promise<number> {
  const products = await prisma.product.findMany({
    where: { organizationId: orgId, active: true },
    select: { costPrice: true, stock: true },
  });
  return products.reduce((sum, p) => sum + p.costPrice.toNumber() * p.stock, 0);
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}
