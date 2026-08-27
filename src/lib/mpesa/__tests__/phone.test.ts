/**
 * Phone normalization tests — importing the PRODUCTION normalizePhone /
 * isValidMpesaPhone from src/lib/mpesa/index.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizePhone, isValidMpesaPhone } from "@/lib/mpesa";

describe("normalizePhone (production)", () => {
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
  });

  describe("international format", () => {
    it("passes through +254712345678", () => {
      assert.equal(normalizePhone("+254712345678"), "254712345678");
    });
    it("passes through 254712345678", () => {
      assert.equal(normalizePhone("254712345678"), "254712345678");
    });
    it("normalizes 254 712 345 678 (with spaces)", () => {
      assert.equal(normalizePhone("254 712 345 678"), "254712345678");
    });
  });

  describe("short local format (7XX)", () => {
    it("normalizes 712345678 to 254712345678", () => {
      assert.equal(normalizePhone("712345678"), "254712345678");
    });
    it("normalizes 112345678 to 254112345678", () => {
      assert.equal(normalizePhone("112345678"), "254112345678");
    });
  });

  describe("invalid inputs", () => {
    it("returns null for landlines", () => assert.equal(normalizePhone("0201234567"), null));
    it("returns null for too-short numbers", () => assert.equal(normalizePhone("07123456"), null));
    it("returns null for too-long numbers", () => assert.equal(normalizePhone("071234567890"), null));
    it("returns null for garbage", () => assert.equal(normalizePhone("not-a-phone"), null));
    it("returns null for empty", () => assert.equal(normalizePhone(""), null));
  });
});

describe("isValidMpesaPhone (production)", () => {
  it("accepts valid phones", () => {
    assert.ok(isValidMpesaPhone("0712345678"));
    assert.ok(isValidMpesaPhone("+254712345678"));
  });
  it("rejects invalid phones", () => {
    assert.ok(!isValidMpesaPhone("0201234567"));
    assert.ok(!isValidMpesaPhone(""));
  });
});
