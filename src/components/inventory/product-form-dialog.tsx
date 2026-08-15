"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Pencil, Plus } from "lucide-react";
import { productSchema } from "@/lib/validations";
import {
  createProductAction,
  deleteProductAction,
  updateProductAction,
} from "@/app/actions/products";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type ProductValues = z.infer<typeof productSchema>;

export function ProductFormDialog({
  product,
  variant = "create",
  children,
}: {
  product?: {
    id: string;
    name: string;
    sku: string | null;
    category: string;
    unit: string;
    costPrice: number;
    sellingPrice: number;
    stock: number;
    lowStockThreshold: number;
  };
  variant?: "create" | "edit";
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const isEdit = variant === "edit";

  const form = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name ?? "",
      sku: product?.sku ?? "",
      category: product?.category ?? "General",
      unit: product?.unit ?? "pcs",
      costPrice: product ? product.costPrice : undefined,
      sellingPrice: product ? product.sellingPrice : undefined,
      stock: product?.stock ?? 0,
      lowStockThreshold: product?.lowStockThreshold ?? 5,
    },
  });

  async function onSubmit(values: ProductValues) {
    setPending(true);
    try {
      const result = isEdit
        ? await updateProductAction({ ...values, id: product!.id })
        : await createProductAction(values);
      if (result?.error) toast.error(result.error);
      else {
        toast.success(result.success ?? "Product saved.");
        setOpen(false);
      }
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!product) return;
    const result = await deleteProductAction({ id: product.id });
    if (result?.error) toast.error(result.error);
    else {
      toast.success(result.success ?? "Product deleted.");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ??
          (isEdit ? (
            <Button variant="ghost" size="iconSm" aria-label="Edit product">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button>
              <Plus className="h-4 w-4" /> Add product
            </Button>
          ))}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${product?.name}` : "Add a product"}</DialogTitle>
          <DialogDescription>
            Track cost, selling price and stock so sales and margins stay accurate.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Product name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Unga 2kg" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Staple foods" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit</FormLabel>
                    <FormControl>
                      <Input placeholder="pcs, kg, ltr, crt…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="costPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost price (KSh)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step="0.01" placeholder="120" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="sellingPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Selling price (KSh)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step="0.01" placeholder="150" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="stock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Opening stock</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} placeholder="50" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lowStockThreshold"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Low-stock alert at</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} placeholder="5" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              {isEdit ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {product?.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Past sales keep their records, but this product will be removed
                        from inventory. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep product</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => void remove()}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isEdit ? "Save changes" : "Add product"}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
