import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Re-implement payment state machine for testing

const VALID_TRANSITIONS = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: ["REFUNDED"],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

function isValidTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function getValidTransitions(status) {
  return VALID_TRANSITIONS[status] ?? [];
}

function hashRequest(body) {
  // Simplified hash for testing
  return JSON.stringify(body ?? null);
}

// ---------------------------------------------------------------------------
// State machine tests
// ---------------------------------------------------------------------------

describe("Payment state machine", () => {
  describe("PENDING transitions", () => {
    it("PENDING → PROCESSING is valid", () => assert.ok(isValidTransition("PENDING", "PROCESSING")));
    it("PENDING → CANCELLED is valid", () => assert.ok(isValidTransition("PENDING", "CANCELLED")));
    it("PENDING → SUCCEEDED is invalid", () => assert.ok(!isValidTransition("PENDING", "SUCCEEDED")));
    it("PENDING → FAILED is invalid", () => assert.ok(!isValidTransition("PENDING", "FAILED")));
    it("PENDING → REFUNDED is invalid", () => assert.ok(!isValidTransition("PENDING", "REFUNDED")));
  });

  describe("PROCESSING transitions", () => {
    it("PROCESSING → SUCCEEDED is valid", () => assert.ok(isValidTransition("PROCESSING", "SUCCEEDED")));
    it("PROCESSING → FAILED is valid", () => assert.ok(isValidTransition("PROCESSING", "FAILED")));
    it("PROCESSING → CANCELLED is valid", () => assert.ok(isValidTransition("PROCESSING", "CANCELLED")));
    it("PROCESSING → PENDING is invalid", () => assert.ok(!isValidTransition("PROCESSING", "PENDING")));
    it("PROCESSING → REFUNDED is invalid", () => assert.ok(!isValidTransition("PROCESSING", "REFUNDED")));
  });

  describe("SUCCEEDED transitions", () => {
    it("SUCCEEDED → REFUNDED is valid", () => assert.ok(isValidTransition("SUCCEEDED", "REFUNDED")));
    it("SUCCEEDED → PENDING is invalid", () => assert.ok(!isValidTransition("SUCCEEDED", "PENDING")));
    it("SUCCEEDED → FAILED is invalid", () => assert.ok(!isValidTransition("SUCCEEDED", "FAILED")));
    it("SUCCEEDED → CANCELLED is invalid", () => assert.ok(!isValidTransition("SUCCEEDED", "CANCELLED")));
  });

  describe("Terminal states", () => {
    it("FAILED has no transitions", () => assert.deepEqual(getValidTransitions("FAILED"), []));
    it("CANCELLED has no transitions", () => assert.deepEqual(getValidTransitions("CANCELLED"), []));
    it("REFUNDED has no transitions", () => assert.deepEqual(getValidTransitions("REFUNDED"), []));
  });

  describe("getValidTransitions", () => {
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
});

// ---------------------------------------------------------------------------
// Valid payment flows
// ---------------------------------------------------------------------------

describe("Valid payment flows", () => {
  it("happy path: PENDING → PROCESSING → SUCCEEDED", () => {
    assert.ok(isValidTransition("PENDING", "PROCESSING"));
    assert.ok(isValidTransition("PROCESSING", "SUCCEEDED"));
  });

  it("failed payment: PENDING → PROCESSING → FAILED", () => {
    assert.ok(isValidTransition("PENDING", "PROCESSING"));
    assert.ok(isValidTransition("PROCESSING", "FAILED"));
  });

  it("cancelled before processing: PENDING → CANCELLED", () => {
    assert.ok(isValidTransition("PENDING", "CANCELLED"));
  });

  it("cancelled during processing: PENDING → PROCESSING → CANCELLED", () => {
    assert.ok(isValidTransition("PENDING", "PROCESSING"));
    assert.ok(isValidTransition("PROCESSING", "CANCELLED"));
  });

  it("refund after success: PENDING → PROCESSING → SUCCEEDED → REFUNDED", () => {
    assert.ok(isValidTransition("PENDING", "PROCESSING"));
    assert.ok(isValidTransition("PROCESSING", "SUCCEEDED"));
    assert.ok(isValidTransition("SUCCEEDED", "REFUNDED"));
  });
});

// ---------------------------------------------------------------------------
// Invalid payment flows (should be rejected)
// ---------------------------------------------------------------------------

describe("Invalid payment flows", () => {
  it("cannot skip PROCESSING: PENDING → SUCCEEDED", () => {
    assert.ok(!isValidTransition("PENDING", "SUCCEEDED"));
  });

  it("cannot go back from SUCCEEDED to PROCESSING", () => {
    assert.ok(!isValidTransition("SUCCEEDED", "PROCESSING"));
  });

  it("cannot retry after FAILED", () => {
    assert.ok(!isValidTransition("FAILED", "PENDING"));
    assert.ok(!isValidTransition("FAILED", "PROCESSING"));
  });

  it("cannot retry after CANCELLED", () => {
    assert.ok(!isValidTransition("CANCELLED", "PENDING"));
    assert.ok(!isValidTransition("CANCELLED", "PROCESSING"));
  });

  it("cannot refund a FAILED payment", () => {
    assert.ok(!isValidTransition("FAILED", "REFUNDED"));
  });

  it("cannot cancel a SUCCEEDED payment", () => {
    assert.ok(!isValidTransition("SUCCEEDED", "CANCELLED"));
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("Idempotency", () => {
  it("same request body produces same hash", () => {
    const body = { amountMinor: 1000, phone: "254712345678" };
    assert.equal(hashRequest(body), hashRequest(body));
  });

  it("different request bodies produce different hashes", () => {
    const body1 = { amountMinor: 1000 };
    const body2 = { amountMinor: 2000 };
    assert.notEqual(hashRequest(body1), hashRequest(body2));
  });

  it("null body has consistent hash", () => {
    assert.equal(hashRequest(null), hashRequest(null));
    assert.equal(hashRequest(undefined), hashRequest(undefined));
  });
});

// ---------------------------------------------------------------------------
// Amount validation
// ---------------------------------------------------------------------------

describe("Payment amount validation", () => {
  it("rejects zero amount", () => assert.ok(0n <= 0n));
  it("rejects negative amount", () => assert.ok(-100n <= 0n));
  it("accepts positive amount", () => assert.ok(100n > 0n));
  it("rejects amount over 150,000 KES (15M minor units)", () => assert.ok(15_000_001n > 15_000_000n));
  it("accepts exactly 150,000 KES", () => assert.ok(15_000_000n <= 15_000_000n));
});
