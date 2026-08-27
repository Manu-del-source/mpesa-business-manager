/**
 * Credential-safe logging tests — importing the PRODUCTION redact /
 * maskPhone from src/lib/mpesa/log.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { redact, maskPhone } from "@/lib/mpesa/log";

describe("redact (production — secrets never logged)", () => {
  it("passes through primitives unchanged", () => {
    assert.equal(redact("hello"), "hello");
    assert.equal(redact(42), 42);
    assert.equal(redact(true), true);
    assert.equal(redact(null), null);
  });

  it("redacts secret/passkey/password/token keys", () => {
    const out = redact({
      consumerSecret: "super-secret",
      passkey: "my-passkey",
      password: "my-password",
      ConsumerKey: "ak_123",
      Authorization: "Bearer tok",
      Token: "xyz",
      credentials: "stuff",
    }) as Record<string, string>;
    for (const key of ["consumerSecret", "passkey", "password", "ConsumerKey", "Authorization", "Token", "credentials"]) {
      assert.equal(out[key], "[redacted]", `${key} not redacted`);
    }
  });

  it("redacts nested objects", () => {
    const out = redact({ outer: { accessToken: "t", keep: "v" } }) as {
      outer: Record<string, string>;
    };
    assert.equal(out.outer.accessToken, "[redacted]");
    assert.equal(out.outer.keep, "v");
  });

  it("redacts arrays", () => {
    const out = redact([{ apiKey: "k" }, { safe: 1 }]) as Array<Record<string, unknown>>;
    assert.equal(out[0]!.apiKey, "[redacted]");
    assert.equal(out[1]!.safe, 1);
  });

  it("caps depth to bound pathological objects", () => {
    const out = redact({ a: { b: { c: { d: { e: { f: 1 } } } } } });
    assert.ok(JSON.stringify(out).includes("[depth-limit]"));
  });
});

describe("maskPhone (production)", () => {
  it("masks the middle of an MSISDN", () => {
    assert.equal(maskPhone("254712345678"), "2547****5678");
  });
  it("fully masks short values", () => {
    assert.equal(maskPhone("1234"), "****");
    assert.equal(maskPhone(""), "****");
  });
});
