/**
 * Daraja provider tests — importing the PRODUCTION pure response-mapping
 * helpers extracted from src/lib/providers/daraja.ts (mapStkPushHttpResponse,
 * mapStkQueryHttpResponse) plus the production amount constraint from
 * src/lib/money.ts. No network, no credentials needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DarajaProvider,
  mapStkPushHttpResponse,
  mapStkQueryHttpResponse,
} from "@/lib/providers/daraja";
import { darajaAmountConstraint } from "@/lib/money";

function pushBody(data: Record<string, unknown>) {
  return JSON.stringify(data);
}

describe("DarajaProvider interface compliance (production class)", () => {
  const provider = new DarajaProvider("org-test");
  it("exposes the provider name", () => assert.equal(provider.name, "daraja"));
  it("supports stkPush and stkQuery but not b2c", () => {
    assert.ok(provider.capabilities.stkPush);
    assert.ok(provider.capabilities.stkQuery);
    assert.ok(!provider.capabilities.b2c);
  });
  it("is a sandbox-capable KES provider", () => {
    assert.ok(provider.capabilities.sandbox);
    assert.deepEqual(provider.capabilities.currencies, ["KES"]);
  });
  it("implements the full PaymentProvider interface", () => {
    assert.equal(typeof provider.initiateStkPush, "function");
    assert.equal(typeof provider.queryStkPush, "function");
    assert.equal(typeof provider.healthCheck, "function");
  });
});

describe("STK Push response mapping (production mapStkPushHttpResponse)", () => {
  it("maps a successful response", () => {
    const bodyText = pushBody({
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_191220191020363925",
      ResponseCode: "0",
      ResponseDescription: "Success. Request accepted for processing.",
      CustomerMessage: "Success. Request accepted for processing.",
    });
    const result = mapStkPushHttpResponse(
      { ok: true, status: 200 },
      JSON.parse(bodyText),
      bodyText,
    );
    assert.ok(result.accepted);
    assert.equal(result.checkoutId, "ws_CO_191220191020363925");
    assert.equal(result.requestId, "29115-34620561-1");
  });

  it("maps 400 error with Daraja error message", () => {
    const bodyText = pushBody({
      errorCode: "400.001.001",
      errorMessage: "Bad Request - The Business ShortCode value is invalid.",
    });
    const result = mapStkPushHttpResponse(
      { ok: false, status: 400 },
      JSON.parse(bodyText),
      bodyText,
    );
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "INVALID_REQUEST");
    assert.ok(result.customerMessage.includes("Safaricom rejected"));
  });

  it("maps 401 to INVALID_CREDENTIALS", () => {
    const bodyText = pushBody({ errorMessage: "Invalid credentials" });
    const result = mapStkPushHttpResponse(
      { ok: false, status: 401 },
      JSON.parse(bodyText),
      bodyText,
    );
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "INVALID_CREDENTIALS");
  });

  it("maps 500 to DARAJA_ERROR", () => {
    const bodyText = pushBody({ errorMessage: "Server error" });
    const result = mapStkPushHttpResponse(
      { ok: false, status: 500 },
      JSON.parse(bodyText),
      bodyText,
    );
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "DARAJA_ERROR");
  });

  it("maps non-zero ResponseCode as failure even on HTTP 200", () => {
    const bodyText = pushBody({
      MerchantRequestID: "m1",
      ResponseCode: "1",
      ResponseDescription: "The initiator has insufficient funds.",
    });
    const result = mapStkPushHttpResponse(
      { ok: true, status: 200 },
      JSON.parse(bodyText),
      bodyText,
    );
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "DARAJA_ERROR");
  });

  it("missing CheckoutRequestID on HTTP 200 is a failure", () => {
    const bodyText = pushBody({ MerchantRequestID: "m1", ResponseCode: "0" });
    const result = mapStkPushHttpResponse(
      { ok: true, status: 200 },
      JSON.parse(bodyText),
      bodyText,
    );
    assert.ok(!result.accepted);
  });
});

describe("STK Query response mapping (production mapStkQueryHttpResponse)", () => {
  it("maps a successful query with ResultCode 0", () => {
    const result = mapStkQueryHttpResponse(
      { ok: true, status: 200 },
      { ResultCode: "0", ResultDesc: "The service request is processed successfully." },
    );
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 0);
    assert.equal(result.resultDesc, "The service request is processed successfully.");
  });

  it("maps pending transaction (null ResultCode)", () => {
    const result = mapStkQueryHttpResponse({ ok: true, status: 200 }, {});
    assert.ok(result.pending);
    assert.equal(result.resultCode, null);
  });

  it("maps cancelled by user (1032)", () => {
    const result = mapStkQueryHttpResponse(
      { ok: true, status: 200 },
      { ResultCode: "1032", ResultDesc: "Request cancelled by user" },
    );
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 1032);
  });

  it("maps timeout (1037)", () => {
    const result = mapStkQueryHttpResponse(
      { ok: true, status: 200 },
      { ResultCode: "1037" },
    );
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 1037);
  });

  it("maps 500.001.1001 as PENDING (still processing)", () => {
    const result = mapStkQueryHttpResponse(
      { ok: false, status: 500 },
      { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" },
    );
    assert.ok(result.pending);
  });

  it("maps other 500 errors as failed", () => {
    const result = mapStkQueryHttpResponse(
      { ok: false, status: 500 },
      { errorCode: "500.001.1002", errorMessage: "boom" },
    );
    assert.ok(!result.pending);
    assert.equal(result.resultDesc, "boom");
  });

  it("never fabricates an amount or receipt", () => {
    const result = mapStkQueryHttpResponse(
      { ok: true, status: 200 },
      { ResultCode: "0", ResultDesc: "ok" },
    );
    assert.equal(result.amountMinor, null);
    assert.equal(result.receiptNumber, null);
  });
});

describe("Daraja amount constraint (production — reject, never round)", () => {
  it("accepts whole KES and returns the exact KES amount", () => {
    const r = darajaAmountConstraint(1_500_000n);
    assert.ok(r.ok);
    assert.ok(r.ok && r.amountKes === 15_000n);
  });
  it("rejects fractional KES (would require rounding)", () => {
    assert.ok(!darajaAmountConstraint(1_500_050n).ok);
  });
  it("rejects amounts above the M-Pesa per-transaction limit", () => {
    assert.ok(!darajaAmountConstraint(15_000_100n).ok);
  });
});
