import type { Metadata } from "next";
import Link from "next/link";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCompactKES, formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { SearchInput } from "@/components/layout/search-input";
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog";
import { Users } from "lucide-react";

export const metadata: Metadata = { title: "Customers" };

type SearchParams = Promise<{ q?: string }>;

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAppContext();
  const { q } = await searchParams;

  const where: Record<string, unknown> = { organizationId: ctx.orgId };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { location: { contains: q, mode: "insensitive" } },
    ];
  }

  const [customers, saleAgg] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.sale.groupBy({
      by: ["customerId"],
      where: { organizationId: ctx.orgId, status: "COMPLETED", customerId: { not: null } },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  const spendByCustomer = new Map(
    saleAgg.map((s) => [s.customerId!, { spend: s._sum.total?.toNumber() ?? 0, visits: s._count._all }]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description={`${customers.length} customer${customers.length === 1 ? "" : "s"} — know who keeps your business going.`}
      >
        <CustomerFormDialog />
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <form method="GET" className="max-w-md">
            <SearchInput name="q" defaultValue={q} placeholder="Search name, phone, location…" />
          </form>
        </CardContent>
      </Card>

      {customers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="No customers yet"
          description="Add customers to track their purchases and loyalty points."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {customers.map((customer) => {
            const stats = spendByCustomer.get(customer.id);
            return (
              <Link key={customer.id} href={`/customers/${customer.id}`} className="group">
                <Card className="h-full transition-colors group-hover:border-brand-500/40">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-sm font-bold text-brand-400">
                          {customer.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{customer.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {customer.phone ? formatPhone(customer.phone) : customer.location ?? "No phone"}
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary">⭐ {customer.loyaltyPoints}</Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Total spend</p>
                        <p className="font-semibold tabular-nums">
                          {formatCompactKES(stats?.spend ?? 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Visits</p>
                        <p className="font-semibold tabular-nums">{stats?.visits ?? 0}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
