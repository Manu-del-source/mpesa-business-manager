/**
 * DarajaProvider — implements the PaymentProvider interface by delegating
 * to the existing Daraja STK Push integration in src/lib/mpesa/.
 *
 * This adapter is the bridge between the new provider-agnostic payment
 * domain and the established Safaricom Daraja integration. It preserves
 * all existing behavior (OAuth caching, callback validation, error mapping)
 * while presenting a standardized interface.
 */

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  checkCallbackUrl,
  darajaBaseUrl,
  resolveMpesaConfig,
  type ResolvedMpesaConfig,
} from "@/lib/mpesa/config";
import { getAccessToken, invalidateAccessToken } from "@/lib/mpesa/oauth";
import { darajaTimestamp, stkPassword } from "@/lib/mpesa/daraja";
import { DarajaError, codeForStatus, toDarajaError } from "@/lib/mpesa/errors";
import type {
  PaymentProvider,
  ProviderCapabilities,
  StkPushRequest,
  StkPushResponse,
  PaymentQueryRequest,
  PaymentQueryResponse,
} from "@/lib/providers/types";

// ---------------------------------------------------------------------------
// Daraja-specific types
// ---------------------------------------------------------------------------

type DarajaStkPushResponse = {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  errorCode?: string;
  errorMessage?: string;
};

type DarajaStkQueryResponse = {
  ResponseCode?: string;
  ResultCode?: string;
  ResultDesc?: string;
  errorCode?: string;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// DarajaProvider
// ---------------------------------------------------------------------------

export class DarajaProvider implements PaymentProvider {
  readonly name = "daraja";

  readonly capabilities: ProviderCapabilities = {
    stkPush: true,
    stkQuery: true,
    b2c: false,
    sandbox: true,
    currencies: ["KES"],
  };

  private orgId: string;

  constructor(orgId: string) {
    this.orgId = orgId;
  }

  /**
   * Resolve the Daraja configuration for this organization.
   * Returns null if not configured or in demo mode.
   */
  private async getConfig(): Promise<ResolvedMpesaConfig | null> {
    const config = await resolveMpesaConfig(this.orgId);
    if (!config || !config.enabled) return null;
    return config;
  }

  async initiateStkPush(request: StkPushRequest): Promise<StkPushResponse> {
    const config = await this.getConfig();
    if (!config) {
      return {
        accepted: false,
        requestId: null,
        checkoutId: null,
        customerMessage: "M-Pesa is not configured for this business.",
        errorCode: "NOT_CONFIGURED",
        errorMessage: "M-Pesa is not configured or is disabled.",
      };
    }

    // Validate callback URL
    const callbackCheck = checkCallbackUrl(config.callbackUrl);
    if (!callbackCheck.ok) {
      return {
        accepted: false,
        requestId: null,
        checkoutId: null,
        customerMessage: callbackCheck.message,
        errorCode: "INVALID_CALLBACK",
        errorMessage: `Invalid CallBackURL: ${callbackCheck.problem}`,
      };
    }

    const timestamp = darajaTimestamp();
    const password = stkPassword(config.shortcode, config.passkey, timestamp);

    // Convert minor units to whole KES (Daraja doesn't accept decimals)
    const amountKes = Math.max(1, Math.round(Number(request.amountMinor) / 100));

    const body = {
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amountKes,
      PartyA: request.phone,
      PartyB: config.shortcode,
      PhoneNumber: request.phone,
      CallBackURL: config.callbackUrl,
      AccountReference: (request.reference ?? "MBM").slice(0, 12),
      TransactionDesc: (request.description ?? "Payment").slice(0, 13),
    };

    let res: Response;
    try {
      const token = await getAccessToken(config);
      res = await this.postStkPush(config, body, token);

      // Retry once on 401 (stale token)
      if (res.status === 401) {
        invalidateAccessToken(config);
        const freshToken = await getAccessToken(config, { forceRefresh: true });
        res = await this.postStkPush(config, body, freshToken);
      }
    } catch (err) {
      const error = toDarajaError(err);
      return {
        accepted: false,
        requestId: null,
        checkoutId: null,
        customerMessage: error.userMessage,
        errorCode: error.code,
        errorMessage: error.detail,
      };
    }

    const bodyText = await res.text();
    let data: DarajaStkPushResponse = {};
    try {
      data = JSON.parse(bodyText) as DarajaStkPushResponse;
    } catch {
      return {
        accepted: false,
        requestId: null,
        checkoutId: null,
        customerMessage: "Safaricom returned an unexpected response.",
        errorCode: "DARAJA_ERROR",
        errorMessage: `Non-JSON response: ${bodyText.slice(0, 200)}`,
      };
    }

    if (!res.ok) {
      return {
        accepted: false,
        requestId: data.MerchantRequestID ?? null,
        checkoutId: null,
        customerMessage: res.status === 400 && data.errorMessage
          ? `Safaricom rejected: ${data.errorMessage}`
          : "Safaricom could not process this request.",
        errorCode: codeForStatus(res.status),
        errorMessage: data.errorMessage ?? `HTTP ${res.status}`,
      };
    }

    if (data.ResponseCode !== "0" || !data.CheckoutRequestID) {
      return {
        accepted: false,
        requestId: data.MerchantRequestID ?? null,
        checkoutId: null,
        customerMessage: data.ResponseDescription ?? "Request was not accepted.",
        errorCode: "DARAJA_ERROR",
        errorMessage: `ResponseCode=${data.ResponseCode}: ${data.ResponseDescription ?? bodyText.slice(0, 200)}`,
      };
    }

    return {
      accepted: true,
      requestId: data.MerchantRequestID ?? null,
      checkoutId: data.CheckoutRequestID,
      customerMessage: data.CustomerMessage ?? "Request accepted. Ask the customer to enter their M-Pesa PIN.",
    };
  }

  async queryStkPush(request: PaymentQueryRequest): Promise<PaymentQueryResponse> {
    const config = await this.getConfig();
    if (!config) {
      return {
        pending: false,
        resultCode: 1,
        resultDesc: "M-Pesa is not configured.",
        amountMinor: null,
        receiptNumber: null,
        transactionDate: null,
      };
    }

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
          CheckoutRequestID: request.checkoutId,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(env.darajaTimeoutMs),
      });
    } catch (err) {
      const error = toDarajaError(err);
      return {
        pending: false,
        resultCode: null,
        resultDesc: error.userMessage,
        amountMinor: null,
        receiptNumber: null,
        transactionDate: null,
      };
    }

    const bodyText = await res.text();
    let data: DarajaStkQueryResponse = {};
    try {
      data = JSON.parse(bodyText) as DarajaStkQueryResponse;
    } catch {
      return {
        pending: false,
        resultCode: null,
        resultDesc: "Safaricom returned an unexpected response.",
        amountMinor: null,
        receiptNumber: null,
        transactionDate: null,
      };
    }

    // 500.001.1001 = "transaction is being processed" — still pending
    if (!res.ok) {
      if (data.errorCode === "500.001.1001") {
        return { pending: true, resultCode: null, resultDesc: data.errorMessage ?? null, amountMinor: null, receiptNumber: null, transactionDate: null };
      }
      return {
        pending: false,
        resultCode: null,
        resultDesc: data.errorMessage ?? `HTTP ${res.status}`,
        amountMinor: null,
        receiptNumber: null,
        transactionDate: null,
      };
    }

    const resultCode = data.ResultCode !== undefined ? Number(data.ResultCode) : null;
    return {
      pending: resultCode === null,
      resultCode: Number.isFinite(resultCode) ? resultCode : null,
      resultDesc: data.ResultDesc ?? null,
      amountMinor: null, // Daraja query doesn't return amount
      receiptNumber: null,
      transactionDate: null,
    };
  }

  async healthCheck(): Promise<boolean> {
    const config = await this.getConfig();
    return config !== null;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async postStkPush(
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
}
