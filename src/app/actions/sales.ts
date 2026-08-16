"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cancelSale, completeMpesaSale, createSale } from "@/lib/sales";
import { saleSchema } from "@/lib/validations";

export type ActionResult = { error?: string; success?: string };

export type CreateSaleActionResult = ActionResult & {
  data?: {
    saleId: string;
    receiptNo: string;
    total: string;
    paymentMethod: string;
    status: string;
    transactionId: string | null;
    mpesaError: string | null;
    /** "daraja" when a real STK push is in flight, "demo" when simulated. */
    mpesaMode: "demo" | "daraja" | null;
  };
};

export async function createSaleAction(input: unknown): Promise<CreateSaleActionResult> {
  const ctx = await requireAppContext();
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const result = await createSale(ctx.orgId, parsed.data);
    revalidatePath("/sales");
    revalidatePath("/dashboard");
    revalidatePath("/inventory");
    return {
      success: "Sale recorded.",
      data: {
        saleId: result.sale.id,
        receiptNo: result.sale.receiptNo,
        total: result.sale.total.toString(),
        paymentMethod: result.sale.paymentMethod,
        status: result.sale.status,
        transactionId: result.transactionId,
        mpesaError: result.mpesaError,
        mpesaMode: result.mpesaMode,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record the sale." };
  }
}

/** Complete a PENDING M-Pesa sale (simulates the Safaricom callback). */
export async function completeMpesaSaleAction(input: unknown) {
  const ctx = await requireAppContext();
  const saleId = String((input as { saleId?: string }).saleId ?? "");
  if (!saleId) return { error: "Missing sale id." };

  const completed = await completeMpesaSale(ctx.orgId, saleId);
  if (!completed) return { error: "Sale is not pending M-Pesa payment." };

  revalidatePath("/sales");
  revalidatePath("/dashboard");
  revalidatePath("/mpesa");
  revalidatePath("/inventory");
  return { success: `Payment received for ${completed.receiptNo}.` };
}

/** Cancel a PENDING sale. */
export async function cancelSaleAction(input: unknown) {
  const ctx = await requireAppContext();
  const saleId = String((input as { saleId?: string }).saleId ?? "");
  if (!saleId) return { error: "Missing sale id." };

  const cancelled = await cancelSale(ctx.orgId, saleId);
  if (!cancelled) return { error: "Sale is not pending." };

  revalidatePath("/sales");
  revalidatePath("/mpesa");
  return { success: `Sale ${cancelled.receiptNo} cancelled.` };
}

/** Look up a single sale with items (used by the POS completion sheet). */
export async function getSaleForCompletionAction(input: unknown) {
  const ctx = await requireAppContext();
  const saleId = String((input as { saleId?: string }).saleId ?? "");
  if (!saleId) return { error: "Missing sale id." };

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, organizationId: ctx.orgId },
    include: { items: true, customer: true },
  });
  if (!sale) return { error: "Sale not found." };

  return {
    data: {
      id: sale.id,
      receiptNo: sale.receiptNo,
      status: sale.status,
      total: sale.total.toString(),
      customerName: sale.customer?.name ?? "Walk-in customer",
    },
  };
}
