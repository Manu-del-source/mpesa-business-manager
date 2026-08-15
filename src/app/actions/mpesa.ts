"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth";
import { completeStkPush, failStkPush, initiateStkPush } from "@/lib/mpesa";
import { stkPushSchema } from "@/lib/validations";

export type ActionResult = { error?: string; success?: string };

export type StkPushActionResult = ActionResult & {
  data?: { transactionId: string; mode: string };
};

export async function initiateStkPushAction(input: unknown): Promise<StkPushActionResult> {
  const ctx = await requireAppContext();
  const parsed = stkPushSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const result = await initiateStkPush({
    orgId: ctx.orgId,
    phone: parsed.data.phone,
    amount: parsed.data.amount,
    reference: parsed.data.reference,
    description: parsed.data.description,
  });

  if (!result.ok) return { error: result.error };

  revalidatePath("/mpesa");
  return {
    success: "STK push sent. Check the customer's phone and enter the PIN.",
    data: { transactionId: result.transactionId, mode: result.mode },
  };
}

/** Simulate the Safaricom callback for a pending transaction (mock mode). */
export async function simulateCallbackAction(input: unknown) {
  const ctx = await requireAppContext();
  const transactionId = String((input as { transactionId?: string }).transactionId ?? "");
  if (!transactionId) return { error: "Missing transaction id." };

  const txn = await completeStkPush(transactionId, ctx.orgId);
  if (!txn) return { error: "Transaction not found." };
  if (txn.status !== "SUCCESS") return { error: "Transaction could not be completed." };

  revalidatePath("/mpesa");
  revalidatePath("/sales");
  revalidatePath("/dashboard");
  return { success: `Payment received — receipt ${txn.receiptNo}.` };
}

export async function failTransactionAction(input: unknown) {
  const ctx = await requireAppContext();
  const transactionId = String((input as { transactionId?: string }).transactionId ?? "");
  const status = (input as { status?: "FAILED" | "CANCELLED" }).status ?? "FAILED";
  if (!transactionId) return { error: "Missing transaction id." };

  const txn = await failStkPush(transactionId, ctx.orgId, status);
  if (!txn) return { error: "Transaction not found." };

  revalidatePath("/mpesa");
  return { success: status === "CANCELLED" ? "Transaction cancelled." : "Transaction marked failed." };
}
