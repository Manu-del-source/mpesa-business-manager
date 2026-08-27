/**
 * Payment domain unit tests — these import and execute the PRODUCTION
 * functions (no parallel reimplementations):
 *   - state machine: src/lib/payments.ts
 *   - money: src/lib/money.ts
 *   - idempotency hashing: src/lib/idempotency.ts
 *   - cursors: src/lib/payments.ts
 *
 * DB-backed idempotency/concurrency scenarios live in
 * tests/integration/payments.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isValidTransition,
  getValidTransitions,
  validatePaymentAmount,
  MAX_PAYMENT_MINOR,
  decodePaymentCursor,
} from "@/lib/payments";
import {
  parseAmountMinor,
  parseCurrency,
  darajaAmountConstraint,
  DARAJA_MAX_TRANSACTION_MINOR,
  MAX_AMOUNT_MINOR,
} from "@/lib/money";
import { hashRequestPayload } from "@/lib/idempotency";

// ---------------------------------------------------------------------------
// State machine (production isValidTransition)
// ---------------------------------------------------------------------------

describe("Payment state machine (production)", () => {
  describe("PENDING transitions", () => {
    it("PENDING → PROCESSING is valid", () => assert.ok(isValidTransition("PENDING", "PROCESSING")));
    it("PENDING → CANCELLED is valid", () => assert.ok(isValidTransition("PENDING", "CANCELLED")));
    it("PENDING → SUCCEEDED is invalid (cannot skip PROCESSING)", () => assert.ok(!isValidTransition("PENDING", "SUCCEEDED")));
    it("PENDING → FAILED is invalid", () => assert.ok(!isValidTransition("PENDING", "FAILED")));
    it("PENDING → REFUNDED is invalid", () => assert.ok(!isValidTransition("PENDING", "REFUNDED")));
  });

  describe("PROCESSING transitions", () => {
    it("PROCESSING → SUCCEEDED is valid", () => assert.ok(isValidTransition("PROCESSING", "SUCCEEDED")));
    it("PROCESSING → FAILED is valid", () => assert.ok(isValidTransition("PROCESSING", "FAILED")));
    it("PROCESSING → CANCELLED is valid", () => assert.ok(isValidTransition("PROCESSING", "CANCELLED")));
    it("PROCESSING → PENDING is invalid (no rollback)", () => assert.ok(!isValidTransition("PROCESSING", "PENDING")));
    it("PROCESSING → REFUNDED is invalid", () => assert.ok(!isValidTransition("PROCESSING", "REFUNDED")));
  });

  describe("SUCCEEDED transitions", () => {
    it("SUCCEEDED → REFUNDED is valid", () => assert.ok(isValidTransition("SUCCEEDED", "REFUNDED")));
    it("SUCCEEDED → PENDING is invalid", () => assert.ok(!isValidTransition("SUCCEEDED", "PENDING")));
    it("SUCCEEDED → PROCESSING is invalid", () => assert.ok(!isValidTransition("SUCCEEDED", "PROCESSING")));
    it("SUCCEEDED → FAILED is invalid", () => assert.ok(!isValidTransition("SUCCEEDED", "FAILED")));
    it("SUCCEEDED → CANCELLED is invalid", () => assert.ok(!isValidTransition("SUCCEEDED", "CANCELLED")));
  });

  describe("Terminal states are frozen", () => {
    it("FAILED has no transitions", () => assert.deepEqual(getValidTransitions("FAILED"), []));
    it("CANCELLED has no transitions", () => assert.deepEqual(getValidTransitions("CANCELLED"), []));
    it("REFUNDED has no transitions", () => assert.deepEqual(getValidTransitions("REFUNDED"), []));
  });

  describe("getValidTransitions (production table)", () => {
    it("returns correct transitions for PENDING", () => {
      assert.deepEqual(getValidTransitions("PENDING"), ["PROCESSING", "CANCELLED"]);
    });
    it("returns correct transitions for PROCESSING", () => {
      assert.deepEqual(getValidTransitions("PROCESSING"), ["SUCCEEDED", "FAILED", "CANCELLED"]);
    });
    it("returns correct transitions for SUCCEEDED", () => {
      assert.deepEqual(getValidTransitions("SUCCEEDED"), ["REFUNDED"]);
    });
  });

  describe("Valid flows", () => {
    it("happy path: PENDING → PROCESSING → SUCCEEDED", () => {
      assert.ok(isValidTransition("PENDING", "PROCESSING"));
      assert.ok(isValidTransition("PROCESSING", "SUCCEEDED"));
    });
    it("failure path: PENDING → PROCESSING → FAILED", () => {
      assert.ok(isValidTransition("PENDING", "PROCESSING"));
      assert.ok(isValidTransition("PROCESSING", "FAILED"));
    });
    it("cancel before processing: PENDING → CANCELLED", () => {
      assert.ok(isValidTransition("PENDING", "CANCELLED"));
    });
    it("cancel during processing: PENDING → PROCESSING → CANCELLED", () => {
      assert.ok(isValidTransition("PENDING", "PROCESSING"));
      assert.ok(isValidTransition("PROCESSING", "CANCELLED"));
    });
    it("refund after success: PENDING → PROCESSING → SUCCEEDED → REFUNDED", () => {
      assert.ok(isValidTransition("PENDING", "PROCESSING"));
      assert.ok(isValidTransition("PROCESSING", "SUCCEEDED"));
      assert.ok(isValidTransition("SUCCEEDED", "REFUNDED"));
    });
  });

  describe("Invalid flows (rejected)", () => {
    it("cannot retry after FAILED", () => {
      assert.ok(!isValidTransition("FAILED", "PENDING"));
      assert.ok(!isValidTransition("FAILED", "PROCESSING"));
      assert.ok(!isValidTransition("FAILED", "SUCCEEDED"));
    });
    it("cannot retry after CANCELLED", () => {
      assert.ok(!isValidTransition("CANCELLED", "PENDING"));
      assert.ok(!isValidTransition("CANCELLED", "PROCESSING"));
    });
    it("cannot refund a FAILED payment", () => assert.ok(!isValidTransition("FAILED", "REFUNDED")));
    it("cannot cancel a SUCCEEDED payment", () => assert.ok(!isValidTransition("SUCCEEDED", "CANCELLED")));
    it("unknown status has no transitions", () => {
      assert.ok(!isValidTransition("UNKNOWN" as never, "PENDING"));
      assert.deepEqual(getValidTransitions("UNKNOWN" as never), []);
    });
  });
});

// ---------------------------------------------------------------------------
// Exact money (production parseAmountMinor / darajaAmountConstraint)
// ---------------------------------------------------------------------------

describe("parseAmountMinor (production, exact money)", () => {
  it("parses decimal strings exactly", () => {
    const r = parseAmountMinor("1549");
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.amountMinor, 1549n);
    assert.equal(parseAmountMinor("0").ok, false); // zero rejected
  });

  it("parses amounts beyond Number.MAX_SAFE_INTEGER exactly as strings", () => {
    const r = parseAmountMinor("9007199254740993");
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.amountMinor, 9007199254740993n);
  });

  it("rejects the same value as a JSON number (already lossy)", () => {
    assert.equal(parseAmountMinor(9007199254740993).ok, false);
  });

  it("rejects non-integer numbers", () => {
    assert.equal(parseAmountMinor(10.5).ok, false);
  });

  it("rejects negative and zero", () => {
    assert.equal(parseAmountMinor("-100").ok, false);
    assert.equal(parseAmountMinor(-1).ok, false);
    assert.equal(parseAmountMinor(0).ok, false);
  });

  it("rejects garbage strings", () => {
    assert.equal(parseAmountMinor("12.50").ok, false);
    assert.equal(parseAmountMinor("1e3").ok, false);
    assert.equal(parseAmountMinor(" 42").ok, false);
    assert.equal(parseAmountMinor("42 ").ok, false);
    assert.equal(parseAmountMinor("0x10").ok, false);
    assert.equal(parseAmountMinor(null).ok, false);
    assert.equal(parseAmountMinor(undefined).ok, false);
  });

  it("normalizes leading zeros to the same exact value", () => {
    assert.deepEqual(parseAmountMinor("007"), parseAmountMinor("7"));
  });

  it("rejects amounts above the BigInt-safe database maximum", () => {
    assert.equal(parseAmountMinor("9223372036854775808").ok, false);
    assert.equal(MAX_AMOUNT_MINOR, 9223372036854775807n);
  });
});

describe("parseCurrency (production)", () => {
  it("accepts valid ISO codes", () => {
    assert.ok(parseCurrency("KES").ok);
    assert.ok(parseCurrency("USD").ok);
  });
  it("rejects invalid codes", () => {
    assert.ok(!parseCurrency("kes").ok);
    assert.ok(!parseCurrency("KE").ok);
    assert.ok(!parseCurrency("KESS").ok);
    assert.ok(!parseCurrency("KES ").ok);
    assert.ok(!parseCurrency(123).ok);
  });
});

describe("darajaAmountConstraint (production — no silent rounding)", () => {
  it("accepts whole-KES amounts", () => {
    const r = darajaAmountConstraint(15_000_000n); // KES 150,000.00
    assert.ok(r.ok);
    assert.equal(r.ok && r.amountKes, 150_000n);
  });

  it("rejects fractional KES instead of rounding", () => {
    const r = darajaAmountConstraint(150n); // KES 1.50
    assert.ok(!r.ok);
  });

  it("rejects amounts above the KES 150,000 per-transaction limit", () => {
    const r = darajaAmountConstraint(15_000_100n);
    assert.ok(!r.ok);
    assert.equal(DARAJA_MAX_TRANSACTION_MINOR, 15_000_000n);
  });

  it("rejects zero and negative", () => {
    assert.ok(!darajaAmountConstraint(0n).ok);
    assert.ok(!darajaAmountConstraint(-100n).ok);
  });
});

describe("validatePaymentAmount (production policy)", () => {
  it("accepts positive amounts within the limit", () => {
    assert.equal(validatePaymentAmount(100n), null);
    assert.equal(validatePaymentAmount(MAX_PAYMENT_MINOR), null);
    assert.equal(validatePaymentAmount(MAX_PAYMENT_MINOR, "KES"), null);
  });
  it("rejects zero and negative", () => {
    assert.ok(validatePaymentAmount(0n));
    assert.ok(validatePaymentAmount(-1n));
  });
  it("rejects amounts over the per-transaction limit", () => {
    const r = validatePaymentAmount(MAX_PAYMENT_MINOR + 1n);
    assert.ok(r);
    assert.equal(r?.code, "INVALID_AMOUNT");
  });
  it("rejects invalid currency", () => {
    const r = validatePaymentAmount(100n, "kes");
    assert.ok(r);
    assert.equal(r?.code, "INVALID_CURRENCY");
  });
});

// ---------------------------------------------------------------------------
// Idempotency request hashing (production hashRequestPayload)
// ---------------------------------------------------------------------------

describe("hashRequestPayload (production, stable hashing)", () => {
  it("same payload → same hash", () => {
    const body = { amountMinor: "1000", phone: "254712345678" };
    assert.equal(hashRequestPayload(body), hashRequestPayload(body));
  });

  it("key order does not matter (canonical JSON)", () => {
    assert.equal(
      hashRequestPayload({ a: 1, b: { c: 2, d: 3 } }),
      hashRequestPayload({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("different payloads → different hashes", () => {
    assert.notEqual(hashRequestPayload({ amountMinor: "1000" }), hashRequestPayload({ amountMinor: "2000" }));
  });

  it("undefined fields are ignored but null is significant", () => {
    assert.equal(hashRequestPayload({ a: 1, b: undefined }), hashRequestPayload({ a: 1 }));
    assert.notEqual(hashRequestPayload({ a: 1, b: null }), hashRequestPayload({ a: 1 }));
  });

  it("amount as string vs BigInt value differs by TYPE (strings used in views)", () => {
    assert.notEqual(hashRequestPayload({ a: 100 }), hashRequestPayload({ a: "100" }));
  });

  it("null and undefined bodies hash consistently", () => {
    assert.equal(hashRequestPayload(null), hashRequestPayload(null));
    assert.equal(hashRequestPayload(undefined), hashRequestPayload(undefined));
  });
});

// ---------------------------------------------------------------------------
// Cursor codec (production decodePaymentCursor)
// ---------------------------------------------------------------------------

describe("decodePaymentCursor (production)", () => {
  it("round-trips createdAt|id", () => {
    const createdAt = new Date("2026-01-02T03:04:05.678Z");
    const cursor = Buffer.from(`${createdAt.toISOString()}|pay_123`, "utf8").toString("base64url");
    const parsed = decodePaymentCursor(cursor);
    assert.ok(parsed.ok);
    if (parsed.ok) {
      assert.equal(parsed.id, "pay_123");
      assert.equal(parsed.createdAt.getTime(), createdAt.getTime());
    }
  });

  it("rejects malformed cursors", () => {
    assert.ok(!decodePaymentCursor("not-base64!").ok);
    assert.ok(!decodePaymentCursor(Buffer.from("no-separator").toString("base64url")).ok);
    assert.ok(!decodePaymentCursor(Buffer.from("not-a-date|x").toString("base64url")).ok);
    assert.ok(!decodePaymentCursor(Buffer.from("|nonexistent").toString("base64url")).ok);
  });
});
