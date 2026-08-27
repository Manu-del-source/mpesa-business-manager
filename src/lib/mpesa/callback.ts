import "server-only";
import type { MpesaStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logMpesa, logMpesaError } from "@/lib/mpesa/log";
import { enqueueSaleSettlementTx } from "@/lib/settlement";
import { resolveTenantForOrg } from "@/lib/provisioning";

/**
 * Daraja STK Push callback handling.
 *
 * Safaricom POSTs a body shaped like:
 *
 * {
 *   "Body": { "stkCallback": {
 *       "MerchantRequestID": "29115-34620561-1",
 *       "CheckoutRequestID": "ws_CO_191220191020363925",
 *       "ResultCode": 0,
 *       "ResultDesc": "The service request is processed successfully.",
 *       "CallbackMetadata": { "Item": [
 *           { "Name": "Amount", "Value": 1 },
 *           { "Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV" },
 *           { "Name": "TransactionDate", "Value": 20191219102115 },
 *           { "Name": "PhoneNumber", "Value": 254708374149 }
 *   ]}}}
 * }
 *
 * CallbackMetadata is present only when ResultCode === 0.
 */

/** Result codes Safaricom returns on the STK callback. */
export const MPESA_RESULT_CODES = {
  SUCCESS: 0,
  /** Insufficient balance. */
  INSUFFICIENT_FUNDS: 1,
  /** Less common: wrong PIN entered too many times. */
  WRONG_PIN: 2001,
  /** Unable to lock subscriber — usually another STK prompt is open. */
  SUBSCRIBER_LOCKED: 1001,
  /** Request cancelled by the user. */
  CANCELLED_BY_USER: 1032,
  /** Timeout: the user never responded to the prompt. */
  TIMEOUT: 1037,
  /** Generic Daraja rejection. */
  GENERIC_FAILURE: 1025,
} as const;

export type StkCallbackItem = { Name?: string; Value?: string | number };

export type StkCallbackPayload = {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amount: number | null;
  receiptNumber: string | null;
  phone: string | null;
  transactionDate: Date | null;
};

export type ParseResult =
  | { ok: true; data: StkCallbackPayload }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Daraja sends 20191219102115 (YYYYMMDDHHmmss, EAT). */
function parseTransactionDate(value: string | number | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const raw = String(value);
  if (!/^\d{14}$/.test(raw)) return null;

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));

  // Timestamps are East Africa Time (UTC+3).
  const ms = Date.UTC(year, month - 1, day, hour - 3, minute, second);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Validate and flatten a raw Daraja callback body.
 * Rejects anything that isn't a well-formed stkCallback envelope.
 */
export function parseStkCallback(body: unknown): ParseResult {
  const root = asRecord(body);
  if (!root) return { ok: false, error: "Callback body must be a JSON object." };

  const bodyNode = asRecord(root.Body);
  if (!bodyNode) return { ok: false, error: "Missing 'Body' in callback." };

  const stk = asRecord(bodyNode.stkCallback);
  if (!stk) return { ok: false, error: "Missing 'Body.stkCallback' in callback." };

  const checkoutRequestId =
    typeof stk.CheckoutRequestID === "string" ? stk.CheckoutRequestID.trim() : "";
  if (!checkoutRequestId) {
    return { ok: false, error: "Missing 'CheckoutRequestID' in callback." };
  }

  const rawResultCode = stk.ResultCode;
  const resultCode =
    typeof rawResultCode === "number"
      ? rawResultCode
      : typeof rawResultCode === "string" && rawResultCode.trim() !== ""
        ? Number(rawResultCode)
        : NaN;
  if (!Number.isFinite(resultCode)) {
    return { ok: false, error: "Missing or invalid 'ResultCode' in callback." };
  }

  const merchantRequestId =
    typeof stk.MerchantRequestID === "string" ? stk.MerchantRequestID : "";
  const resultDesc =
    typeof stk.ResultDesc === "string" ? stk.ResultDesc : "No description supplied.";

  // Metadata only exists for successful payments.
  let amount: number | null = null;
  let receiptNumber: string | null = null;
  let phone: string | null = null;
  let transactionDate: Date | null = null;

  const metadata = asRecord(stk.CallbackMetadata);
  const items = Array.isArray(metadata?.Item) ? (metadata.Item as StkCallbackItem[]) : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    switch (item.Name) {
      case "Amount": {
        const n = Number(item.Value);
        amount = Number.isFinite(n) ? n : null;
        break;
      }
      case "MpesaReceiptNumber":
        receiptNumber = item.Value !== undefined ? String(item.Value) : null;
        break;
      case "PhoneNumber":
        phone = item.Value !== undefined ? String(item.Value) : null;
        break;
      case "TransactionDate":
        transactionDate = parseTransactionDate(item.Value);
        break;
      default:
        break;
    }
  }

  return {
    ok: true,
    data: {
      merchantRequestId,
      checkoutRequestId,
      resultCode,
      resultDesc,
      amount,
      receiptNumber,
      phone,
      transactionDate,
    },
  };
}

/** Map a Daraja ResultCode onto our MpesaStatus enum. */
export function statusForResultCode(resultCode: number): MpesaStatus {
  if (resultCode === MPESA_RESULT_CODES.SUCCESS) return "SUCCESS";
  if (resultCode === MPESA_RESULT_CODES.CANCELLED_BY_USER) return "CANCELLED";
  if (resultCode === MPESA_RESULT_CODES.TIMEOUT) return "TIMEOUT";
  return "FAILED";
}

export type ApplyCallbackOutcome =
  | { outcome: "applied"; transactionId: string; status: MpesaStatus }
  | { outcome: "duplicate"; transactionId: string; status: MpesaStatus }
  | { outcome: "unknown_transaction" };

/**
 * Persist a parsed callback against its transaction.
 *
 * Idempotency: the update is scoped to `status: PENDING` via `updateMany`, so
 * a replayed callback (Safaricom retries) matches zero rows and is reported as
 * a duplicate instead of overwriting a settled transaction.
 *
 * SETTLEMENT SEMANTICS (retryable, never lost): when the guarded update wins,
 * the durable settlement work for a linked POS sale is enqueued as an outbox
 * record IN THE SAME TRANSACTION as the provider-result write. The callback
 * is then acknowledged — the settlement worker (inline best-effort + the
 * reconciliation sweep) retries the financial side until it succeeds, with
 * every operation idempotent. A settlement failure can never be masked by a
 * permanently "processed" callback.
 */
export async function applyStkCallback(
  payload: StkCallbackPayload,
): Promise<ApplyCallbackOutcome> {
  const existing = await prisma.mpesaTransaction.findFirst({
    where: { checkoutRequestId: payload.checkoutRequestId },
    select: { id: true, status: true, organizationId: true, reference: true },
  });

  if (!existing) {
    logMpesaError("callback.unknown_transaction", {
      checkoutRequestId: payload.checkoutRequestId,
      resultCode: payload.resultCode,
    });
    return { outcome: "unknown_transaction" };
  }

  const status = statusForResultCode(payload.resultCode);

  // The org's application context for the outbox record — idempotent
  // provisioning (legacy organizations get a tenant + default application).
  let applicationId: string | null = null;
  if (existing.reference) {
    const { application } = await resolveTenantForOrg(existing.organizationId);
    applicationId = application.id;
  }

  const applied = await prisma.$transaction(async (tx) => {
    // Guarded update: only a still-PENDING transaction accepts the result.
    const updated = await tx.mpesaTransaction.updateMany({
      where: { id: existing.id, status: "PENDING" },
      data: {
        status,
        resultCode: payload.resultCode,
        resultDesc: payload.resultDesc.slice(0, 500),
        receiptNo: payload.receiptNumber ?? undefined,
        merchantRequestId: payload.merchantRequestId || undefined,
        completedAt: payload.transactionDate ?? new Date(),
      },
    });
    if (updated.count === 0) return false;

    // Provider result is now durable. Enqueue the settlement work in the
    // SAME transaction so it cannot be lost, whatever happens next.
    if (existing.reference && applicationId) {
      await enqueueSaleSettlementTx(tx, applicationId, {
        organizationId: existing.organizationId,
        receiptNo: existing.reference,
        status,
        mpesaReceipt: payload.receiptNumber,
        transactionId: existing.id,
      });
    }
    return true;
  });

  if (!applied) {
    logMpesa("callback.duplicate_ignored", {
      transactionId: existing.id,
      checkoutRequestId: payload.checkoutRequestId,
      currentStatus: existing.status,
    });
    return { outcome: "duplicate", transactionId: existing.id, status: existing.status };
  }

  logMpesa("callback.applied", {
    transactionId: existing.id,
    checkoutRequestId: payload.checkoutRequestId,
    resultCode: payload.resultCode,
    status,
  });

  return { outcome: "applied", transactionId: existing.id, status };
}
