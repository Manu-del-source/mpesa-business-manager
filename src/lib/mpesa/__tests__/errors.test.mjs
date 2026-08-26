import { describe, it } from "node:test";
import assert from "node:assert/strict";

const USER_MESSAGES = {
  NOT_CONFIGURED: "M-Pesa is not configured for this business yet. Add your Daraja credentials in M-Pesa settings.",
  DISABLED: "M-Pesa payments are switched off for this business. Enable them in M-Pesa settings.",
  INVALID_CREDENTIALS: "Safaricom rejected your Daraja credentials. Check the consumer key and secret in M-Pesa settings.",
  AUTH_FAILED: "Could not authenticate with Safaricom. Please try again in a moment.",
  NETWORK: "Could not reach Safaricom. Check your internet connection and try again.",
  TIMEOUT: "Safaricom took too long to respond. Please try again.",
  RATE_LIMITED: "Too many M-Pesa requests. Wait a few seconds and try again.",
  INVALID_REQUEST: "Safaricom rejected the payment request. Check the phone number and amount.",
  DARAJA_ERROR: "Safaricom could not process this request. Please try again.",
  UNKNOWN: "Something went wrong with the M-Pesa request. Please try again.",
};

class DarajaError extends Error {
  constructor(code, options = {}) {
    super(options.detail ?? USER_MESSAGES[code]);
    this.name = "DarajaError";
    this.code = code;
    this.userMessage = options.userMessage ?? USER_MESSAGES[code];
    this.detail = options.detail;
    this.status = options.status;
  }
}

function toDarajaError(err) {
  if (err instanceof DarajaError) return err;
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError")
      return new DarajaError("TIMEOUT", { detail: err.message });
    if (err.name === "TypeError" || /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(err.message))
      return new DarajaError("NETWORK", { detail: err.message });
    return new DarajaError("UNKNOWN", { detail: err.message });
  }
  return new DarajaError("UNKNOWN", { detail: String(err) });
}

function codeForStatus(status) {
  if (status === 400) return "INVALID_REQUEST";
  if (status === 401 || status === 403) return "INVALID_CREDENTIALS";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "DARAJA_ERROR";
  return "DARAJA_ERROR";
}

describe("DarajaError", () => {
  it("creates error with code and default message", () => {
    const err = new DarajaError("TIMEOUT");
    assert.equal(err.code, "TIMEOUT");
    assert.equal(err.userMessage, USER_MESSAGES.TIMEOUT);
    assert.equal(err.name, "DarajaError");
    assert.ok(err instanceof Error);
  });

  it("uses detail as message when provided", () => {
    const err = new DarajaError("NETWORK", { detail: "Connection refused" });
    assert.equal(err.message, "Connection refused");
    assert.equal(err.detail, "Connection refused");
  });

  it("preserves custom userMessage", () => {
    const err = new DarajaError("UNKNOWN", { userMessage: "Custom message", detail: "internal detail" });
    assert.equal(err.userMessage, "Custom message");
    assert.equal(err.message, "internal detail");
  });

  it("preserves HTTP status", () => {
    const err = new DarajaError("INVALID_REQUEST", { status: 400 });
    assert.equal(err.status, 400);
  });
});

describe("toDarajaError", () => {
  it("passes through DarajaError unchanged", () => {
    const original = new DarajaError("TIMEOUT");
    assert.equal(toDarajaError(original), original);
  });

  it("converts TimeoutError to TIMEOUT", () => {
    const err = new Error("request timed out");
    err.name = "TimeoutError";
    assert.equal(toDarajaError(err).code, "TIMEOUT");
  });

  it("converts AbortError to TIMEOUT", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    assert.equal(toDarajaError(err).code, "TIMEOUT");
  });

  it("converts fetch TypeError to NETWORK", () => {
    const err = new TypeError("fetch failed");
    assert.equal(toDarajaError(err).code, "NETWORK");
  });

  it("converts ENOTFOUND to NETWORK", () => {
    const err = new Error("getaddrinfo ENOTFOUND api.safaricom.co.ke");
    assert.equal(toDarajaError(err).code, "NETWORK");
  });

  it("converts ECONNREFUSED to NETWORK", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:443");
    assert.equal(toDarajaError(err).code, "NETWORK");
  });

  it("converts unknown Error to UNKNOWN", () => {
    const err = new Error("something weird");
    const result = toDarajaError(err);
    assert.equal(result.code, "UNKNOWN");
    assert.equal(result.detail, "something weird");
  });

  it("converts non-Error values to UNKNOWN", () => {
    assert.equal(toDarajaError("string error").code, "UNKNOWN");
    assert.equal(toDarajaError(42).code, "UNKNOWN");
    assert.equal(toDarajaError(null).code, "UNKNOWN");
  });
});

describe("codeForStatus", () => {
  it("maps 400 to INVALID_REQUEST", () => assert.equal(codeForStatus(400), "INVALID_REQUEST"));
  it("maps 401 to INVALID_CREDENTIALS", () => assert.equal(codeForStatus(401), "INVALID_CREDENTIALS"));
  it("maps 403 to INVALID_CREDENTIALS", () => assert.equal(codeForStatus(403), "INVALID_CREDENTIALS"));
  it("maps 429 to RATE_LIMITED", () => assert.equal(codeForStatus(429), "RATE_LIMITED"));
  it("maps 500 to DARAJA_ERROR", () => assert.equal(codeForStatus(500), "DARAJA_ERROR"));
  it("maps 503 to DARAJA_ERROR", () => assert.equal(codeForStatus(503), "DARAJA_ERROR"));
  it("maps 200 to DARAJA_ERROR", () => assert.equal(codeForStatus(200), "DARAJA_ERROR"));
});
