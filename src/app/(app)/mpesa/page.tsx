import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCompactKES, formatDateTime, formatKES, formatPhone } from "@/lib/format";
import { lastMonthRange, pctChange, thisMonthRange } from "@/lib/stats";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
import { MpesaStatusBadge } from "@/components/shared/status";
import { StkPushDialog } from "@/components/mpesa/stk-push-dialog";
import { SimulateButton } from "@/components/mpesa/simulate-button";
import { MpesaStateBanner, MpesaStateBadge } from "@/components/mpesa/mpesa-state";
import { getSafeMpesaConfig } from "@/lib/mpesa/config";
import { ArrowDownLeft, ArrowUpRight, Settings2, Smartphone } from "lucide-react";
import Link from "next/link";
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
  const inDelta = pctChange(inThisMonth, inLastMonth);

  return (
    <div className="space-y-6">
      <PageHeader
        title="M-Pesa"
        description="Every shilling in and out of your M-Pesa account, reconciled."
      >
        <div className="flex items-center gap-2">
          <MpesaStateBadge config={mpesaConfig} />
          <Link
            href="/settings/mpesa"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" /> Configure
          </Link>
          <StkPushDialog config={mpesaConfig} />
        </div>
      </PageHeader>

      <MpesaStateBanner config={mpesaConfig} showSettingsLink={!mpesaConfig.configured} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Received (month)</p>
              <ArrowDownLeft className="h-4 w-4 text-success" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-success">
              {formatCompactKES(inThisMonth)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {inDelta !== null ? (
                <span className={cn("font-medium", inDelta >= 0 ? "text-success" : "text-destructive")}>
                  {inDelta >= 0 ? "+" : ""}
                  {inDelta.toFixed(0)}%
                </span>
              ) : (
                "new"
              )}{" "}
              vs last month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Sent (month)</p>
              <ArrowUpRight className="h-4 w-4 text-destructive" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-destructive">
              {formatCompactKES(outThisMonth)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Net position</p>
              <Smartphone className="h-4 w-4 text-brand-400" />
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">
              {formatCompactKES(inThisMonth - outThisMonth)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Awaiting payment</p>
              <Badge variant="warning">{pendingCount}</Badge>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">{pendingCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="GET">
            <SearchInput
              name="q"
              defaultValue={q}
              placeholder="Search phone, receipt…"
              className="sm:col-span-2"
            />
            <Select name="direction" defaultValue={direction ?? "ALL"}>
              <SelectTrigger>
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">In & out</SelectItem>
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
              </SelectContent>
            </Select>
            <div className="lg:col-span-4">
              <button
                type="submit"
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-accent"
              >
                Apply filters
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {transactions.length === 0 ? (
        <EmptyState
          icon={<Smartphone className="h-5 w-5" />}
          title="No M-Pesa transactions"
          description="Request a payment from a customer to see it appear here."
        />
      ) : (
        <Card className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Phone</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Receipt / Ref</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((txn) => (
                <TableRow key={txn.id}>
                  <TableCell className="font-medium">{formatPhone(txn.phone)}</TableCell>
                  <TableCell className="text-muted-foreground">{txn.transactionType}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        txn.direction === "INCOMING"
                          ? "text-success"
                          : "text-destructive",
                      )}
                    >
                      {txn.direction === "INCOMING" ? "In" : "Out"}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "font-semibold tabular-nums",
                      txn.direction === "INCOMING" ? "text-success" : "text-destructive",
                    )}
                  >
                    {txn.direction === "INCOMING" ? "+" : "−"}
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
                  <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                    <span className="font-mono">
                      {txn.receiptNo ?? txn.reference ?? "—"}
                    </span>
                    {txn.status !== "SUCCESS" && txn.resultDesc && (
                      <span className="mt-0.5 block truncate" title={txn.resultDesc}>
                        {txn.resultDesc}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDateTime(txn.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Mobile cards */}
      {transactions.length > 0 && (
        <div className="space-y-3 sm:hidden">
          {transactions.map((txn) => (
            <Card key={txn.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{formatPhone(txn.phone)}</p>
                    <p className="text-xs text-muted-foreground">
                      {txn.transactionType} · {formatDateTime(txn.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        "font-bold tabular-nums",
                        txn.direction === "INCOMING" ? "text-success" : "text-destructive",
                      )}
                    >
                      {txn.direction === "INCOMING" ? "+" : "−"}
                      {formatKES(txn.amount)}
                    </p>
                    <MpesaStatusBadge status={txn.status} />
                  </div>
                </div>
                {(txn.receiptNo ?? txn.reference) && (
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    {txn.receiptNo ?? txn.reference}
                  </p>
                )}
                {txn.status !== "SUCCESS" && txn.resultDesc && (
                  <p className="mt-1 text-xs text-muted-foreground">{txn.resultDesc}</p>
                )}
                {txn.status === "PENDING" && (
                  <div className="mt-2">
                    <SimulateButton
                      transactionId={txn.id}
                      isLive={Boolean(txn.checkoutRequestId)}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
