import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// Payout state machine
const PAYOUT_TRANSITIONS = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [], FAILED: [], CANCELLED: [],
};

function isValidPayoutTransition(from, to) {
  return PAYOUT_TRANSITIONS[from]?.includes(to) ?? false;
}

// Refund state machine
const REFUND_TRANSITIONS = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [], FAILED: [], CANCELLED: [],
};

function isValidRefundTransition(from, to) {
  return REFUND_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Payout state machine
// ---------------------------------------------------------------------------

describe("Payout state machine", () => {
  it("PENDING → PROCESSING is valid", () => assert.ok(isValidPayoutTransition("PENDING", "PROCESSING")));
  it("PENDING → CANCELLED is valid", () => assert.ok(isValidPayoutTransition("PENDING", "CANCELLED")));
  it("PENDING → SUCCEEDED is invalid", () => assert.ok(!isValidPayoutTransition("PENDING", "SUCCEEDED")));
  it("PROCESSING → SUCCEEDED is valid", () => assert.ok(isValidPayoutTransition("PROCESSING", "SUCCEEDED")));
  it("PROCESSING → FAILED is valid", () => assert.ok(isValidPayoutTransition("PROCESSING", "FAILED")));
  it("SUCCEEDED has no transitions", () => assert.deepEqual(PAYOUT_TRANSITIONS.SUCCEEDED, []));
  it("FAILED has no transitions", () => assert.deepEqual(PAYOUT_TRANSITIONS.FAILED, []));
  it("CANCELLED has no transitions", () => assert.deepEqual(PAYOUT_TRANSITIONS.CANCELLED, []));
});

// ---------------------------------------------------------------------------
// Refund state machine
// ---------------------------------------------------------------------------

describe("Refund state machine", () => {
  it("PENDING → PROCESSING is valid", () => assert.ok(isValidRefundTransition("PENDING", "PROCESSING")));
  it("PENDING → CANCELLED is valid", () => assert.ok(isValidRefundTransition("PENDING", "CANCELLED")));
  it("PENDING → SUCCEEDED is invalid", () => assert.ok(!isValidRefundTransition("PENDING", "SUCCEEDED")));
  it("PROCESSING → SUCCEEDED is valid", () => assert.ok(isValidRefundTransition("PROCESSING", "SUCCEEDED")));
  it("PROCESSING → FAILED is valid", () => assert.ok(isValidRefundTransition("PROCESSING", "FAILED")));
  it("SUCCEEDED has no transitions", () => assert.deepEqual(REFUND_TRANSITIONS.SUCCEEDED, []));
  it("FAILED has no transitions", () => assert.deepEqual(REFUND_TRANSITIONS.FAILED, []));
});

// ---------------------------------------------------------------------------
// Valid flows
// ---------------------------------------------------------------------------

describe("Valid payout flows", () => {
  it("happy path: PENDING → PROCESSING → SUCCEEDED", () => {
    assert.ok(isValidPayoutTransition("PENDING", "PROCESSING"));
    assert.ok(isValidPayoutTransition("PROCESSING", "SUCCEEDED"));
  });
  it("failed payout: PENDING → PROCESSING → FAILED", () => {
    assert.ok(isValidPayoutTransition("PENDING", "PROCESSING"));
    assert.ok(isValidPayoutTransition("PROCESSING", "FAILED"));
  });
});

describe("Valid refund flows", () => {
  it("happy path: PENDING → PROCESSING → SUCCEEDED", () => {
    assert.ok(isValidRefundTransition("PENDING", "PROCESSING"));
    assert.ok(isValidRefundTransition("PROCESSING", "SUCCEEDED"));
  });
  it("cancelled refund: PENDING → CANCELLED", () => {
    assert.ok(isValidRefundTransition("PENDING", "CANCELLED"));
  });
});

// ---------------------------------------------------------------------------
// Invalid flows
// ---------------------------------------------------------------------------

describe("Invalid refund flows", () => {
  it("cannot skip PROCESSING", () => assert.ok(!isValidRefundTransition("PENDING", "SUCCEEDED")));
  it("cannot retry after FAILED", () => assert.ok(!isValidRefundTransition("FAILED", "PENDING")));
  it("cannot go back from SUCCEEDED", () => assert.ok(!isValidRefundTransition("SUCCEEDED", "PENDING")));
});

// ---------------------------------------------------------------------------
// HMAC signing
// ---------------------------------------------------------------------------

describe("Webhook HMAC signing", () => {
  function signPayload(secret, payload) {
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  function verifySignature(secret, payload, signature) {
    const expected = signPayload(secret, payload);
    if (expected.length !== signature.length) return false;
    let result = 0;
    for (let i = 0; i < expected.length; i++) {
      result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
  }

  it("produces consistent signatures", () => {
    const sig1 = signPayload("secret123", "hello");
    const sig2 = signPayload("secret123", "hello");
    assert.equal(sig1, sig2);
  });

  it("different secrets produce different signatures", () => {
    const sig1 = signPayload("secret1", "hello");
    const sig2 = signPayload("secret2", "hello");
    assert.notEqual(sig1, sig2);
  });

  it("different payloads produce different signatures", () => {
    const sig1 = signPayload("secret", "hello");
    const sig2 = signPayload("secret", "world");
    assert.notEqual(sig1, sig2);
  });

  it("verify returns true for valid signature", () => {
    const sig = signPayload("secret", "payload");
    assert.ok(verifySignature("secret", "payload", sig));
  });

  it("verify returns false for wrong signature", () => {
    assert.ok(!verifySignature("secret", "payload", "wrong"));
  });

  it("verify returns false for wrong secret", () => {
    const sig = signPayload("secret1", "payload");
    assert.ok(!verifySignature("secret2", "payload", sig));
  });

  it("verify returns false for wrong payload", () => {
    const sig = signPayload("secret", "payload1");
    assert.ok(!verifySignature("secret", "payload2", sig));
  });

  it("signature is a 64-char hex string", () => {
    const sig = signPayload("secret", "test");
    assert.match(sig, /^[a-f0-9]{64}$/);
  });
});
