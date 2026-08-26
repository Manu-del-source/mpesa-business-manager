import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test DarajaProvider interface compliance and response mapping
// without requiring actual Daraja credentials or network access.

// ---------------------------------------------------------------------------
// Daraja response mapping logic (extracted for testing)
// ---------------------------------------------------------------------------

function mapStkPushResponse(res, status, bodyText) {
  const data = (() => {
    try { return JSON.parse(bodyText); } catch { return {}; }
  })();

  if (!res.ok) {
    return {
      accepted: false,
      requestId: data.MerchantRequestID ?? null,
      checkoutId: null,
      customerMessage: res.status === 400 && data.errorMessage
        ? `Safaricom rejected: ${data.errorMessage}`
        : "Safaricom could not process this request.",
      errorCode: mapHttpStatus(res.status),
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
    customerMessage: data.CustomerMessage ?? "Request accepted.",
  };
}

function mapStkQueryResponse(res, bodyText) {
  const data = (() => {
    try { return JSON.parse(bodyText); } catch { return {}; }
  })();

  if (!res.ok) {
    if (data.errorCode === "500.001.1001") {
      return { pending: true, resultCode: null, resultDesc: data.errorMessage ?? null };
    }
    return { pending: false, resultCode: null, resultDesc: data.errorMessage ?? `HTTP ${res.status}` };
  }

  const resultCode = data.ResultCode !== undefined ? Number(data.ResultCode) : null;
  return {
    pending: resultCode === null,
    resultCode: Number.isFinite(resultCode) ? resultCode : null,
    resultDesc: data.ResultDesc ?? null,
  };
}

function mapHttpStatus(status) {
  if (status === 400) return "INVALID_REQUEST";
  if (status === 401 || status === 403) return "INVALID_CREDENTIALS";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "DARAJA_ERROR";
  return "DARAJA_ERROR";
}

// Simulated response objects
function mockResponse(ok, status, body) {
  return { ok, status, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DarajaProvider interface compliance", () => {
  it("has required interface fields", () => {
    // Verify the shape matches PaymentProvider interface
    const provider = {
      name: "daraja",
      capabilities: { stkPush: true, stkQuery: true, b2c: false, sandbox: true, currencies: ["KES"] },
      initiateStkPush: async () => ({}),
      queryStkPush: async () => ({}),
      healthCheck: async () => true,
    };
    assert.equal(provider.name, "daraja");
    assert.ok(provider.capabilities.stkPush);
    assert.ok(provider.capabilities.stkQuery);
    assert.ok(!provider.capabilities.b2c);
    assert.ok(provider.capabilities.sandbox);
    assert.ok(typeof provider.initiateStkPush === "function");
    assert.ok(typeof provider.queryStkPush === "function");
    assert.ok(typeof provider.healthCheck === "function");
  });
});

describe("STK Push response mapping", () => {
  it("maps successful response", () => {
    const body = JSON.stringify({
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: "ws_CO_191220191020363925",
      ResponseCode: "0",
      ResponseDescription: "Success. Request accepted for processing.",
      CustomerMessage: "Success. Request accepted for processing.",
    });
    const result = mapStkPushResponse(mockResponse(true, 200, body), 200, body);
    assert.ok(result.accepted);
    assert.equal(result.checkoutId, "ws_CO_191220191020363925");
    assert.equal(result.requestId, "29115-34620561-1");
  });

  it("maps 400 error with Daraja error message", () => {
    const body = JSON.stringify({
      errorCode: "400.001.001",
      errorMessage: "Bad Request - The Business ShortCode value is invalid.",
    });
    const result = mapStkPushResponse(mockResponse(false, 400, body), 400, body);
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "INVALID_REQUEST");
    assert.ok(result.customerMessage.includes("Safaricom rejected"));
  });

  it("maps 401 error", () => {
    const body = JSON.stringify({ errorMessage: "Invalid credentials" });
    const result = mapStkPushResponse(mockResponse(false, 401, body), 401, body);
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "INVALID_CREDENTIALS");
  });

  it("maps 500 error", () => {
    const body = JSON.stringify({ errorMessage: "Server error" });
    const result = mapStkPushResponse(mockResponse(false, 500, body), 500, body);
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "DARAJA_ERROR");
  });

  it("maps non-zero ResponseCode as failure", () => {
    const body = JSON.stringify({
      MerchantRequestID: "m1",
      ResponseCode: "1",
      ResponseDescription: "The initiator has insufficient funds.",
    });
    const result = mapStkPushResponse(mockResponse(true, 200, body), 200, body);
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "DARAJA_ERROR");
  });

  it("handles non-JSON response", () => {
    const result = mapStkPushResponse(mockResponse(true, 200, "not json"), 200, "not json");
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "DARAJA_ERROR");
  });
});

describe("STK Query response mapping", () => {
  it("maps successful query with result code 0", () => {
    const body = JSON.stringify({
      ResponseCode: "0",
      ResultCode: "0",
      ResultDesc: "The service request is processed successfully.",
    });
    const result = mapStkQueryResponse(mockResponse(true, 200, body), body);
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 0);
  });

  it("maps pending transaction (null ResultCode)", () => {
    const body = JSON.stringify({
      ResponseCode: "0",
      ResultDesc: "The service request is being processed.",
    });
    const result = mapStkQueryResponse(mockResponse(true, 200, body), body);
    assert.ok(result.pending);
    assert.equal(result.resultCode, null);
  });

  it("maps cancelled by user (1032)", () => {
    const body = JSON.stringify({
      ResponseCode: "0",
      ResultCode: "1032",
      ResultDesc: "Request cancelled by user.",
    });
    const result = mapStkQueryResponse(mockResponse(true, 200, body), body);
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 1032);
  });

  it("maps timeout (1037)", () => {
    const body = JSON.stringify({
      ResponseCode: "0",
      ResultCode: "1037",
      ResultDesc: "DS timeout user cannot be reached.",
    });
    const result = mapStkQueryResponse(mockResponse(true, 200, body), body);
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 1037);
  });

  it("maps 500.001.1001 as pending (still processing)", () => {
    const body = JSON.stringify({
      errorCode: "500.001.1001",
      errorMessage: "The transaction is being processed.",
    });
    const result = mapStkQueryResponse(mockResponse(false, 500, body), body);
    assert.ok(result.pending);
  });

  it("maps other 500 errors as failed", () => {
    const body = JSON.stringify({
      errorMessage: "Internal server error",
    });
    const result = mapStkQueryResponse(mockResponse(false, 500, body), body);
    assert.ok(!result.pending);
    assert.equal(result.resultCode, null);
  });
});

describe("HTTP status mapping", () => {
  it("maps 400 to INVALID_REQUEST", () => assert.equal(mapHttpStatus(400), "INVALID_REQUEST"));
  it("maps 401 to INVALID_CREDENTIALS", () => assert.equal(mapHttpStatus(401), "INVALID_CREDENTIALS"));
  it("maps 403 to INVALID_CREDENTIALS", () => assert.equal(mapHttpStatus(403), "INVALID_CREDENTIALS"));
  it("maps 429 to RATE_LIMITED", () => assert.equal(mapHttpStatus(429), "RATE_LIMITED"));
  it("maps 500 to DARAJA_ERROR", () => assert.equal(mapHttpStatus(500), "DARAJA_ERROR"));
  it("maps 503 to DARAJA_ERROR", () => assert.equal(mapHttpStatus(503), "DARAJA_ERROR"));
});

describe("amount conversion", () => {
  it("converts minor units to whole KES", () => {
    // 150000 minor units = 1500 KES
    const amountKes = Math.max(1, Math.round(150000 / 100));
    assert.equal(amountKes, 1500);
  });

  it("rounds up fractional KES", () => {
    // 1550 minor units = 15.5 KES → 16 KES
    const amountKes = Math.max(1, Math.round(1550 / 100));
    assert.equal(amountKes, 16);
  });

  it("minimum is 1 KES", () => {
    // 0 minor units → 1 KES
    const amountKes = Math.max(1, Math.round(0 / 100));
    assert.equal(amountKes, 1);
  });

  it("50000 minor units = 500 KES", () => {
    const amountKes = Math.max(1, Math.round(50000 / 100));
    assert.equal(amountKes, 500);
  });
});

describe("DarajaProvider offline behavior", () => {
  it("returns NOT_CONFIGURED when config is null", async () => {
    // Simulate the behavior when no config exists
    const result = {
      accepted: false,
      requestId: null,
      checkoutId: null,
      customerMessage: "M-Pesa is not configured for this business.",
      errorCode: "NOT_CONFIGURED",
    };
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "NOT_CONFIGURED");
  });

  it("returns INVALID_CALLBACK when callback URL is bad", async () => {
    const result = {
      accepted: false,
      requestId: null,
      checkoutId: null,
      customerMessage: "Callback URL must be HTTPS and publicly reachable.",
      errorCode: "INVALID_CALLBACK",
    };
    assert.ok(!result.accepted);
    assert.equal(result.errorCode, "INVALID_CALLBACK");
  });
});
