/**
 * M-Pesa callback authentication tests — importing the PRODUCTION
 * authenticateCallback / safeTokenEqual / extractCallbackToken from
 * src/lib/mpesa/callback-auth.ts.
 *
 * Required matrix:
 *   production + missing token config → REJECT (fail closed)
 *   production + invalid token        → REJECT
 *   production + valid token          → ACCEPT
 *   development + no config           → ACCEPT (unguessable URL is the control)
 *   development + configured token    → enforced like production
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  authenticateCallback,
  safeTokenEqual,
  extractCallbackToken,
} from "@/lib/mpesa/callback-auth";

type MutableEnv = Record<string, string | undefined>;
const env = process.env as MutableEnv;

const ORIGINAL_ENV: MutableEnv = {
  MPESA_CALLBACK_TOKEN: process.env.MPESA_CALLBACK_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
};

beforeEach(() => {
  env.MPESA_CALLBACK_TOKEN = "";
  env.NODE_ENV = "test";
});

afterEach(() => {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

describe("authenticateCallback (production, fail closed)", () => {
  it("PRODUCTION + missing token config → rejects ALL callbacks", () => {
    env.NODE_ENV = "production";
    delete env.MPESA_CALLBACK_TOKEN;
    const r = authenticateCallback("anything");
    assert.ok(!r.ok);
    if (!r.ok) {
      assert.equal(r.reason, "MISSING_TOKEN_CONFIG");
      assert.match(r.detail, /MPESA_CALLBACK_TOKEN/);
    }
  });

  it("PRODUCTION + no token presented + config exists → rejects", () => {
    env.NODE_ENV = "production";
    env.MPESA_CALLBACK_TOKEN = "sekret";
    const missing = authenticateCallback(null);
    assert.ok(!missing.ok);
    if (!missing.ok) assert.equal(missing.reason, "MISSING_TOKEN");

    const empty = authenticateCallback("");
    assert.ok(!empty.ok);
    if (!empty.ok) assert.equal(empty.reason, "MISSING_TOKEN");
  });

  it("PRODUCTION + invalid token → rejects", () => {
    env.NODE_ENV = "production";
    env.MPESA_CALLBACK_TOKEN = "sekret";
    const r = authenticateCallback("wrong-token");
    assert.ok(!r.ok);
    if (!r.ok) assert.equal(r.reason, "INVALID_TOKEN");
  });

  it("PRODUCTION + valid token → accepts", () => {
    env.NODE_ENV = "production";
    env.MPESA_CALLBACK_TOKEN = "sekret";
    const r = authenticateCallback("sekret");
    assert.ok(r.ok);
  });

  it("DEVELOPMENT + no token configured → accepts (sandbox behavior)", () => {
    env.NODE_ENV = "development";
    delete env.MPESA_CALLBACK_TOKEN;
    assert.ok(authenticateCallback(null).ok);
    assert.ok(authenticateCallback("whatever").ok);
  });

  it("DEVELOPMENT + token configured → enforced exactly like production", () => {
    env.NODE_ENV = "development";
    env.MPESA_CALLBACK_TOKEN = "dev-token";
    assert.ok(!authenticateCallback(null).ok);
    assert.ok(!authenticateCallback("nope").ok);
    assert.ok(authenticateCallback("dev-token").ok);
  });

  it("never includes the token value in rejection details", () => {
    env.NODE_ENV = "production";
    env.MPESA_CALLBACK_TOKEN = "super-secret-value";
    const r = authenticateCallback("wrong");
    if (!r.ok) {
      assert.ok(!r.detail.includes("super-secret-value"));
      assert.ok(!r.reason.includes("super-secret-value"));
    }
  });
});

describe("safeTokenEqual (production, constant-time comparison)", () => {
  it("returns true for identical strings", () => assert.ok(safeTokenEqual("abc123", "abc123")));
  it("returns false for different strings", () => assert.ok(!safeTokenEqual("abc123", "abc124")));
  it("returns false for different lengths", () => assert.ok(!safeTokenEqual("abc", "abcd")));
  it("returns false for empty vs non-empty", () => {
    assert.ok(!safeTokenEqual("", "a"));
    assert.ok(!safeTokenEqual("a", ""));
  });
  it("empty vs empty is equal", () => assert.ok(safeTokenEqual("", "")));
});

describe("extractCallbackToken (production)", () => {
  it("extracts the token from the query string", () => {
    assert.equal(extractCallbackToken("https://app.example.com/api/mpesa/callback?token=abc"), "abc");
    assert.equal(extractCallbackToken("https://x/y?other=1&token=zzz"), "zzz");
  });
  it("returns null when absent", () => {
    assert.equal(extractCallbackToken("https://app.example.com/api/mpesa/callback"), null);
    assert.equal(extractCallbackToken("https://x/y?other=1"), null);
  });
  it("returns null for a malformed URL", () => {
    assert.equal(extractCallbackToken("not a url"), null);
  });
});
