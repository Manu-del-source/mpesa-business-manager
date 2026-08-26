import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Re-implement SandboxProvider for testing

class SandboxProvider {
  name = "sandbox";
  capabilities = {
    stkPush: true,
    stkQuery: true,
    b2c: false,
    sandbox: true,
    currencies: ["KES"],
  };

  constructor(config = {}) {
    this.config = config;
    this.pending = new Map();
    this.requestCounter = 0;
  }

  async initiateStkPush(request) {
    if (this.config.delayMs) {
      await new Promise((r) => setTimeout(r, this.config.delayMs));
    }

    const checkoutId = `sbx_CO_${Date.now()}_${++this.requestCounter}`;
    const requestId = `sbx_MR_${Date.now()}_${this.requestCounter}`;

    const shouldFail =
      this.config.alwaysFail ||
      (this.config.failureRate && Math.random() * 100 < this.config.failureRate);

    if (shouldFail) {
      this.pending.set(checkoutId, {
        checkoutId, requestId, phone: request.phone,
        amountMinor: request.amountMinor, createdAt: new Date(),
        status: "FAILED", resultCode: 1,
        resultDesc: "Insufficient funds.",
      });
      return { accepted: true, requestId, checkoutId, customerMessage: "Insufficient funds." };
    }

    this.pending.set(checkoutId, {
      checkoutId, requestId, phone: request.phone,
      amountMinor: request.amountMinor, reference: request.reference,
      createdAt: new Date(), status: "PENDING", resultCode: 0,
      resultDesc: "Success.",
    });
    return { accepted: true, requestId, checkoutId, customerMessage: "Success." };
  }

  async queryStkPush(request) {
    if (this.config.delayMs) {
      await new Promise((r) => setTimeout(r, this.config.delayMs));
    }
    const payment = this.pending.get(request.checkoutId);
    if (!payment) {
      return { pending: false, resultCode: 1, resultDesc: "Not found.", amountMinor: null, receiptNumber: null, transactionDate: null };
    }
    const elapsed = Date.now() - payment.createdAt.getTime();
    if (payment.status === "PENDING" && elapsed > 2000) payment.status = "COMPLETED";
    if (payment.status === "PENDING") {
      return { pending: true, resultCode: null, resultDesc: null, amountMinor: null, receiptNumber: null, transactionDate: null };
    }
    if (payment.status === "FAILED") {
      return { pending: false, resultCode: payment.resultCode, resultDesc: payment.resultDesc, amountMinor: null, receiptNumber: null, transactionDate: payment.createdAt };
    }
    return { pending: false, resultCode: 0, resultDesc: payment.resultDesc, amountMinor: payment.amountMinor, receiptNumber: "SBXABC123", transactionDate: payment.createdAt };
  }

  async healthCheck() { return true; }

  completePayment(checkoutId) {
    const p = this.pending.get(checkoutId);
    if (!p || p.status !== "PENDING") return false;
    p.status = "COMPLETED";
    return true;
  }

  failPayment(checkoutId, resultCode = 1) {
    const p = this.pending.get(checkoutId);
    if (!p || p.status !== "PENDING") return false;
    p.status = "FAILED";
    p.resultCode = resultCode;
    return true;
  }

  get pendingCount() {
    return Array.from(this.pending.values()).filter((p) => p.status === "PENDING").length;
  }

  reset() { this.pending.clear(); this.requestCounter = 0; }
}

// Provider registry
const providers = new Map();
function registerProvider(provider) { providers.set(provider.name, provider); }
function getProvider(name) { return providers.get(name) ?? null; }
function requireProvider(name) {
  const p = providers.get(name);
  if (!p) throw new Error(`Provider "${name}" not registered.`);
  return p;
}
function listProviders() { return Array.from(providers.keys()); }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SandboxProvider capabilities", () => {
  it("name is 'sandbox'", () => {
    const sbx = new SandboxProvider();
    assert.equal(sbx.name, "sandbox");
  });

  it("supports stkPush and stkQuery", () => {
    const sbx = new SandboxProvider();
    assert.ok(sbx.capabilities.stkPush);
    assert.ok(sbx.capabilities.stkQuery);
  });

  it("does not support b2c", () => {
    const sbx = new SandboxProvider();
    assert.ok(!sbx.capabilities.b2c);
  });

  it("is a sandbox provider", () => {
    const sbx = new SandboxProvider();
    assert.ok(sbx.capabilities.sandbox);
  });

  it("supports KES currency", () => {
    const sbx = new SandboxProvider();
    assert.ok(sbx.capabilities.currencies.includes("KES"));
  });
});

describe("SandboxProvider STK Push", () => {
  let sbx;

  beforeEach(() => { sbx = new SandboxProvider(); });

  it("initiates an STK push successfully", async () => {
    const result = await sbx.initiateStkPush({
      phone: "254712345678",
      amountMinor: 1000n,
      currency: "KES",
      shortcode: "174379",
    });
    assert.ok(result.accepted);
    assert.ok(result.requestId.startsWith("sbx_MR_"));
    assert.ok(result.checkoutId.startsWith("sbx_CO_"));
    assert.equal(result.customerMessage, "Success.");
  });

  it("generates unique checkout IDs", async () => {
    const r1 = await sbx.initiateStkPush({ phone: "254712345678", amountMinor: 100n, currency: "KES", shortcode: "174379" });
    const r2 = await sbx.initiateStkPush({ phone: "254712345678", amountMinor: 100n, currency: "KES", shortcode: "174379" });
    assert.notEqual(r1.checkoutId, r2.checkoutId);
  });

  it("always accepts the request (like Daraja)", async () => {
    const result = await sbx.initiateStkPush({ phone: "254712345678", amountMinor: 100n, currency: "KES", shortcode: "174379" });
    assert.ok(result.accepted);
  });

  it("stores pending payment", async () => {
    await sbx.initiateStkPush({ phone: "254712345678", amountMinor: 500n, currency: "KES", shortcode: "174379" });
    assert.equal(sbx.pendingCount, 1);
  });
});

describe("SandboxProvider STK Query", () => {
  let sbx;

  beforeEach(() => { sbx = new SandboxProvider(); });

  it("returns pending for recently initiated payment", async () => {
    const { checkoutId } = await sbx.initiateStkPush({
      phone: "254712345678", amountMinor: 100n, currency: "KES", shortcode: "174379",
    });
    const result = await sbx.queryStkPush({ checkoutId });
    assert.ok(result.pending);
    assert.equal(result.resultCode, null);
  });

  it("auto-completes after 2 seconds", async () => {
    const sbx = new SandboxProvider({ delayMs: 100 });
    const { checkoutId } = await sbx.initiateStkPush({
      phone: "254712345678", amountMinor: 200n, currency: "KES", shortcode: "174379",
    });
    // Wait for auto-completion
    await new Promise((r) => setTimeout(r, 2200));
    const result = await sbx.queryStkPush({ checkoutId });
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 0);
    assert.equal(result.amountMinor, 200n);
  });

  it("returns error for unknown checkout ID", async () => {
    const result = await sbx.queryStkPush({ checkoutId: "unknown_123" });
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 1);
  });
});

describe("SandboxProvider failure mode", () => {
  it("alwaysFail makes all payments fail", async () => {
    const sbx = new SandboxProvider({ alwaysFail: true });
    const { checkoutId } = await sbx.initiateStkPush({
      phone: "254712345678", amountMinor: 100n, currency: "KES", shortcode: "174379",
    });
    assert.equal(sbx.pendingCount, 0); // Failed payments aren't pending
    const result = await sbx.queryStkPush({ checkoutId });
    assert.ok(!result.pending);
    assert.equal(result.resultCode, 1);
  });

  it("manual failPayment works", async () => {
    const sbx = new SandboxProvider();
    const { checkoutId } = await sbx.initiateStkPush({
      phone: "254712345678", amountMinor: 100n, currency: "KES", shortcode: "174379",
    });
    assert.ok(sbx.failPayment(checkoutId, 2001));
    const result = await sbx.queryStkPush({ checkoutId });
    assert.equal(result.resultCode, 2001);
  });

  it("manual completePayment works", async () => {
    const sbx = new SandboxProvider();
    const { checkoutId } = await sbx.initiateStkPush({
      phone: "254712345678", amountMinor: 100n, currency: "KES", shortcode: "174379",
    });
    assert.ok(sbx.completePayment(checkoutId));
    assert.equal(sbx.pendingCount, 0);
  });

  it("completePayment returns false for non-existent checkout", () => {
    const sbx = new SandboxProvider();
    assert.ok(!sbx.completePayment("nonexistent"));
  });
});

describe("SandboxProvider health check", () => {
  it("always healthy", async () => {
    const sbx = new SandboxProvider();
    assert.ok(await sbx.healthCheck());
  });
});

describe("SandboxProvider reset", () => {
  it("clears all state", async () => {
    const sbx = new SandboxProvider();
    await sbx.initiateStkPush({ phone: "254712345678", amountMinor: 100n, currency: "KES", shortcode: "174379" });
    assert.equal(sbx.pendingCount, 1);
    sbx.reset();
    assert.equal(sbx.pendingCount, 0);
  });
});

describe("Provider registry", () => {
  beforeEach(() => { providers.clear(); });

  it("registers and retrieves a provider", () => {
    const sbx = new SandboxProvider();
    registerProvider(sbx);
    assert.equal(getProvider("sandbox"), sbx);
  });

  it("returns null for unknown provider", () => {
    assert.equal(getProvider("unknown"), null);
  });

  it("requireProvider throws for unknown provider", () => {
    assert.throws(() => requireProvider("unknown"), /not registered/);
  });

  it("lists registered providers", () => {
    registerProvider(new SandboxProvider());
    assert.deepEqual(listProviders(), ["sandbox"]);
  });

  it("overwrites existing provider with same name", () => {
    const sbx1 = new SandboxProvider();
    const sbx2 = new SandboxProvider({ alwaysFail: true });
    registerProvider(sbx1);
    registerProvider(sbx2);
    assert.equal(getProvider("sandbox"), sbx2);
  });
});
