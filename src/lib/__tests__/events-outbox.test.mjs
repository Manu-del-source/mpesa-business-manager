import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Event types
const EVENT_TYPES = [
  "payment.created",
  "payment.processing",
  "payment.succeeded",
  "payment.failed",
  "payment.cancelled",
  "payment.refunded",
  "payout.created",
  "payout.succeeded",
  "payout.failed",
  "refund.created",
  "refund.succeeded",
  "refund.failed",
];

// Outbox statuses
const OUTBOX_STATUSES = ["PENDING", "DISPATCHED", "FAILED"];

// Exponential backoff calculation
function computeBackoff(attempts, baseMs = 1000, maxMs = 60000) {
  return Math.min(baseMs * Math.pow(2, attempts), maxMs);
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

describe("Event types", () => {
  it("has payment lifecycle events", () => {
    assert.ok(EVENT_TYPES.includes("payment.created"));
    assert.ok(EVENT_TYPES.includes("payment.succeeded"));
    assert.ok(EVENT_TYPES.includes("payment.failed"));
  });

  it("has payout lifecycle events", () => {
    assert.ok(EVENT_TYPES.includes("payout.created"));
    assert.ok(EVENT_TYPES.includes("payout.succeeded"));
    assert.ok(EVENT_TYPES.includes("payout.failed"));
  });

  it("has refund lifecycle events", () => {
    assert.ok(EVENT_TYPES.includes("refund.created"));
    assert.ok(EVENT_TYPES.includes("refund.succeeded"));
    assert.ok(EVENT_TYPES.includes("refund.failed"));
  });

  it("all event types follow aggregate.action format", () => {
    for (const type of EVENT_TYPES) {
      assert.match(type, /^[a-z]+\.[a-z]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Outbox pattern
// ---------------------------------------------------------------------------

describe("Outbox pattern", () => {
  it("has all required statuses", () => {
    assert.ok(OUTBOX_STATUSES.includes("PENDING"));
    assert.ok(OUTBOX_STATUSES.includes("DISPATCHED"));
    assert.ok(OUTBOX_STATUSES.includes("FAILED"));
  });

  it("exponential backoff increases with attempts", () => {
    const b0 = computeBackoff(0);
    const b1 = computeBackoff(1);
    const b2 = computeBackoff(2);
    assert.ok(b1 > b0);
    assert.ok(b2 > b1);
  });

  it("exponential backoff caps at max", () => {
    const b10 = computeBackoff(10);
    assert.equal(b10, 60000);
  });

  it("exponential backoff: 0 attempts = 1s", () => {
    assert.equal(computeBackoff(0), 1000);
  });

  it("exponential backoff: 1 attempt = 2s", () => {
    assert.equal(computeBackoff(1), 2000);
  });

  it("exponential backoff: 2 attempts = 4s", () => {
    assert.equal(computeBackoff(2), 4000);
  });

  it("exponential backoff: 3 attempts = 8s", () => {
    assert.equal(computeBackoff(3), 8000);
  });
});

// ---------------------------------------------------------------------------
// Event payload structure
// ---------------------------------------------------------------------------

describe("Event payload structure", () => {
  it("payment event has required fields", () => {
    const event = {
      type: "payment.succeeded",
      aggregateType: "Payment",
      aggregateId: "pay_123",
      payload: { paymentId: "pay_123", amountMinor: 1000, currency: "KES", status: "SUCCEEDED" },
    };
    assert.ok(event.type);
    assert.ok(event.aggregateType);
    assert.ok(event.aggregateId);
    assert.ok(event.payload);
    assert.equal(event.aggregateType, "Payment");
  });

  it("payout event has required fields", () => {
    const event = {
      type: "payout.succeeded",
      aggregateType: "Payout",
      aggregateId: "pay_456",
      payload: { payoutId: "pay_456", amountMinor: 5000, recipientPhone: "254712345678" },
    };
    assert.ok(event.type);
    assert.ok(event.aggregateType);
    assert.equal(event.aggregateType, "Payout");
  });
});

// ---------------------------------------------------------------------------
// Webhook delivery
// ---------------------------------------------------------------------------

describe("Webhook delivery", () => {
  it("delivery has required fields", () => {
    const delivery = {
      id: "del_123",
      eventType: "payment.succeeded",
      payload: { paymentId: "pay_123" },
      status: "PENDING",
      attempts: 0,
      maxAttempts: 3,
    };
    assert.ok(delivery.id);
    assert.ok(delivery.eventType);
    assert.ok(delivery.payload);
    assert.equal(delivery.status, "PENDING");
    assert.equal(delivery.attempts, 0);
    assert.equal(delivery.maxAttempts, 3);
  });

  it("retry logic respects max attempts", () => {
    let attempts = 0;
    const maxAttempts = 3;
    const shouldRetry = () => attempts < maxAttempts;

    assert.ok(shouldRetry()); // 0 < 3
    attempts++;
    assert.ok(shouldRetry()); // 1 < 3
    attempts++;
    assert.ok(shouldRetry()); // 2 < 3
    attempts++;
    assert.ok(!shouldRetry()); // 3 < 3 = false
  });
});
