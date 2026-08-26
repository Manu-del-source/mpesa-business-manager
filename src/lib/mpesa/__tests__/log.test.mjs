import { describe, it } from "node:test";
import assert from "node:assert/strict";

const SENSITIVE_KEY = /(secret|passkey|password|authorization|token|consumerkey|credential)/i;

function redact(value, depth = 0) {
  if (depth > 4) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

function maskPhone(phone) {
  if (phone.length < 8) return "****";
  return `${phone.slice(0, 4)}****${phone.slice(-4)}`;
}

describe("redact", () => {
  it("passes through primitives unchanged", () => {
    assert.equal(redact("hello"), "hello");
    assert.equal(redact(42), 42);
    assert.equal(redact(true), true);
    assert.equal(redact(null), null);
  });

  it("redacts secret/passkey/password/token keys", () => {
    const input = {
      consumerSecret: "super-secret",
      passkey: "my-passkey",
      password: "my-password",
      ConsumerKey: "ak_123",
      Authorization: "Bearer tok",
      Token: "xyz",
      credential: "cred",
    };
    const result = redact(input);
    assert.equal(result.consumerSecret, "[redacted]");
    assert.equal(result.passkey, "[redacted]");
    assert.equal(result.password, "[redacted]");
    assert.equal(result.ConsumerKey, "[redacted]");
    assert.equal(result.Authorization, "[redacted]");
    assert.equal(result.Token, "[redacted]");
    assert.equal(result.credential, "[redacted]");
  });

  it("preserves non-sensitive keys", () => {
    const input = { phone: "254712345678", amount: 1500, reference: "RCP-123", status: "SUCCESS" };
    const result = redact(input);
    assert.equal(result.phone, "254712345678");
    assert.equal(result.amount, 1500);
    assert.equal(result.reference, "RCP-123");
    assert.equal(result.status, "SUCCESS");
  });

  it("redacts nested sensitive keys", () => {
    const input = { config: { consumerSecret: "secret123", shortcode: "174379" } };
    const result = redact(input);
    assert.equal(result.config.consumerSecret, "[redacted]");
    assert.equal(result.config.shortcode, "174379");
  });

  it("redacts in arrays", () => {
    const input = [{ passkey: "key1", name: "test" }, { name: "safe", token: "tok" }];
    const result = redact(input);
    assert.equal(result[0].passkey, "[redacted]");
    assert.equal(result[0].name, "test");
    assert.equal(result[1].token, "[redacted]");
  });

  it("is case-insensitive for sensitive keys", () => {
    assert.equal(redact({ SECRET: "val" }).SECRET, "[redacted]");
    assert.equal(redact({ PassKey: "val" }).PassKey, "[redacted]");
  });
});

describe("maskPhone", () => {
  it("masks standard Kenyan number", () => assert.equal(maskPhone("254712345678"), "2547****5678"));
  it("masks 10-digit number", () => assert.equal(maskPhone("0712345678"), "0712****5678"));
  it("returns **** for very short strings", () => {
    assert.equal(maskPhone("123"), "****");
    assert.equal(maskPhone("1234567"), "****");
  });
  it("preserves first 4 and last 4", () => assert.equal(maskPhone("ABCDEFGH"), "ABCD****EFGH"));
});
