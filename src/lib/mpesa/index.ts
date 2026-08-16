import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/env";
import { isLive, resolveMpesaConfig } from "@/lib/mpesa/config";
import { sendDarajaStkPush } from "@/lib/mpesa/daraja";
import { DarajaError, toDarajaError, userMessageFor } from "@/lib/mpesa/errors";
import { checkStkPushRateLimit } from "@/lib/mpesa/rate-limit";
import { logMpesa } from "@/lib/mpesa/log";

export const MPESA_MAX_AMOUNT = 150_000;

/** Normalize a Kenyan phone number to international format (2547XXXXXXXX). */
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

export function isValidMpesaPhone(phone: string): boolean {
  return normalizePhone(phone) !== null;
}

/** Generate a Safaricom-style receipt number, e.g. SFT4X1Q2WK3. */
export function generateReceiptNo(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 7; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `SFT${out}`;
}

export type StkPushMode = "demo" | "daraja";

export type StkPushResult =
  | {
      ok: true;
      transactionId: string;
      mode: StkPushMode;
      checkoutRequestId: string | null;
      message: string;
    }
  | { ok: false; error: string; code?: string; transactionId?: string };

/**
 * Initiate an M-Pesa STK push to a customer's phone.
 *
 * Flow (both modes):
 *   1. Validate input.
 *   2. Create the MpesaTransaction as PENDING **before** contacting Safaricom,
 *      so a crash or a callback that beats the HTTP response still has a row
 *      to attach to.
 *   3. Live mode: call Daraja and store merchant/checkout request ids. The
 *      transaction stays PENDING — only the callback can mark it SUCCESS.
 *      Demo mode: leave it PENDING for the simulated callback in the UI.
 */
export async function initiateStkPush(input: {
  orgId: string;
  phone: string;
  amount: number;
  reference?: string | null;
  description?: string | null;
  direction?: "INCOMING" | "OUTGOING";
}): Promise<StkPushResult> {
  const normalized = normalizePhone(input.phone);
  if (!normalized) {
    return { ok: false, error: "Enter a valid Safaricom number, e.g. 0712 345 678.", code: "INVALID_PHONE" };
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > MPESA_MAX_AMOUNT) {
    return {
      ok: false,
      error: `Amount must be between KSh 1 and KSh ${MPESA_MAX_AMOUNT.toLocaleString()}.`,
      code: "INVALID_AMOUNT",
    };
  }

  const config = await resolveMpesaConfig(input.orgId);
  const demo = isDemoMode() || !isLive(config);

  // In non-demo deployments an explicit misconfiguration should be actionable
  // rather than silently simulated.
  if (!demo && !config) {
    return { ok: false, error: userMessageFor("NOT_CONFIGURED"), code: "NOT_CONFIGURED" };
  }
  if (!isDemoMode() && config && !config.enabled) {
    return { ok: false, error: userMessageFor("DISABLED"), code: "DISABLED" };
  }

  // 1 + 2. Always record the intent first.
  const txn = await prisma.mpesaTransaction.create({
    data: {
      organizationId: input.orgId,
      direction: input.direction ?? "INCOMING",
      phone: normalized,
      amount: new Prisma.Decimal(amount.toFixed(2)),
      status: "PENDING",
      reference: input.reference ?? null,
      description: input.description ?? null,
      transactionType: "STK_PUSH",
    },
  });

  // Demo/simulated mode — no Safaricom traffic.
  if (demo || !isLive(config)) {
    return {
      ok: true,
      transactionId: txn.id,
      mode: "demo",
      checkoutRequestId: null,
      message: "Demo STK push sent. Use “Simulate payment” to complete it.",
    };
  }

  // 3. Live Daraja request.
  // Rate limit only real traffic: demo mode must stay freely clickable.
  const limit = checkStkPushRateLimit(input.orgId, normalized);
  if (!limit.allowed) {
    await prisma.mpesaTransaction.update({
      where: { id: txn.id },
      data: {
        status: "FAILED",
        resultDesc: limit.message,
        completedAt: new Date(),
      },
    });
    logMpesa("stk_push.rate_limited", {
      orgId: input.orgId,
      transactionId: txn.id,
      reason: limit.reason,
    });
    return { ok: false, error: limit.message, code: "RATE_LIMITED", transactionId: txn.id };
  }

  try {
    const result = await sendDarajaStkPush(config, {
      orgId: input.orgId,
      phone: normalized,
      amount,
      reference: input.reference ?? undefined,
      description: input.description ?? undefined,
      transactionId: txn.id,
    });

    logMpesa("stk_push.accepted", {
      orgId: input.orgId,
      transactionId: txn.id,
      checkoutRequestId: result.checkoutRequestId,
      environment: config.environment,
    });

    return {
      ok: true,
      transactionId: txn.id,
      mode: "daraja",
      checkoutRequestId: result.checkoutRequestId,
      message: result.customerMessage,
    };
  } catch (err) {
    const error: DarajaError = toDarajaError(err);

    // Safaricom never accepted the request — close the row out as FAILED so it
    // does not linger as a false "awaiting payment".
    await prisma.mpesaTransaction.update({
      where: { id: txn.id },
      data: {
        status: "FAILED",
        resultDesc: error.userMessage,
        completedAt: new Date(),
      },
    });

    logMpesa("stk_push.failed", {
      orgId: input.orgId,
      transactionId: txn.id,
      code: error.code,
      detail: error.detail,
    });

    return { ok: false, error: error.userMessage, code: error.code, transactionId: txn.id };
  }
}

/**
 * Complete a pending STK push as successful.
 *
 * DEMO/simulation only — in live mode a transaction may only reach SUCCESS
 * through the Daraja callback (see `applyStkCallback`). Guarded so a live
 * transaction (one that has a real checkoutRequestId) can never be forced to
 * SUCCESS from the UI.
 */
export async function completeStkPush(transactionId: string, orgId: string) {
  const existing = await prisma.mpesaTransaction.findFirst({
    where: { id: transactionId, organizationId: orgId },
  });
  if (!existing) return null;
  if (existing.status !== "PENDING") return existing;

  if (existing.checkoutRequestId) {
    // A real Daraja request is in flight; only Safaricom decides its outcome.
    return null;
  }

  return prisma.mpesaTransaction.update({
    where: { id: transactionId },
    data: {
      status: "SUCCESS",
      receiptNo: existing.receiptNo ?? generateReceiptNo(),
      resultCode: 0,
      resultDesc: "The service request is processed successfully. (simulated)",
      completedAt: new Date(),
    },
  });
}

/** Mark a pending STK push as failed/cancelled/timed out. */
export async function failStkPush(
  transactionId: string,
  orgId: string,
  status: "FAILED" | "CANCELLED" | "TIMEOUT",
) {
  const existing = await prisma.mpesaTransaction.findFirst({
    where: { id: transactionId, organizationId: orgId },
  });
  if (!existing || existing.status !== "PENDING") return existing;

  return prisma.mpesaTransaction.update({
    where: { id: transactionId },
    data: {
      status,
      resultDesc:
        status === "CANCELLED"
          ? "Request cancelled by user"
          : status === "TIMEOUT"
            ? "Timeout waiting for the customer to respond"
            : "Request failed",
      completedAt: new Date(),
    },
  });
}

/** Current state of a transaction, for STK push polling in the UI. */
export async function getTransactionStatus(transactionId: string, orgId: string) {
  const txn = await prisma.mpesaTransaction.findFirst({
    where: { id: transactionId, organizationId: orgId },
    select: {
      id: true,
      status: true,
      receiptNo: true,
      resultCode: true,
      resultDesc: true,
      amount: true,
      phone: true,
      completedAt: true,
      checkoutRequestId: true,
    },
  });
  if (!txn) return null;

  return {
    id: txn.id,
    status: txn.status,
    receiptNo: txn.receiptNo,
    resultCode: txn.resultCode,
    resultDesc: txn.resultDesc,
    amount: txn.amount.toString(),
    phone: txn.phone,
    completedAt: txn.completedAt?.toISOString() ?? null,
    isLive: Boolean(txn.checkoutRequestId),
  };
}

export { MPESA_RESULT_CODES, applyStkCallback, parseStkCallback } from "@/lib/mpesa/callback";
export type { MpesaEnvironmentName, SafeMpesaConfig } from "@/lib/mpesa/config";
