/**
 * Payout & refund domain unit tests — importing the PRODUCTION functions
 * (no parallel reimplementations). DB-backed idempotency/concurrency
 * scenarios live in tests/integration/payouts.test.ts and
 * tests/integration/refunds.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isValidTransition as isValidPayoutTransition,
  getValidTransitions as getValidPayoutTransitions,
  validatePayoutAmount,
  isValidPayoutPhone,
  MAX_PAYOUT_MINOR,
  decodePayoutCursor,
} from "@/lib/payouts";
import {
  isValidRefundTransition,
  getValidRefundTransitions,
} from "@/lib/refunds";

// ---------------------------------------------------------------------------
// Payout state machine (production)
// ---------------------------------------------------------------------------

describe("Payout state machine (production)", () => {
  it("PENDING → PROCESSING is valid", () => assert.ok(isValidPayoutTransition("PENDING", "PROCESSING")));
  it("PENDING → CANCELLED is valid", () => assert.ok(isValidPayoutTransition("PENDING", "CANCELLED")));
  it("PENDING → SUCCEEDED is invalid (cannot skip PROCESSING)", () => assert.ok(!isValidPayoutTransition("PENDING", "SUCCEEDED")));
  it("PENDING → FAILED is invalid", () => assert.ok(!isValidPayoutTransition("PENDING", "FAILED")));

  it("PROCESSING → SUCCEEDED is valid", () => assert.ok(isValidPayoutTransition("PROCESSING", "SUCCEEDED")));
  it("PROCESSING → FAILED is valid", () => assert.ok(isValidPayoutTransition("PROCESSING", "FAILED")));
  it("PROCESSING → PENDING is invalid", () => assert.ok(!isValidPayoutTransition("PROCESSING", "PENDING")));
  it("PROCESSING → CANCELLED is invalid", () => assert.ok(!isValidPayoutTransition("PROCESSING", "CANCELLED")));

  it("SUCCEEDED is terminal (no COMPLETED → PENDING / FAILED)", () => {
    assert.deepEqual(getValidPayoutTransitions("SUCCEEDED"), []);
    assert.ok(!isValidPayoutTransition("SUCCEEDED", "PENDING"));
    assert.ok(!isValidPayoutTransition("SUCCEEDED", "FAILED"));
    assert.ok(!isValidPayoutTransition("SUCCEEDED", "CANCELLED"));
  });
  it("FAILED is terminal (no FAILED → COMPLETED/SUCCEEDED)", () => {
    assert.deepEqual(getValidPayoutTransitions("FAILED"), []);
    assert.ok(!isValidPayoutTransition("FAILED", "SUCCEEDED"));
    assert.ok(!isValidPayoutTransition("FAILED", "PENDING"));
    assert.ok(!isValidPayoutTransition("FAILED", "PROCESSING"));
  });
  it("CANCELLED is terminal", () => {
    assert.deepEqual(getValidPayoutTransitions("CANCELLED"), []);
  });

  it("valid flows", () => {
    // happy path
    assert.ok(isValidPayoutTransition("PENDING", "PROCESSING"));
    assert.ok(isValidPayoutTransition("PROCESSING", "SUCCEEDED"));
    // provider failure path
    assert.ok(isValidPayoutTransition("PENDING", "PROCESSING"));
    assert.ok(isValidPayoutTransition("PROCESSING", "FAILED"));
    // cancel before dispatch
    assert.ok(isValidPayoutTransition("PENDING", "CANCELLED"));
  });

  it("unknown status has no transitions", () => {
    assert.ok(!isValidPayoutTransition("UNKNOWN" as never, "PENDING"));
    assert.deepEqual(getValidPayoutTransitions("UNKNOWN" as never), []);
  });
});

// ---------------------------------------------------------------------------
// Payout validation (production)
// ---------------------------------------------------------------------------

describe("validatePayoutAmount (production policy)", () => {
  it("accepts positive amounts within the limit", () => {
    assert.equal(validatePayoutAmount(100n), null);
    assert.equal(validatePayoutAmount(MAX_PAYOUT_MINOR), null);
    assert.equal(validatePayoutAmount(MAX_PAYOUT_MINOR, "KES"), null);
  });
  it("rejects zero and negative", () => {
    assert.ok(validatePayoutAmount(0n));
    assert.ok(validatePayoutAmount(-1n));
  });
  it("rejects amounts over the per-transaction limit", () => {
    const r = validatePayoutAmount(MAX_PAYOUT_MINOR + 1n);
    assert.ok(r);
    assert.equal(r?.code, "INVALID_AMOUNT");
  });
  it("rejects invalid currency", () => {
    const r = validatePayoutAmount(100n, "KES1");
    assert.ok(r);
    assert.equal(r?.code, "INVALID_CURRENCY");
  });
});

describe("isValidPayoutPhone (production MSISDN validation)", () => {
  it("accepts valid Kenyan MSISDNs", () => {
    assert.ok(isValidPayoutPhone("254712345678"));
    assert.ok(isValidPayoutPhone("254112345678"));
    assert.ok(isValidPayoutPhone("+254712345678"));
  });
  it("rejects invalid phones", () => {
    assert.ok(!isValidPayoutPhone("0712345678")); // local format (0-prefixed)
    assert.ok(!isValidPayoutPhone("254212345678")); // not a mobile prefix
    assert.ok(!isValidPayoutPhone("25471234567")); // too short
    assert.ok(!isValidPayoutPhone("2547123456789")); // too long
    assert.ok(!isValidPayoutPhone(""));
    assert.ok(!isValidPayoutPhone("abc"));
  });
});

describe("decodePayoutCursor (production)", () => {
  it("round-trips createdAt|id", () => {
    const createdAt = new Date("2026-02-03T04:05:06.789Z");
    const cursor = Buffer.from(`${createdAt.toISOString()}|po_1`, "utf8").toString("base64url");
    const parsed = decodePayoutCursor(cursor);
    assert.ok(parsed.ok);
    if (parsed.ok) assert.equal(parsed.id, "po_1");
  });
  it("rejects malformed cursors", () => {
    assert.ok(!decodePayoutCursor("!!!").ok);
    assert.ok(!decodePayoutCursor(Buffer.from("nope").toString("base64url")).ok);
  });
});

// ---------------------------------------------------------------------------
// Refund state machine (production)
// ---------------------------------------------------------------------------

describe("Refund state machine (production)", () => {
  it("PENDING → PROCESSING is valid", () => assert.ok(isValidRefundTransition("PENDING", "PROCESSING")));
  it("PENDING → CANCELLED is valid", () => assert.ok(isValidRefundTransition("PENDING", "CANCELLED")));
  it("PENDING → SUCCEEDED is invalid", () => assert.ok(!isValidRefundTransition("PENDING", "SUCCEEDED")));

  it("PROCESSING → SUCCEEDED is valid", () => assert.ok(isValidRefundTransition("PROCESSING", "SUCCEEDED")));
  it("PROCESSING → FAILED is valid", () => assert.ok(isValidRefundTransition("PROCESSING", "FAILED")));
  it("PROCESSING → PENDING is invalid", () => assert.ok(!isValidRefundTransition("PROCESSING", "PENDING")));

  it("SUCCEEDED is terminal — a completed refund can never be re-refunded", () => {
    assert.deepEqual(getValidRefundTransitions("SUCCEEDED"), []);
    assert.ok(!isValidRefundTransition("SUCCEEDED", "PENDING"));
    assert.ok(!isValidRefundTransition("SUCCEEDED", "PROCESSING"));
    assert.ok(!isValidRefundTransition("SUCCEEDED", "SUCCEEDED"));
  });
  it("FAILED is terminal — retry is a NEW refund with a NEW key", () => {
    assert.deepEqual(getValidRefundTransitions("FAILED"), []);
    assert.ok(!isValidRefundTransition("FAILED", "PROCESSING"));
    assert.ok(!isValidRefundTransition("FAILED", "SUCCEEDED"));
  });
  it("CANCELLED is terminal", () => {
    assert.deepEqual(getValidRefundTransitions("CANCELLED"), []);
  });

  it("valid flows", () => {
    assert.ok(isValidRefundTransition("PENDING", "PROCESSING"));
    assert.ok(isValidRefundTransition("PROCESSING", "SUCCEEDED"));
    assert.ok(isValidRefundTransition("PENDING", "PROCESSING"));
    assert.ok(isValidRefundTransition("PROCESSING", "FAILED"));
  });

  it("unknown status has no transitions", () => {
    assert.ok(!isValidRefundTransition("UNKNOWN" as never, "PENDING"));
    assert.deepEqual(getValidRefundTransitions("UNKNOWN" as never), []);
  });
});
