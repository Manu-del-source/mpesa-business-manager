"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  completeStkPush,
  failStkPush,
  getTransactionStatus,
  initiateStkPush,
} from "@/lib/mpesa";
import { statusForResultCode } from "@/lib/mpesa/callback";
import { resolveLiveConfig, queryStkStatus } from "@/lib/mpesa/daraja";
import { toDarajaError } from "@/lib/mpesa/errors";
import { logMpesa, logMpesaError } from "@/lib/mpesa/log";
import { stkPushSchema } from "@/lib/validations";

export type ActionResult = { error?: string; success?: string };

export type StkPushActionResult = ActionResult & {
  code?: string;
  data?: {
    transactionId: string;
    mode: "demo" | "daraja";
    checkoutRequestId: string | null;
    message: string;
  };
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

  revalidatePath("/mpesa");

  if (!result.ok) return { error: result.error, code: result.code };

  return {
    success:
      result.mode === "daraja"
        ? "STK push sent. Ask the customer to enter their M-Pesa PIN."
        : "Demo STK push created.",
    data: {
      transactionId: result.transactionId,
      mode: result.mode,
      checkoutRequestId: result.checkoutRequestId,
      message: result.message,
    },
  };
}

export type TransactionStatusResult = ActionResult & {
  data?: {
    id: string;
    status: string;
    receiptNo: string | null;
    resultCode: number | null;
    resultDesc: string | null;
    amount: string;
    phone: string;
    completedAt: string | null;
    isLive: boolean;
  };
};

/**
 * Poll a transaction's current status.
 *
 * For live transactions this reflects whatever the Daraja callback has written.
 * The UI polls this while an STK prompt is on the customer's phone.
 */
export async function getTransactionStatusAction(
  input: unknown,
): Promise<TransactionStatusResult> {
  const ctx = await requireAppContext();
  const transactionId = String((input as { transactionId?: string }).transactionId ?? "");
  if (!transactionId) return { error: "Missing transaction id." };

  const data = await getTransactionStatus(transactionId, ctx.orgId);
  if (!data) return { error: "Transaction not found." };
  return { data };
}

/**
 * Reconcile a still-PENDING live transaction by asking Daraja directly
 * (STK Push Query). Useful when the callback could not reach this deployment.
 */
export async function reconcileTransactionAction(
  input: unknown,
): Promise<TransactionStatusResult> {
  const ctx = await requireAppContext();
  const transactionId = String((input as { transactionId?: string }).transactionId ?? "");
  if (!transactionId) return { error: "Missing transaction id." };

  const txn = await prisma.mpesaTransaction.findFirst({
    where: { id: transactionId, organizationId: ctx.orgId },
  });
  if (!txn) return { error: "Transaction not found." };

  if (txn.status !== "PENDING" || !txn.checkoutRequestId) {
    const data = await getTransactionStatus(transactionId, ctx.orgId);
    return data ? { data } : { error: "Transaction not found." };
  }

  const config = await resolveLiveConfig(ctx.orgId);
  if (!config) return { error: "M-Pesa is not configured for live queries." };

  try {
    const queried = await queryStkStatus(config, txn.checkoutRequestId);
    if (queried.pending || queried.resultCode === null) {
      const data = await getTransactionStatus(transactionId, ctx.orgId);
      return { success: "Still waiting for the customer.", data: data ?? undefined };
    }

    // Same idempotency guard as the callback path.
    await prisma.mpesaTransaction.updateMany({
      where: { id: txn.id, status: "PENDING" },
      data: {
        status: statusForResultCode(queried.resultCode),
        resultCode: queried.resultCode,
        resultDesc: queried.resultDesc?.slice(0, 500) ?? null,
        completedAt: new Date(),
      },
    });

    logMpesa("stk_query.reconciled", {
      transactionId: txn.id,
      resultCode: queried.resultCode,
    });

    revalidatePath("/mpesa");
    const data = await getTransactionStatus(transactionId, ctx.orgId);
    return { success: "Status refreshed from Safaricom.", data: data ?? undefined };
  } catch (err) {
    const error = toDarajaError(err);
    logMpesaError("stk_query.failed", { transactionId: txn.id, code: error.code });
    return { error: error.userMessage };
  }
}

/**
 * Simulate the Safaricom callback for a pending transaction.
 *
 * DEMO ONLY — `completeStkPush` refuses to touch a transaction that has a real
 * Daraja checkoutRequestId, so live payments can never be faked from the UI.
 */
export async function simulateCallbackAction(input: unknown) {
  const ctx = await requireAppContext();
  const transactionId = String((input as { transactionId?: string }).transactionId ?? "");
  if (!transactionId) return { error: "Missing transaction id." };

  const txn = await completeStkPush(transactionId, ctx.orgId);
  if (!txn) {
    return {
      error:
        "This is a live Safaricom transaction — it can only be completed by the M-Pesa callback.",
    };
  }
  if (txn.status !== "SUCCESS") return { error: "Transaction could not be completed." };

  revalidatePath("/mpesa");
  revalidatePath("/sales");
  revalidatePath("/dashboard");
  return { success: `Payment received — receipt ${txn.receiptNo}.` };
}

export async function failTransactionAction(input: unknown) {
  const ctx = await requireAppContext();
  const transactionId = String((input as { transactionId?: string }).transactionId ?? "");
  const status =
    (input as { status?: "FAILED" | "CANCELLED" | "TIMEOUT" }).status ?? "FAILED";
  if (!transactionId) return { error: "Missing transaction id." };

  const txn = await failStkPush(transactionId, ctx.orgId, status);
  if (!txn) return { error: "Transaction not found." };

  revalidatePath("/mpesa");
  return {
    success:
      status === "CANCELLED"
        ? "Transaction cancelled."
        : status === "TIMEOUT"
          ? "Transaction timed out."
          : "Transaction marked failed.",
  };
}
