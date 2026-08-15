import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { completeStkPush, initiateStkPush } from "@/lib/mpesa";

export type CreateSaleInput = {
  customerId?: string | null;
  paymentMethod: "MPESA" | "CASH" | "CARD" | "BANK_TRANSFER" | "CREDIT";
  discount: number;
  notes?: string | null;
  items: { productId: string; quantity: number }[];
  /** Required when paymentMethod === "MPESA" (the number to STK push to). */
  mpesaPhone?: string;
};

function toCents(n: number): number {
  return Math.round(n * 100);
}

function money(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n.toFixed(2));
}

/** RCP-20260814-K3Q7 */
export function generateReceiptNo(prefix = "RCP"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${date}-${suffix}`;
}

/**
 * Create a sale.
 *
 * - Non-M-Pesa payments are completed immediately (stock decremented).
 * - M-Pesa sales start as PENDING with an STK push to the customer's phone.
 *   Stock is decremented when the payment completes (see completeMpesaSale).
 */
export async function createSale(orgId: string, input: CreateSaleInput) {
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, organizationId: orgId },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines = input.items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) throw new Error("One or more products no longer exist.");
    if (!product.active) throw new Error(`${product.name} is no longer active.`);
    if (product.stock < item.quantity) {
      throw new Error(`Not enough stock for ${product.name} — ${product.stock} left.`);
    }
    const unitPrice = product.sellingPrice.toNumber();
    const lineTotal = (toCents(unitPrice) * item.quantity) / 100;
    return {
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPrice: money(unitPrice),
      lineTotal: money(lineTotal),
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + toCents(l.lineTotal.toNumber()), 0) / 100;
  const discount = Math.min(Math.max(input.discount, 0), subtotal);
  const total = subtotal - discount;
  const receiptNo = generateReceiptNo();

  const saleData = {
    organizationId: orgId,
    customerId: input.customerId || null,
    receiptNo,
    paymentMethod: input.paymentMethod,
    subtotal: money(subtotal),
    discount: money(discount),
    total: money(total),
    notes: input.notes || null,
  };

  if (input.paymentMethod === "MPESA") {
    const sale = await prisma.sale.create({
      data: {
        ...saleData,
        status: "PENDING",
        items: { create: lines },
      },
      include: { customer: true },
    });

    let pushPhone = input.mpesaPhone ?? "";
    if (!pushPhone && input.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: input.customerId },
        select: { phone: true },
      });
      pushPhone = customer?.phone ?? "";
    }

    const push = await initiateStkPush({
      orgId,
      phone: pushPhone,
      amount: total,
      reference: receiptNo,
      description: `Sale ${receiptNo}`,
    });

    if (!push.ok) {
      // Payment could not be initiated — leave sale pending so the user can
      // retry, but surface the error immediately.
      return { sale, mpesaError: push.error, transactionId: null };
    }

    return { sale, mpesaError: null, transactionId: push.transactionId };
  }

  const sale = await prisma.$transaction(async (tx) => {
    const created = await tx.sale.create({
      data: {
        ...saleData,
        status: "COMPLETED",
        items: { create: lines },
      },
      include: { customer: true },
    });
    for (const line of lines) {
      await tx.product.update({
        where: { id: line.productId },
        data: { stock: { decrement: line.quantity } },
      });
    }
    return created;
  });

  return { sale, mpesaError: null, transactionId: null };
}

/**
 * Complete a PENDING M-Pesa sale once payment succeeds (mock callback path).
 * Marks the M-Pesa transaction SUCCESS and decrements stock atomically.
 */
export async function completeMpesaSale(orgId: string, saleId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, organizationId: orgId, status: "PENDING", paymentMethod: "MPESA" },
    include: { items: true },
  });
  if (!sale) return null;

  const txn = await prisma.mpesaTransaction.findFirst({
    where: { organizationId: orgId, reference: sale.receiptNo, status: "PENDING" },
  });
  if (!txn) return null;

  const completed = await prisma.$transaction(async (tx) => {
    const done = await completeStkPush(txn.id, orgId);
    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: "COMPLETED",
        mpesaReference: done?.receiptNo ?? null,
      },
    });
    for (const item of sale.items) {
      await tx.product.update({
        where: { id: item.productId! },
        data: { stock: { decrement: item.quantity } },
      });
    }
    return updatedSale;
  });

  return completed;
}

/** Cancel a PENDING sale (e.g. M-Pesa payment failed or abandoned). */
export async function cancelSale(orgId: string, saleId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, organizationId: orgId, status: "PENDING" },
  });
  if (!sale) return null;

  await prisma.mpesaTransaction.updateMany({
    where: { organizationId: orgId, reference: sale.receiptNo, status: "PENDING" },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return prisma.sale.update({
    where: { id: sale.id },
    data: { status: "CANCELLED" },
  });
}
