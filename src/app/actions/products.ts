"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { productSchema, stockAdjustSchema } from "@/lib/validations";

export type ActionResult = { error?: string; success?: string };

export async function createProductAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { name, sku, category, unit, costPrice, sellingPrice, stock, lowStockThreshold } = parsed.data;

  await prisma.product.create({
    data: {
      organizationId: ctx.orgId,
      name,
      sku: sku || null,
      category,
      unit,
      costPrice: new Prisma.Decimal(costPrice),
      sellingPrice: new Prisma.Decimal(sellingPrice),
      stock,
      lowStockThreshold,
    },
  });

  revalidatePath("/inventory");
  return { success: `${name} added to inventory.` };
}

export async function updateProductAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const id = String((input as { id?: string }).id ?? "");
  if (!id) return { error: "Missing product id." };

  const { name, sku, category, unit, costPrice, sellingPrice, stock, lowStockThreshold } = parsed.data;

  const existing = await prisma.product.findFirst({
    where: { id, organizationId: ctx.orgId },
  });
  if (!existing) return { error: "Product not found." };

  await prisma.product.update({
    where: { id },
    data: {
      name,
      sku: sku || null,
      category,
      unit,
      costPrice: new Prisma.Decimal(costPrice),
      sellingPrice: new Prisma.Decimal(sellingPrice),
      stock,
      lowStockThreshold,
    },
  });

  revalidatePath("/inventory");
  return { success: `${name} updated.` };
}

export async function toggleProductActiveAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const id = String((input as { id?: string }).id ?? "");
  const product = await prisma.product.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!product) return { error: "Product not found." };

  await prisma.product.update({
    where: { id },
    data: { active: !product.active },
  });
  revalidatePath("/inventory");
  return { success: product.active ? `${product.name} archived.` : `${product.name} re-activated.` };
}

export async function deleteProductAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const id = String((input as { id?: string }).id ?? "");
  const product = await prisma.product.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!product) return { error: "Product not found." };

  await prisma.product.delete({ where: { id } });
  revalidatePath("/inventory");
  return { success: `${product.name} deleted.` };
}

export async function adjustStockAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const parsed = stockAdjustSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { productId, quantity } = parsed.data;
  const product = await prisma.product.findFirst({
    where: { id: productId, organizationId: ctx.orgId },
  });
  if (!product) return { error: "Product not found." };
  if (product.stock + quantity < 0) return { error: "Cannot adjust stock below zero." };

  await prisma.product.update({
    where: { id: productId },
    data: { stock: { increment: quantity } },
  });

  revalidatePath("/inventory");
  return {
    success:
      quantity >= 0
        ? `Added ${quantity} to ${product.name}.`
        : `Removed ${Math.abs(quantity)} from ${product.name}.`,
  };
}
