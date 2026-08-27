/**
 * M-Pesa STK callback parsing tests — importing the PRODUCTION
 * parseStkCallback / statusForResultCode from src/lib/mpesa/callback.ts.
 *
 * Callback AUTHENTICATION is tested in callback-auth.test.ts; the durable
 * settlement flow is tested in tests/integration/settlement.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MPESA_RESULT_CODES,
  parseStkCallback,
  statusForResultCode,
} from "@/lib/mpesa/callback";

function body(overrides: Record<string, unknown> = {}) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: "29115-34620561-1",
        CheckoutRequestID: "ws_CO_191220191020363925",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 1 },
            { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
            { Name: "TransactionDate", Value: 20191219102115 },
            { Name: "PhoneNumber", Value: 254708374149 },
          ],
        },
        ...overrides,
      },
    },
  };
}

describe("parseStkCallback (production)", () => {
  it("parses a successful callback with metadata", () => {
    const r = parseStkCallback(body());
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.data.checkoutRequestId, "ws_CO_191220191020363925");
      assert.equal(r.data.merchantRequestId, "29115-34620561-1");
      assert.equal(r.data.resultCode, 0);
      assert.equal(r.data.amount, 1);
      assert.equal(r.data.receiptNumber, "NLJ7RT61SV");
      assert.equal(r.data.phone, "254708374149");
      // 20191219102115 EAT (UTC+3) → 07:21:15 UTC
      assert.equal(r.data.transactionDate?.toISOString(), "2019-12-19T07:21:15.000Z");
    }
  });

  it("parses a failed callback (no metadata)", () => {
    const r = parseStkCallback(
      body({ ResultCode: 1032, ResultDesc: "Request cancelled by user", CallbackMetadata: undefined }),
    );
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.data.resultCode, 1032);
      assert.equal(r.data.amount, null);
      assert.equal(r.data.receiptNumber, null);
    }
  });

  it("accepts string ResultCode", () => {
    const r = parseStkCallback(body({ ResultCode: "0" }));
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.data.resultCode, 0);
  });

  it("rejects non-object bodies", () => {
    assert.ok(!parseStkCallback(null).ok);
    assert.ok(!parseStkCallback("string").ok);
    assert.ok(!parseStkCallback(42).ok);
    assert.ok(!parseStkCallback([1, 2]).ok);
  });

  it("rejects missing Body", () => {
    assert.ok(!parseStkCallback({}).ok);
    assert.ok(!parseStkCallback({ Body: null }).ok);
  });

  it("rejects missing stkCallback node", () => {
    assert.ok(!parseStkCallback({ Body: {} }).ok);
  });

  it("rejects missing CheckoutRequestID", () => {
    assert.ok(!parseStkCallback(body({ CheckoutRequestID: "" })).ok);
    assert.ok(!parseStkCallback(body({ CheckoutRequestID: 123 })).ok);
  });

  it("rejects missing/invalid ResultCode", () => {
    assert.ok(!parseStkCallback(body({ ResultCode: undefined })).ok);
    assert.ok(!parseStkCallback(body({ ResultCode: "abc" })).ok);
    assert.ok(!parseStkCallback(body({ ResultCode: NaN })).ok);
  });

  it("ignores unknown metadata items", () => {
    const r = parseStkCallback(
      body({ CallbackMetadata: { Item: [{ Name: "Something", Value: "x" }] } }),
    );
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.data.amount, null);
      assert.equal(r.data.receiptNumber, null);
    }
  });

  it("tolerates malformed metadata items", () => {
    const r = parseStkCallback(
      body({ CallbackMetadata: { Item: [null, 5, { Value: "no-name" }] } }),
    );
    assert.ok(r.ok);
  });

  it("rejects malformed transaction dates but keeps the callback valid", () => {
    const r = parseStkCallback(
      body({ CallbackMetadata: { Item: [{ Name: "TransactionDate", Value: "not-a-date" }] } }),
    );
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.data.transactionDate, null);
  });
});

describe("statusForResultCode (production result mapping)", () => {
  it("maps success", () => assert.equal(statusForResultCode(0), "SUCCESS"));
  it("maps cancelled by user", () => assert.equal(statusForResultCode(MPESA_RESULT_CODES.CANCELLED_BY_USER), "CANCELLED"));
  it("maps timeout", () => assert.equal(statusForResultCode(MPESA_RESULT_CODES.TIMEOUT), "TIMEOUT"));
  it("maps insufficient funds to FAILED", () => assert.equal(statusForResultCode(MPESA_RESULT_CODES.INSUFFICIENT_FUNDS), "FAILED"));
  it("maps wrong pin to FAILED", () => assert.equal(statusForResultCode(MPESA_RESULT_CODES.WRONG_PIN), "FAILED"));
  it("maps generic failure", () => assert.equal(statusForResultCode(MPESA_RESULT_CODES.GENERIC_FAILURE), "FAILED"));
  it("maps unknown codes to FAILED (fail closed)", () => assert.equal(statusForResultCode(9999), "FAILED"));
});
