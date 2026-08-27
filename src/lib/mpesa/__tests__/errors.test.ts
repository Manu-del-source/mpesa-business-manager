/**
 * Daraja error mapping tests — importing the PRODUCTION toDarajaError /
 * codeForStatus / userMessageFor from src/lib/mpesa/errors.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DarajaError,
  toDarajaError,
  codeForStatus,
  userMessageFor,
} from "@/lib/mpesa/errors";

describe("codeForStatus (production)", () => {
  it("maps 400 to INVALID_REQUEST", () => assert.equal(codeForStatus(400), "INVALID_REQUEST"));
  it("maps 401 to INVALID_CREDENTIALS", () => assert.equal(codeForStatus(401), "INVALID_CREDENTIALS"));
  it("maps 403 to INVALID_CREDENTIALS", () => assert.equal(codeForStatus(403), "INVALID_CREDENTIALS"));
  it("maps 429 to RATE_LIMITED", () => assert.equal(codeForStatus(429), "RATE_LIMITED"));
  it("maps all 5xx to DARAJA_ERROR (network failures are typed by toDarajaError)", () => {
    assert.equal(codeForStatus(500), "DARAJA_ERROR");
    assert.equal(codeForStatus(502), "DARAJA_ERROR");
    assert.equal(codeForStatus(503), "DARAJA_ERROR");
    assert.equal(codeForStatus(504), "DARAJA_ERROR");
  });
  it("maps unknown statuses to DARAJA_ERROR (fail closed, never silently OK)", () => {
    assert.equal(codeForStatus(599), "DARAJA_ERROR");
    assert.equal(codeForStatus(302), "DARAJA_ERROR");
  });
});

describe("toDarajaError (production)", () => {
  it("passes through DarajaError instances", () => {
    const original = new DarajaError("RATE_LIMITED", { detail: "custom" });
    const mapped = toDarajaError(original);
    assert.equal(mapped, original);
  });

  it("maps abort/timeout errors to TIMEOUT", () => {
    const abortish = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const mapped = toDarajaError(abortish);
    assert.equal(mapped.code, "TIMEOUT");
  });

  it("maps network errors to NETWORK", () => {
    const mapped = toDarajaError(new TypeError("fetch failed"));
    assert.equal(mapped.code, "NETWORK");
  });

  it("maps generic errors to UNKNOWN", () => {
    const mapped = toDarajaError(new Error("whatever"));
    assert.equal(mapped.code, "UNKNOWN");
  });

  it("maps non-error throws to UNKNOWN", () => {
    const mapped = toDarajaError("a string");
    assert.equal(mapped.code, "UNKNOWN");
  });
});

describe("userMessageFor (production)", () => {
  it("returns a user-safe message for every code", () => {
    for (const code of [
      "NOT_CONFIGURED",
      "DISABLED",
      "INVALID_CREDENTIALS",
      "AUTH_FAILED",
      "NETWORK",
      "TIMEOUT",
      "RATE_LIMITED",
      "INVALID_REQUEST",
      "DARAJA_ERROR",
      "UNKNOWN",
    ] as const) {
      const message = userMessageFor(code);
      assert.ok(typeof message === "string" && message.length > 0);
      // never leaks credential VALUES (field NAMES in instructions are fine)
      assert.ok(!/Bearer\s|sk_(live|test)_|whsec_/i.test(message), message);
    }
  });
});
