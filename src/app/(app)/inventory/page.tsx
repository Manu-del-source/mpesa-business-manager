import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCompactKES, formatKES } from "@/lib/format";
import { getLowStockCount, getStockValue } from "@/lib/stats";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { ProductFormDialog } from "@/components/inventory/product-form-dialog";
import { StockAdjustButton } from "@/components/inventory/stock-adjust";
import { ArchiveToggleButton } from "@/components/inventory/archive-toggle";
import { Package, PackageX } from "lucide-react";

export const metadata: Metadata = { title: "Inventory" };

type SearchParams = Promise<{ q?: string; category?: string; show?: string }>;

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireAppContext();
  const { q, category, show } = await searchParams;
  const showArchived = show === "archived";

  const where: Record<string, unknown> = {
    organizationId: ctx.orgId,
    active: showArchived ? false : true,
  };
  if (category && category !== "ALL") where.category = category;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
    ];
  }

  const [products, categories, lowStockCount, stockValue] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.product.groupBy({
      by: ["category"],
      where: { organizationId: ctx.orgId },
      _count: { _all: true },
    }),
    getLowStockCount(ctx.orgId),
    getStockValue(ctx.orgId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description={`${products.length} product${products.length === 1 ? "" : "s"} in view.`}
      >
        <ProductFormDialog />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Active products</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{products.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Stock value (at cost)</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">
              {formatCompactKES(stockValue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Low stock items</p>
            <p className={`mt-2 text-2xl font-bold tracking-tight ${lowStockCount > 0 ? "text-warning" : ""}`}>
              {lowStockCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Categories</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{categories.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="GET">
            <SearchInput
              name="q"
              defaultValue={q}
              placeholder="Search product, SKU…"
              className="sm:col-span-2"
            />
            <Select name="category" defaultValue={category ?? "ALL"}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.category} value={c.category}>
                    {c.category} ({c._count._all})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select name="show" defaultValue={showArchived ? "archived" : "active"}>
              <SelectTrigger>
                <SelectValue placeholder="Show" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="outline" size="sm" className="self-end">
              Apply filters
            </Button>
          </form>
        </CardContent>
      </Card>

      {products.length === 0 ? (
        <EmptyState
          icon={<PackageX className="h-5 w-5" />}
          title="No products here"
          description="Add your first product to start tracking stock and prices."
          action={
            <ProductFormDialog>
              <Button>
                <Package className="h-4 w-4" /> Add product
              </Button>
            </ProductFormDialog>
          }
        />
      ) : (
        <Card className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Selling</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => {
                const cost = product.costPrice.toNumber();
                const price = product.sellingPrice.toNumber();
                const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
                const low = product.stock <= product.lowStockThreshold;
                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <p className="font-medium">{product.name}</p>
                      {product.sku && (
                        <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{product.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatKES(product.costPrice)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatKES(product.sellingPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={margin >= 30 ? "success" : "warning"}>
                        {margin.toFixed(0)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={product.stock === 0 ? "destructive" : low ? "warning" : "muted"}>
                        {product.stock} {product.unit}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <StockAdjustButton product={product} />
                        <ProductFormDialog product={product} variant="edit" />
                        <ArchiveToggleButton product={product} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {products.length > 0 && (
        <div className="space-y-3 sm:hidden">
          {products.map((product) => {
            const cost = product.costPrice.toNumber();
            const price = product.sellingPrice.toNumber();
            const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
            const low = product.stock <= product.lowStockThreshold;
            return (
              <Card key={product.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{product.category}</p>
                    </div>
                    <Badge variant={product.stock === 0 ? "destructive" : low ? "warning" : "muted"}>
                      {product.stock} {product.unit}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-muted/50 p-2">
                      <p className="text-[10px] text-muted-foreground">Cost</p>
                      <p className="text-xs font-semibold tabular-nums">{formatKES(product.costPrice)}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2">
                      <p className="text-[10px] text-muted-foreground">Selling</p>
                      <p className="text-xs font-semibold tabular-nums">{formatKES(product.sellingPrice)}</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2">
                      <p className="text-[10px] text-muted-foreground">Margin</p>
                      <p className={`text-xs font-semibold ${margin >= 30 ? "text-success" : "text-warning"}`}>
                        {margin.toFixed(0)}%
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-1">
                    <StockAdjustButton product={product} />
                    <ProductFormDialog product={product} variant="edit" />
                    <ArchiveToggleButton product={product} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
