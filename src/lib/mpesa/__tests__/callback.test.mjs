import { describe, it } from "node:test";
import assert from "node:assert/strict";

const MPESA_RESULT_CODES = {
  SUCCESS: 0,
  INSUFFICIENT_FUNDS: 1,
  WRONG_PIN: 2001,
  SUBSCRIBER_LOCKED: 1001,
  CANCELLED_BY_USER: 1032,
  TIMEOUT: 1037,
  GENERIC_FAILURE: 1025,
};

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseTransactionDate(value) {
  if (value === undefined || value === null) return null;
  const raw = String(value);
  if (!/^\d{14}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  const second = Number(raw.slice(12, 14));
  const ms = Date.UTC(year, month - 1, day, hour - 3, minute, second);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function parseStkCallback(body) {
  const root = asRecord(body);
  if (!root) return { ok: false, error: "Callback body must be a JSON object." };
  const bodyNode = asRecord(root.Body);
  if (!bodyNode) return { ok: false, error: "Missing 'Body' in callback." };
  const stk = asRecord(bodyNode.stkCallback);
  if (!stk) return { ok: false, error: "Missing 'Body.stkCallback' in callback." };
  const checkoutRequestId = typeof stk.CheckoutRequestID === "string" ? stk.CheckoutRequestID.trim() : "";
  if (!checkoutRequestId) return { ok: false, error: "Missing 'CheckoutRequestID' in callback." };
  const rawResultCode = stk.ResultCode;
  const resultCode =
    typeof rawResultCode === "number" ? rawResultCode
    : typeof rawResultCode === "string" && rawResultCode.trim() !== "" ? Number(rawResultCode)
    : NaN;
  if (!Number.isFinite(resultCode)) return { ok: false, error: "Missing or invalid 'ResultCode' in callback." };
  const merchantRequestId = typeof stk.MerchantRequestID === "string" ? stk.MerchantRequestID : "";
  const resultDesc = typeof stk.ResultDesc === "string" ? stk.ResultDesc : "No description supplied.";
  let amount = null, receiptNumber = null, phone = null, transactionDate = null;
  const metadata = asRecord(stk.CallbackMetadata);
  const items = Array.isArray(metadata?.Item) ? metadata.Item : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    switch (item.Name) {
      case "Amount": { const n = Number(item.Value); amount = Number.isFinite(n) ? n : null; break; }
      case "MpesaReceiptNumber": receiptNumber = item.Value !== undefined ? String(item.Value) : null; break;
      case "PhoneNumber": phone = item.Value !== undefined ? String(item.Value) : null; break;
      case "TransactionDate": transactionDate = parseTransactionDate(item.Value); break;
    }
  }
  return { ok: true, data: { merchantRequestId, checkoutRequestId, resultCode, resultDesc, amount, receiptNumber, phone, transactionDate } };
}

function statusForResultCode(resultCode) {
  if (resultCode === MPESA_RESULT_CODES.SUCCESS) return "SUCCESS";
  if (resultCode === MPESA_RESULT_CODES.CANCELLED_BY_USER) return "CANCELLED";
  if (resultCode === MPESA_RESULT_CODES.TIMEOUT) return "TIMEOUT";
  return "FAILED";
}

const SUCCESS_CALLBACK = {
  Body: { stkCallback: {
    MerchantRequestID: "29115-34620561-1", CheckoutRequestID: "ws_CO_191220191020363925",
    ResultCode: 0, ResultDesc: "The service request is processed successfully.",
    CallbackMetadata: { Item: [
      { Name: "Amount", Value: 1 }, { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
      { Name: "TransactionDate", Value: 20191219102115 }, { Name: "PhoneNumber", Value: 254708374149 },
    ]},
  }},
};
const FAILED_CALLBACK = {
  Body: { stkCallback: {
    MerchantRequestID: "29115-34620561-2", CheckoutRequestID: "ws_CO_FAILED_123",
    ResultCode: 1, ResultDesc: "The initiator information is invalid.",
  }},
};
const CANCELLED_CALLBACK = {
  Body: { stkCallback: {
    MerchantRequestID: "29115-34620561-3", CheckoutRequestID: "ws_CO_CANCELLED_456",
    ResultCode: 1032, ResultDesc: "Request cancelled by user.",
  }},
};
const TIMEOUT_CALLBACK = {
  Body: { stkCallback: {
    MerchantRequestID: "29115-34620561-4", CheckoutRequestID: "ws_CO_TIMEOUT_789",
    ResultCode: 1037, ResultDesc: "DS timeout user cannot be reached.",
  }},
};

describe("parseStkCallback", () => {
  describe("successful callback", () => {
    it("parses a complete success callback", () => {
      const result = parseStkCallback(SUCCESS_CALLBACK);
      assert.equal(result.ok, true);
      assert.equal(result.data.merchantRequestId, "29115-34620561-1");
      assert.equal(result.data.checkoutRequestId, "ws_CO_191220191020363925");
      assert.equal(result.data.resultCode, 0);
      assert.equal(result.data.amount, 1);
      assert.equal(result.data.receiptNumber, "NLJ7RT61SV");
      assert.equal(result.data.phone, "254708374149");
      assert.ok(result.data.transactionDate instanceof Date);
    });
    it("parses EAT timestamp correctly (UTC+3)", () => {
      const result = parseStkCallback(SUCCESS_CALLBACK);
      const date = result.data.transactionDate;
      assert.equal(date.getUTCFullYear(), 2019);
      assert.equal(date.getUTCMonth(), 11);
      assert.equal(date.getUTCDate(), 19);
      assert.equal(date.getUTCHours(), 7); // 10 - 3
      assert.equal(date.getUTCMinutes(), 21);
      assert.equal(date.getUTCSeconds(), 15);
    });
  });

  describe("failed callbacks", () => {
    it("parses insufficient funds callback", () => {
      const result = parseStkCallback(FAILED_CALLBACK);
      assert.equal(result.ok, true);
      assert.equal(result.data.resultCode, 1);
      assert.equal(result.data.amount, null);
      assert.equal(result.data.receiptNumber, null);
    });
    it("parses cancelled callback", () => {
      const result = parseStkCallback(CANCELLED_CALLBACK);
      assert.equal(result.ok, true);
      assert.equal(result.data.resultCode, 1032);
    });
    it("parses timeout callback", () => {
      const result = parseStkCallback(TIMEOUT_CALLBACK);
      assert.equal(result.ok, true);
      assert.equal(result.data.resultCode, 1037);
    });
  });

  describe("validation", () => {
    it("rejects non-object body", () => {
      assert.equal(parseStkCallback(null).ok, false);
      assert.equal(parseStkCallback("string").ok, false);
      assert.equal(parseStkCallback(42).ok, false);
    });
    it("rejects missing Body", () => {
      assert.equal(parseStkCallback({}).ok, false);
      assert.equal(parseStkCallback({ Body: null }).ok, false);
    });
    it("rejects missing stkCallback", () => {
      assert.equal(parseStkCallback({ Body: {} }).ok, false);
    });
    it("rejects missing CheckoutRequestID", () => {
      assert.equal(parseStkCallback({ Body: { stkCallback: { MerchantRequestID: "123", ResultCode: 0 } } }).ok, false);
    });
    it("rejects missing ResultCode", () => {
      assert.equal(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "ws_CO_123", MerchantRequestID: "123" } } }).ok, false);
    });
    it("accepts string ResultCode that is numeric", () => {
      const result = parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "ws_CO_123", MerchantRequestID: "123", ResultCode: "0" } } });
      assert.equal(result.ok, true);
      assert.equal(result.data.resultCode, 0);
    });
  });
});

describe("statusForResultCode", () => {
  it("maps 0 to SUCCESS", () => assert.equal(statusForResultCode(0), "SUCCESS"));
  it("maps 1032 to CANCELLED", () => assert.equal(statusForResultCode(1032), "CANCELLED"));
  it("maps 1037 to TIMEOUT", () => assert.equal(statusForResultCode(1037), "TIMEOUT"));
  it("maps 1 to FAILED", () => assert.equal(statusForResultCode(1), "FAILED"));
  it("maps 2001 to FAILED", () => assert.equal(statusForResultCode(2001), "FAILED"));
  it("maps 1001 to FAILED", () => assert.equal(statusForResultCode(1001), "FAILED"));
  it("maps unknown codes to FAILED", () => assert.equal(statusForResultCode(9999), "FAILED"));
});
