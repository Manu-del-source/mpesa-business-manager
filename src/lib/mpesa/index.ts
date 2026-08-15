import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isDarajaConfigured } from "@/lib/env";
import { initiateDarajaStkPush } from "@/lib/mpesa/daraja";

export const MPESA_MAX_AMOUNT = 150_000;

/** Normalize a Kenyan phone number to international format (2547XXXXXXXX). */
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  if (/^07\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^2547\d{8}$/.test(digits)) return digits;
  if (/^7\d{8}$/.test(digits)) return `254${digits}`;
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

export type StkPushResult =
  | { ok: true; transactionId: string; mode: "mock" | "daraja" }
  | { ok: false; error: string };

/**
 * Initiate an M-Pesa STK push to a customer's phone.
 *
 * - When Daraja credentials are configured (DARAJA_ENABLED=true), a real STK
 *   push is sent to Safaricom. Completion arrives via the callback webhook.
 * - Otherwise the push is **simulated**: a PENDING transaction is recorded and
 *   the UI offers "Simulate payment" to complete it. This keeps the whole
 *   product demoable without Safaricom credentials.
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
    return { ok: false, error: "Enter a valid Safaricom number, e.g. 0712 345 678." };
  }
  if (input.amount < 1 || input.amount > MPESA_MAX_AMOUNT) {
    return { ok: false, error: `Amount must be between KSh 1 and KSh ${MPESA_MAX_AMOUNT.toLocaleString()}.` };
  }

  if (isDarajaConfigured()) {
    const result = await initiateDarajaStkPush({
      orgId: input.orgId,
      phone: normalized,
      amount: input.amount,
      reference: input.reference ?? undefined,
      description: input.description ?? undefined,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, transactionId: result.transactionId, mode: "daraja" };
  }

  // Mock: record the pending transaction immediately.
  const txn = await prisma.mpesaTransaction.create({
    data: {
      organizationId: input.orgId,
      direction: input.direction ?? "INCOMING",
      phone: normalized,
      amount: new Prisma.Decimal(input.amount),
      status: "PENDING",
      reference: input.reference ?? null,
      description: input.description ?? null,
      transactionType: "STK_PUSH",
    },
  });

  return { ok: true, transactionId: txn.id, mode: "mock" };
}

/**
 * Mock-only: complete a pending STK push as successful, simulating the
 * Safaricom callback. In production this happens via the Daraja webhook.
 */
export async function completeStkPush(transactionId: string, orgId: string) {
  const existing = await prisma.mpesaTransaction.findFirst({
    where: { id: transactionId, organizationId: orgId },
  });
  if (!existing) return null;
  if (existing.status !== "PENDING") return existing;

  return prisma.mpesaTransaction.update({
    where: { id: transactionId },
    data: {
      status: "SUCCESS",
      receiptNo: generateReceiptNo(),
      completedAt: new Date(),
    },
  });
}

/** Mock-only: mark a pending STK push as failed/cancelled. */
export async function failStkPush(transactionId: string, orgId: string, status: "FAILED" | "CANCELLED") {
  const existing = await prisma.mpesaTransaction.findFirst({
    where: { id: transactionId, organizationId: orgId },
  });
  if (!existing || existing.status !== "PENDING") return existing;

  return prisma.mpesaTransaction.update({
    where: { id: transactionId },
    data: { status, completedAt: new Date() },
  });
}
