import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatKES } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { FilterBar } from "@/components/layout/filter-bar";
import { Card, CardContent, CardToolbar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  PAYMENT_METHOD_LABELS,
  PaymentMethodBadge,
  SaleStatusBadge,
} from "@/components/shared/status";
import { PosDialog } from "@/components/sales/pos-dialog";
import { SaleDetailSheet, type SaleForDetail } from "@/components/sales/sale-detail-sheet";
import { Banknote, CheckCircle2, Clock, ReceiptText } from "lucide-react";
import { formatCompactKES } from "@/lib/format";

export const metadata: Metadata = { title: "Sales" };

type SearchParams = Promise<{ q?: string; method?: string; status?: string }>;

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAppContext();
  const { q, method, status } = await searchParams;

  const where: Record<string, unknown> = { organizationId: ctx.orgId };

  if (method && method !== "ALL") where.paymentMethod = method;
  if (status && status !== "ALL") where.status = status;
  if (q) {
    where.OR = [
      { receiptNo: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      { mpesaReference: { contains: q, mode: "insensitive" } },
    ];
  }

  const [sales, products, customers, totals, completedCount, pendingCount] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { customer: true, items: true },
    }),
    prisma.product.findMany({
      where: { organizationId: ctx.orgId, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.customer.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { name: "asc" },
    }),
    prisma.sale.aggregate({
      where: { organizationId: ctx.orgId, status: "COMPLETED" },
      _sum: { total: true },
      _count: true,
    }),
    prisma.sale.count({ where: { organizationId: ctx.orgId, status: "COMPLETED" } }),
    prisma.sale.count({ where: { organizationId: ctx.orgId, status: "PENDING" } }),
  ]);

  const lifetimeRevenue = totals._sum.total?.toNumber() ?? 0;
  const averageSale = completedCount > 0 ? lifetimeRevenue / completedCount : 0;
  const hasFilters = Boolean(
    q || (method && method !== "ALL") || (status && status !== "ALL"),
  );

  const posProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    unit: p.unit,
    sellingPrice: p.sellingPrice.toNumber(),
    stock: p.stock,
  }));

  const serializedSales: SaleForDetail[] = sales.map((sale) => ({
    id: sale.id,
    receiptNo: sale.receiptNo,
    status: sale.status,
    paymentMethod: sale.paymentMethod,
    subtotal: sale.subtotal.toNumber(),
    discount: sale.discount.toNumber(),
    total: sale.total.toNumber(),
    mpesaReference: sale.mpesaReference,
    notes: sale.notes,
    createdAt: sale.createdAt.toISOString(),
    customer: sale.customer
      ? { name: sale.customer.name, phone: sale.customer.phone }
      : null,
    items: sale.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toNumber(),
      lineTotal: item.lineTotal.toNumber(),
    })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        description="Record sales at the till and review every transaction."
        eyebrow={
          <>
            <ReceiptText className="h-3 w-3" />
            Point of sale
          </>
        }
      >
        <PosDialog products={posProducts} customers={customers} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Lifetime revenue"
          value={formatCompactKES(lifetimeRevenue)}
          sub="completed sales"
          icon={Banknote}
          accent="success"
        />
        <StatCard
          label="Completed"
          value={String(completedCount)}
          sub="sales settled"
          icon={CheckCircle2}
          accent="default"
        />
        <StatCard
          label="Pending"
          value={String(pendingCount)}
          sub="awaiting payment"
          icon={Clock}
          accent={pendingCount > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Average sale"
          value={formatCompactKES(averageSale)}
          sub="per completed sale"
          icon={ReceiptText}
          accent="info"
        />
      </div>

      <FilterBar>
        <SearchInput
          name="q"
          defaultValue={q}
          placeholder="Search receipt or customer…"
          className="sm:col-span-2"
        />
        <Select name="method" defaultValue={method ?? "ALL"}>
          <SelectTrigger>
            <SelectValue placeholder="Payment method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All methods</SelectItem>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select name="status" defaultValue={status ?? "ALL"}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="REFUNDED">Refunded</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {sales.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="h-5 w-5" />}
          title={hasFilters ? "No matching sales" : "No sales yet"}
          description={
            hasFilters
              ? "Try clearing the filters or searching for a different receipt."
              : "Record your first sale with the till above — it takes seconds."
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden sm:block">
            <CardToolbar>
              <h3 className="text-sm font-semibold tracking-tight">Recent sales</h3>
              <span className="text-xs text-muted-foreground">
                Showing {sales.length}
                {sales.length === 100 ? " (most recent)" : ""}
              </span>
            </CardToolbar>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Receipt</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serializedSales.map((sale) => (
                  <SaleDetailSheet key={sale.id} sale={sale}>
                    <TableRow className="cursor-pointer" data-sale-row>
                      <TableCell className="font-mono text-xs font-medium">
                        {sale.receiptNo}
                      </TableCell>
                      <TableCell className="font-medium">
                        {sale.customer?.name ?? "Walk-in"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {sale.items.reduce((n, i) => n + i.quantity, 0)}
                      </TableCell>
                      <TableCell>
                        <PaymentMethodBadge method={sale.paymentMethod} />
                      </TableCell>
                      <TableCell>
                        <SaleStatusBadge status={sale.status} />
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatKES(sale.total)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(sale.createdAt)}
                      </TableCell>
                    </TableRow>
                  </SaleDetailSheet>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2.5 sm:hidden">
            {serializedSales.map((sale) => (
              <SaleDetailSheet key={sale.id} sale={sale}>
                <Card interactive>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {sale.customer?.name ?? "Walk-in customer"}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {sale.receiptNo}
                        </p>
                      </div>
                      <p className="shrink-0 text-base font-semibold tabular-nums">
                        {formatKES(sale.total)}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <PaymentMethodBadge method={sale.paymentMethod} />
                      <SaleStatusBadge status={sale.status} />
                      <Badge variant="muted" size="sm">
                        {sale.items.reduce((n, i) => n + i.quantity, 0)} items
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDateTime(sale.createdAt)}
                    </p>
                  </CardContent>
                </Card>
              </SaleDetailSheet>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
