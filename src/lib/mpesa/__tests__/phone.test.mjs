import { describe, it } from "node:test";
import assert from "node:assert/strict";

function normalizePhone(phone) {
  const digits = phone.replace(/[^\d]/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

function isValidMpesaPhone(phone) {
  return normalizePhone(phone) !== null;
}

describe("normalizePhone", () => {
  describe("local format (07XX)", () => {
    it("normalizes 0712345678 to 254712345678", () => {
      assert.equal(normalizePhone("0712345678"), "254712345678");
    });
    it("normalizes 0722 345 678 (with spaces)", () => {
      assert.equal(normalizePhone("0722 345 678"), "254722345678");
    });
    it("normalizes 0733-456-789 (with dashes)", () => {
      assert.equal(normalizePhone("0733-456-789"), "254733456789");
    });
    it("normalizes 0112345678 (011 prefix)", () => {
      assert.equal(normalizePhone("0112345678"), "254112345678");
    });
    it("normalizes 0101234567 (010 prefix)", () => {
      assert.equal(normalizePhone("0101234567"), "254101234567");
    });
  });

  describe("international format (254XX)", () => {
    it("keeps 254712345678 as-is", () => {
      assert.equal(normalizePhone("254712345678"), "254712345678");
    });
    it("normalizes +254712345678 (strips +)", () => {
      assert.equal(normalizePhone("+254712345678"), "254712345678");
    });
    it("normalizes 254 712 345 678 (with spaces)", () => {
      assert.equal(normalizePhone("254 712 345 678"), "254712345678");
    });
  });

  describe("bare format (7XXXXXXXX)", () => {
    it("normalizes 712345678 to 254712345678", () => {
      assert.equal(normalizePhone("712345678"), "254712345678");
    });
    it("normalizes 112345678 to 254112345678", () => {
      assert.equal(normalizePhone("112345678"), "254112345678");
    });
  });

  describe("invalid numbers", () => {
    it("rejects empty string", () => {
      assert.equal(normalizePhone(""), null);
    });
    it("rejects too short", () => {
      assert.equal(normalizePhone("071234"), null);
    });
    it("rejects too long", () => {
      assert.equal(normalizePhone("071234567890"), null);
    });
    it("rejects non-Kenyan prefix (05XX)", () => {
      assert.equal(normalizePhone("0512345678"), null);
    });
    it("rejects alphabetic input", () => {
      assert.equal(normalizePhone("abc"), null);
    });
    it("rejects 08XX prefix", () => {
      assert.equal(normalizePhone("0812345678"), null);
    });
  });
});

describe("isValidMpesaPhone", () => {
  it("returns true for valid numbers", () => {
    assert.equal(isValidMpesaPhone("0712345678"), true);
    assert.equal(isValidMpesaPhone("254712345678"), true);
    assert.equal(isValidMpesaPhone("712345678"), true);
  });
  it("returns false for invalid numbers", () => {
    assert.equal(isValidMpesaPhone(""), false);
    assert.equal(isValidMpesaPhone("123"), false);
    assert.equal(isValidMpesaPhone("0512345678"), false);
  });
});
