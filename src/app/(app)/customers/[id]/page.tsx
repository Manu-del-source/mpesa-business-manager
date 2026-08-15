import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MapPin, Phone } from "lucide-react";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCompactKES, formatDateTime, formatKES, formatPhone } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { PaymentMethodBadge, SaleStatusBadge } from "@/components/shared/status";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAppContext();
  const { id } = await params;

  const customer = await prisma.customer.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      sales: {
        where: { status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { items: true },
      },
    },
  });

  if (!customer) notFound();

  const totalSpend = customer.sales.reduce((sum, s) => sum + s.total.toNumber(), 0);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/customers">
          <ArrowLeft className="h-4 w-4" /> Back to customers
        </Link>
      </Button>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/15 text-xl font-bold text-brand-400">
              {customer.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h1 className="text-xl font-semibold">{customer.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {customer.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" /> {formatPhone(customer.phone)}
                  </span>
                )}
                {customer.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> {customer.email}
                  </span>
                )}
                {customer.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {customer.location}
                  </span>
                )}
              </div>
            </div>
          </div>
          <CustomerFormDialog customer={customer} variant="edit" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Total spend</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{formatCompactKES(totalSpend)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Purchases</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{customer.sales.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Loyalty points</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-warning">
              ⭐ {customer.loyaltyPoints}
            </p>
          </CardContent>
        </Card>
      </div>

      {customer.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{customer.notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purchase history</CardTitle>
        </CardHeader>
        <CardContent>
          {customer.sales.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No completed purchases yet.
            </p>
          ) : (
            <div className="space-y-2">
              {customer.sales.map((sale) => (
                <div
                  key={sale.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2.5"
                >
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">{sale.receiptNo}</p>
                    <p className="text-sm text-muted-foreground">
                      {sale.items.reduce((n, i) => n + i.quantity, 0)} item
                      {sale.items.reduce((n, i) => n + i.quantity, 0) === 1 ? "" : "s"} ·{" "}
                      {formatDateTime(sale.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PaymentMethodBadge method={sale.paymentMethod} />
                    <SaleStatusBadge status={sale.status} />
                    <span className="w-24 text-right font-semibold tabular-nums">
                      {formatKES(sale.total)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
