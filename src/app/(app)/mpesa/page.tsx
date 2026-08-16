import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Settings2, Smartphone, Wallet } from "lucide-react";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSafeMpesaConfig } from "@/lib/mpesa/config";
import { formatCompactKES, formatDateTime, formatKES, formatPhone } from "@/lib/format";
import { lastMonthRange, pctChange, thisMonthRange } from "@/lib/stats";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { FilterBar } from "@/components/layout/filter-bar";
import { EmptyState } from "@/components/layout/empty-state";
import { SearchInput } from "@/components/layout/search-input";
import { Card, CardToolbar } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { MpesaStatusBadge } from "@/components/shared/status";
import { StkPushDialog } from "@/components/mpesa/stk-push-dialog";
import { SimulateButton } from "@/components/mpesa/simulate-button";
import { MpesaStateBanner, MpesaStateBadge } from "@/components/mpesa/mpesa-state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "M-Pesa" };

type SearchParams = Promise<{ q?: string; direction?: string; status?: string }>;

export default async function MpesaPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAppContext();
  const { q, direction, status } = await searchParams;

  // Masked config only — Daraja secrets never reach this render tree.
  const mpesaConfig = await getSafeMpesaConfig(ctx.orgId);

  const where: Record<string, unknown> = { organizationId: ctx.orgId };
  if (direction && direction !== "ALL") where.direction = direction;
  if (status && status !== "ALL") where.status = status;
  if (q) {
    where.OR = [
      { phone: { contains: q } },
      { receiptNo: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
    ];
  }

  const [transactions, monthIn, monthOut, pendingCount, lastMonthIn] = await Promise.all([
    prisma.mpesaTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.mpesaTransaction.aggregate({
      where: {
        organizationId: ctx.orgId,
        direction: "INCOMING",
        status: "SUCCESS",
        createdAt: { gte: thisMonthRange().from },
      },
      _sum: { amount: true },
    }),
    prisma.mpesaTransaction.aggregate({
      where: {
        organizationId: ctx.orgId,
        direction: "OUTGOING",
        status: "SUCCESS",
        createdAt: { gte: thisMonthRange().from },
      },
      _sum: { amount: true },
    }),
    prisma.mpesaTransaction.count({
      where: { organizationId: ctx.orgId, status: "PENDING" },
    }),
    prisma.mpesaTransaction.aggregate({
      where: {
        organizationId: ctx.orgId,
        direction: "INCOMING",
        status: "SUCCESS",
        createdAt: { gte: lastMonthRange().from, lte: lastMonthRange().to },
      },
      _sum: { amount: true },
    }),
  ]);

  const inThisMonth = monthIn._sum.amount?.toNumber() ?? 0;
  const outThisMonth = monthOut._sum.amount?.toNumber() ?? 0;
  const inLastMonth = lastMonthIn._sum.amount?.toNumber() ?? 0;
  const hasFilters = Boolean(q || (direction && direction !== "ALL") || (status && status !== "ALL"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="M-Pesa"
        description="Every shilling in and out of your M-Pesa account, reconciled."
        eyebrow={
          <>
            <Smartphone className="h-3 w-3" />
            Payments
          </>
        }
      >
        <MpesaStateBadge config={mpesaConfig} />
        <Link
          href="/settings/mpesa"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings2 className="h-4 w-4" /> Configure
        </Link>
        <StkPushDialog config={mpesaConfig} />
      </PageHeader>

      <MpesaStateBanner config={mpesaConfig} showSettingsLink={!mpesaConfig.configured} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Received"
          value={formatCompactKES(inThisMonth)}
          delta={pctChange(inThisMonth, inLastMonth)}
          sub="vs last month"
          icon={ArrowDownLeft}
          accent="success"
        />
        <StatCard
          label="Sent"
          value={formatCompactKES(outThisMonth)}
          sub="this month"
          icon={ArrowUpRight}
          accent="destructive"
        />
        <StatCard
          label="Net position"
          value={formatCompactKES(inThisMonth - outThisMonth)}
          sub="in minus out"
          icon={Wallet}
          accent="info"
        />
        <StatCard
          label="Awaiting payment"
          value={String(pendingCount)}
          sub={pendingCount === 1 ? "transaction pending" : "transactions pending"}
          icon={Smartphone}
          accent={pendingCount > 0 ? "warning" : "default"}
        />
      </div>

      <FilterBar>
        <SearchInput
          name="q"
          defaultValue={q}
          placeholder="Search phone, receipt or reference…"
          className="sm:col-span-2"
        />
        <Select name="direction" defaultValue={direction ?? "ALL"}>
          <SelectTrigger>
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">In &amp; out</SelectItem>
            <SelectItem value="INCOMING">Received</SelectItem>
            <SelectItem value="OUTGOING">Sent</SelectItem>
          </SelectContent>
        </Select>
        <Select name="status" defaultValue={status ?? "ALL"}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="SUCCESS">Successful</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="TIMEOUT">Timeout</SelectItem>
          </SelectContent>
        </Select>
      </FilterBar>

      {transactions.length === 0 ? (
        <EmptyState
          icon={<Smartphone className="h-5 w-5" />}
          title={hasFilters ? "No matching transactions" : "No M-Pesa transactions yet"}
          description={
            hasFilters
              ? "Try clearing the filters or searching for a different phone number."
              : "Request a payment from a customer and it will appear here."
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden sm:block">
            <CardToolbar>
              <h3 className="text-sm font-semibold tracking-tight">Transactions</h3>
              <span className="text-xs text-muted-foreground">
                Showing {transactions.length}
                {transactions.length === 100 ? " (most recent)" : ""}
              </span>
            </CardToolbar>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Receipt / Reference</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((txn) => {
                  const incoming = txn.direction === "INCOMING";
                  return (
                    <TableRow key={txn.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                              incoming
                                ? "bg-success/10 text-success"
                                : "bg-destructive/10 text-destructive",
                            )}
                          >
                            {incoming ? (
                              <ArrowDownLeft className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <span className="font-medium">{formatPhone(txn.phone)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="muted" size="sm">
                          {txn.transactionType.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-semibold tabular-nums",
                          incoming ? "text-success" : "text-destructive",
                        )}
                      >
                        {incoming ? "+" : "−"}
                        {formatKES(txn.amount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <MpesaStatusBadge status={txn.status} />
                          {txn.status === "PENDING" && (
                            <SimulateButton
                              transactionId={txn.id}
                              isLive={Boolean(txn.checkoutRequestId)}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {txn.receiptNo ?? txn.reference ?? "—"}
                        </span>
                        {txn.status !== "SUCCESS" && txn.resultDesc && (
                          <span
                            className="mt-0.5 block truncate text-xs text-muted-foreground/80"
                            title={txn.resultDesc}
                          >
                            {txn.resultDesc}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                        {formatDateTime(txn.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2.5 sm:hidden">
            {transactions.map((txn) => {
              const incoming = txn.direction === "INCOMING";
              return (
                <Card key={txn.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          incoming
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive",
                        )}
                      >
                        {incoming ? (
                          <ArrowDownLeft className="h-4 w-4" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{formatPhone(txn.phone)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatDateTime(txn.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          "font-semibold tabular-nums",
                          incoming ? "text-success" : "text-destructive",
                        )}
                      >
                        {incoming ? "+" : "−"}
                        {formatKES(txn.amount)}
                      </p>
                      <div className="mt-1 flex justify-end">
                        <MpesaStatusBadge status={txn.status} />
                      </div>
                    </div>
                  </div>

                  {(txn.receiptNo ?? txn.reference) && (
                    <p className="mt-3 font-mono text-xs text-muted-foreground">
                      {txn.receiptNo ?? txn.reference}
                    </p>
                  )}
                  {txn.status !== "SUCCESS" && txn.resultDesc && (
                    <p className="mt-1 text-xs text-muted-foreground/80">{txn.resultDesc}</p>
                  )}
                  {txn.status === "PENDING" && (
                    <div className="mt-3">
                      <SimulateButton
                        transactionId={txn.id}
                        isLive={Boolean(txn.checkoutRequestId)}
                      />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
