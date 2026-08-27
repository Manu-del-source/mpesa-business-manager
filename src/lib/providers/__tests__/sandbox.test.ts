/**
 * SandboxProvider tests — importing the PRODUCTION class from
 * src/lib/providers/sandbox.ts. All state is in-memory; no network, no DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SandboxProvider } from "@/lib/providers/sandbox";

const REQ = {
  applicationId: "app_1",
  environment: "SANDBOX" as const,
  amountMinor: 1000n,
  currency: "KES",
  phone: "254712345678",
  shortcode: "174379",
  reference: "TEST",
  description: "test payment",
};

describe("SandboxProvider capabilities (production class)", () => {
  const provider = new SandboxProvider();
  it("name is 'sandbox'", () => assert.equal(provider.name, "sandbox"));
  it("supports stkPush and stkQuery", () => {
    assert.ok(provider.capabilities.stkPush);
    assert.ok(provider.capabilities.stkQuery);
  });
  it("does not support b2c", () => assert.ok(!provider.capabilities.b2c));
  it("is a sandbox provider", () => assert.ok(provider.capabilities.sandbox));
  it("supports KES currency", () => assert.deepEqual(provider.capabilities.currencies, ["KES"]));
  it("healthCheck is always true", async () => assert.ok(await provider.healthCheck()));
});

describe("SandboxProvider STK Push (production)", () => {
  it("initiates an STK push successfully", async () => {
    const provider = new SandboxProvider();
    const res = await provider.initiateStkPush(REQ);
    assert.ok(res.accepted);
    assert.ok(res.checkoutId);
    assert.ok(res.requestId);
  });

  it("generates unique checkout IDs", async () => {
    const provider = new SandboxProvider();
    const a = await provider.initiateStkPush(REQ);
    const b = await provider.initiateStkPush(REQ);
    assert.notEqual(a.checkoutId, b.checkoutId);
  });

  it("stores the payment as pending", async () => {
    const provider = new SandboxProvider();
    const res = await provider.initiateStkPush(REQ);
    assert.equal(provider.pendingCount, 1);
    const query = await provider.queryStkPush({ checkoutId: res.checkoutId! });
    assert.ok(query.pending);
  });

  it("alwaysFail mode accepts the push but fails the payment (Daraja semantics)", async () => {
    // Safaricom ALWAYS accepts an STK Push request — insufficient funds is a
    // later payment outcome, surfaced via the query/callback.
    const provider = new SandboxProvider({ alwaysFail: true });
    const res = await provider.initiateStkPush(REQ);
    assert.ok(res.accepted);
    const query = await provider.queryStkPush({ checkoutId: res.checkoutId! });
    assert.ok(!query.pending);
    assert.equal(query.resultCode, 1); // INSUFFICIENT_FUNDS
  });
});

describe("SandboxProvider STK Query (production)", () => {
  it("returns pending for a recently initiated payment", async () => {
    const provider = new SandboxProvider();
    const push = await provider.initiateStkPush(REQ);
    const query = await provider.queryStkPush({ checkoutId: push.checkoutId! });
    assert.ok(query.pending);
    assert.equal(query.resultCode, null);
  });

  it("auto-completes after 2 seconds (customer entered PIN)", async () => {
    const provider = new SandboxProvider();
    const push = await provider.initiateStkPush(REQ);
    await new Promise((r) => setTimeout(r, 2100));
    const query = await provider.queryStkPush({ checkoutId: push.checkoutId! });
    assert.ok(!query.pending);
    assert.equal(query.resultCode, 0);
    assert.equal(query.amountMinor, 1000n);
    assert.ok(query.receiptNumber);
  });

  it("returns an error for an unknown checkout ID", async () => {
    const provider = new SandboxProvider();
    const query = await provider.queryStkPush({ checkoutId: "ws_CO_UNKNOWN" });
    assert.ok(!query.pending);
    assert.equal(query.resultCode, 1);
  });
});

describe("SandboxProvider manual control (production)", () => {
  it("manual failPayment works", async () => {
    const provider = new SandboxProvider();
    const push = await provider.initiateStkPush(REQ);
    assert.ok(provider.failPayment(push.checkoutId!, 1032));
    const query = await provider.queryStkPush({ checkoutId: push.checkoutId! });
    assert.ok(!query.pending);
    assert.equal(query.resultCode, 1032);
  });

  it("manual completePayment works", async () => {
    const provider = new SandboxProvider();
    const push = await provider.initiateStkPush(REQ);
    assert.ok(provider.completePayment(push.checkoutId!));
    const query = await provider.queryStkPush({ checkoutId: push.checkoutId! });
    assert.ok(!query.pending);
    assert.equal(query.resultCode, 0);
  });

  it("manual controls fail on unknown/settled payments", async () => {
    const provider = new SandboxProvider();
    assert.ok(!provider.completePayment("ws_CO_NONE"));
    assert.ok(!provider.failPayment("ws_CO_NONE"));
  });
});
