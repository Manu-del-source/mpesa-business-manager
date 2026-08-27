import "server-only";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  checkCallbackUrl,
  darajaBaseUrl,
  isLive,
  resolveMpesaConfig,
  type ResolvedMpesaConfig,
} from "@/lib/mpesa/config";
import { getAccessToken, invalidateAccessToken } from "@/lib/mpesa/oauth";
import { DarajaError, codeForStatus, toDarajaError } from "@/lib/mpesa/errors";

/**
 * Safaricom Daraja API — STK Push (Lipa Na M-Pesa Online).
 *
 * Real Daraja traffic only happens when the organization has an enabled
 * MpesaConfig (or the legacy DARAJA_* env fallback) and the app is not in
 * DEMO_MODE. Otherwise `src/lib/mpesa/index.ts` runs the simulated flow.
 *
 * Setup (sandbox):
 *   1. Create a developer account at https://developer.safaricom.co.ke
 *   2. Create an app to get a Consumer Key + Secret.
 *   3. For sandbox use shortcode 174379 with the published Lipa Na M-Pesa
 *      passkey, and a test MSISDN (e.g. 254708374149).
 *   4. Save those under M-Pesa settings in the app, then enable them.
 *
 * IMPORTANT: a successful STK Push response only means Safaricom *accepted*
 * the request. The payment itself is confirmed asynchronously by the callback
 * (`/api/mpesa/callback`), which is the only place a transaction becomes
 * SUCCESS.
 */

/** Daraja timestamp: YYYYMMDDHHmmss in Africa/Nairobi (UTC+3). */
export function darajaTimestamp(now = new Date()): string {
  const nairobi = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${nairobi.getUTCFullYear()}` +
    `${pad(nairobi.getUTCMonth() + 1)}` +
    `${pad(nairobi.getUTCDate())}` +
    `${pad(nairobi.getUTCHours())}` +
    `${pad(nairobi.getUTCMinutes())}` +
    `${pad(nairobi.getUTCSeconds())}`
  );
}

/** base64(shortcode + passkey + timestamp) — the Daraja "Password" field. */
export function stkPassword(
  shortcode: string,
  passkey: string,
  timestamp: string,
): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`, "utf8").toString("base64");
}

type StkPushResponse = {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  errorCode?: string;
  errorMessage?: string;
};

async function postStkPush(
  config: ResolvedMpesaConfig,
  body: Record<string, unknown>,
  token: string,
): Promise<Response> {
  return fetch(`${darajaBaseUrl(config.environment)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(env.darajaTimeoutMs),
  });
}

export type DarajaStkPushInput = {
  orgId: string;
  /** Already normalized to 2547XXXXXXXX / 2541XXXXXXXX. */
  phone: string;
  amount: number;
  reference?: string;
  description?: string;
  /** Pre-created PENDING transaction to attach Daraja's ids to. */
  transactionId: string;
};

export type DarajaStkPushResult = {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
};

/**
 * Send an STK Push for an existing PENDING MpesaTransaction.
 *
 * On success the transaction is updated with the merchant/checkout request
 * ids — it stays PENDING until the callback arrives. On failure a DarajaError
 * is thrown and the caller marks the transaction FAILED.
 */
export async function sendDarajaStkPush(
  config: ResolvedMpesaConfig,
  input: DarajaStkPushInput,
): Promise<DarajaStkPushResult> {
  // Preflight the callback URL. Safaricom rejects non-HTTPS/unreachable
  // callbacks, and a push accepted with a bad callback would sit PENDING
  // forever. Failing here gives an actionable message instead.
  const callbackCheck = checkCallbackUrl(config.callbackUrl);
  if (!callbackCheck.ok) {
    throw new DarajaError("INVALID_REQUEST", {
      detail: `Invalid CallBackURL (${callbackCheck.problem}): ${callbackCheck.url}`,
      userMessage: callbackCheck.message,
    });
  }

  const timestamp = darajaTimestamp();
  const password = stkPassword(config.shortcode, config.passkey, timestamp);

  const body = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    // CustomerPayBillOnline works for paybill shortcodes; till numbers use
    // CustomerBuyGoodsOnline. Sandbox shortcode 174379 is a paybill.
    TransactionType: "CustomerPayBillOnline",
    // Daraja only accepts whole shillings. A fractional (or non-positive)
    // amount is REJECTED here rather than rounded — silently changing what
    // the customer is charged is never acceptable.
    Amount: (() => {
      if (!Number.isInteger(input.amount) || input.amount < 1) {
        throw new DarajaError("INVALID_REQUEST", {
          detail:
            `STK Push amount must be a whole number of Kenyan shillings ` +
            `(got ${input.amount}).`,
          userMessage:
            "Amount must be a whole number of Kenyan shillings.",
        });
      }
      return input.amount;
    })(),
    PartyA: input.phone,
    PartyB: config.shortcode,
    PhoneNumber: input.phone,
    CallBackURL: config.callbackUrl,
    AccountReference: (input.reference ?? "MBM").slice(0, 12),
    TransactionDesc: (input.description ?? "Payment").slice(0, 13),
  };

  let res: Response;
  try {
    const token = await getAccessToken(config);
    res = await postStkPush(config, body, token);

    // A stale/revoked token yields 401 — refresh once and retry.
    if (res.status === 401) {
      invalidateAccessToken(config);
      const freshToken = await getAccessToken(config, { forceRefresh: true });
      res = await postStkPush(config, body, freshToken);
    }
  } catch (err) {
    throw toDarajaError(err);
  }

  const bodyText = await res.text();
  let data: StkPushResponse = {};
  try {
    data = JSON.parse(bodyText) as StkPushResponse;
  } catch {
    throw new DarajaError("DARAJA_ERROR", {
      status: res.status,
      detail: `STK push returned non-JSON: ${bodyText.slice(0, 200)}`,
    });
  }

  if (!res.ok) {
    throw new DarajaError(codeForStatus(res.status), {
      status: res.status,
      detail: `STK push ${res.status}: ${data.errorMessage ?? bodyText.slice(0, 300)}`,
      // Daraja's errorMessage is short and user-appropriate for 400s.
      userMessage:
        res.status === 400 && data.errorMessage
          ? `Safaricom rejected the request: ${data.errorMessage}`
          : undefined,
    });
  }

  if (data.ResponseCode !== "0" || !data.CheckoutRequestID) {
    throw new DarajaError("DARAJA_ERROR", {
      detail: `STK push ResponseCode=${data.ResponseCode}: ${data.ResponseDescription ?? bodyText.slice(0, 200)}`,
      userMessage: data.ResponseDescription ?? undefined,
    });
  }

  const merchantRequestId = data.MerchantRequestID ?? "";
  const checkoutRequestId = data.CheckoutRequestID;

  await prisma.mpesaTransaction.update({
    where: { id: input.transactionId },
    data: {
      merchantRequestId: merchantRequestId || null,
      checkoutRequestId,
      description:
        input.description ?? data.CustomerMessage ?? undefined,
    },
  });

  return {
    merchantRequestId,
    checkoutRequestId,
    customerMessage:
      data.CustomerMessage ?? "Request accepted. Ask the customer to enter their M-Pesa PIN.",
  };
}

type StkQueryResponse = {
  ResponseCode?: string;
  ResultCode?: string;
  ResultDesc?: string;
  errorCode?: string;
  errorMessage?: string;
};

/**
 * STK Push Query — ask Daraja for the final state of a checkout request.
 *
 * Used as a reconciliation fallback when the callback never arrives (common
 * behind NAT/localhost or when the callback URL is briefly unreachable).
 * ResultCode 0 = paid, 1032 = cancelled by user, 1037 = timeout/unreachable.
 */
export async function queryStkStatus(
  config: ResolvedMpesaConfig,
  checkoutRequestId: string,
): Promise<{ resultCode: number | null; resultDesc: string | null; pending: boolean }> {
  const timestamp = darajaTimestamp();
  const password = stkPassword(config.shortcode, config.passkey, timestamp);

  let res: Response;
  try {
    const token = await getAccessToken(config);
    res = await fetch(`${darajaBaseUrl(config.environment)}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(env.darajaTimeoutMs),
    });
  } catch (err) {
    throw toDarajaError(err);
  }

  const bodyText = await res.text();
  let data: StkQueryResponse = {};
  try {
    data = JSON.parse(bodyText) as StkQueryResponse;
  } catch {
    throw new DarajaError("DARAJA_ERROR", {
      detail: `STK query returned non-JSON: ${bodyText.slice(0, 200)}`,
    });
  }

  // 500.001.1001 = "transaction is being processed" — still pending.
  if (!res.ok) {
    if (data.errorCode === "500.001.1001") {
      return { resultCode: null, resultDesc: data.errorMessage ?? null, pending: true };
    }
    throw new DarajaError(codeForStatus(res.status), {
      status: res.status,
      detail: `STK query ${res.status}: ${data.errorMessage ?? bodyText.slice(0, 200)}`,
    });
  }

  const resultCode = data.ResultCode !== undefined ? Number(data.ResultCode) : null;
  return {
    resultCode: Number.isFinite(resultCode) ? resultCode : null,
    resultDesc: data.ResultDesc ?? null,
    pending: resultCode === null,
  };
}

/**
 * Convenience wrapper used by reconciliation: resolve the org's config and
 * return null when the org is not live (demo/unconfigured).
 */
export async function resolveLiveConfig(
  orgId: string,
): Promise<ResolvedMpesaConfig | null> {
  const config = await resolveMpesaConfig(orgId);
  return isLive(config) ? config : null;
}

/** Decimal helper shared with the transaction writers. */
export function toDecimal(amount: number): Prisma.Decimal {
  return new Prisma.Decimal(amount.toFixed(2));
}
