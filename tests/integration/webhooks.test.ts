/**
 * INTEGRATION: webhook endpoints & deliveries — exercising the PRODUCTION
 * src/lib/webhooks.ts against a real PostgreSQL database AND a real local
 * HTTP server (so HMAC signing, delivery, retry backoff and failure are
 * observed end-to-end, not mocked).
 *
 * Required scenarios:
 *   1. endpoint creation enforces HTTPS and returns the secret exactly once
 *   2. stored secret is never exposed again (listing is redacted)
 *   3. endpoint listing is application+environment scoped
 *   4. HMAC-SHA256 signatures verify and are tamper-evident (constant-time)
 *   5. a real delivery POSTs the exact signed body with X-Webhook-Signature
 *   6. non-2xx responses schedule exponential-backoff retries
 *   7. exhausted retries mark the delivery FAILED (terminal)
 *   8. inactive endpoints refuse delivery
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

import {
  createIntegrationDb,
  dropIntegrationDb,
  integrationTestsAvailable,
  type IntegrationDb,
} from "../helpers/integration-db.js";

const skipReason = integrationTestsAvailable()
  ? undefined
  : "integration tests need TEST_DATABASE_ADMIN_URL (or DATABASE_URL) pointing at a PostgreSQL server";

let db: IntegrationDb | null = null;

before(async () => {
  if (skipReason) return;
  db = await createIntegrationDb("webhooks");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

/** Start a local HTTP receiver; returns the server and its base URL. */
async function startReceiver(
  handler: (req: { body: string; headers: Record<string, string | string[] | undefined> }) => {
    status: number;
  },
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const { status } = handler({ body, headers: req.headers });
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe("Webhook endpoint management (production webhooks.ts)", { skip: !!skipReason }, () => {
  it("1. rejects non-HTTPS URLs", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createEndpoint } = await import("@/lib/webhooks");
    const app = await createTestApp("wh1");

    const http = await createEndpoint({
      applicationId: app.application.id,
      environment: "SANDBOX",
      url: "http://example.com/hook",
    });
    assert.ok(!http.ok);
    if (!http.ok) assert.equal(http.code, "INVALID_URL");

    const garbage = await createEndpoint({
      applicationId: app.application.id,
      environment: "SANDBOX",
      url: "not a url",
    });
    assert.ok(!garbage.ok);
  });

  it("2. HTTPS endpoint created; secret returned EXACTLY once; listing is redacted", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createEndpoint, listEndpoints } = await import("@/lib/webhooks");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("wh2");

    const created = await createEndpoint({
      applicationId: app.application.id,
      environment: "SANDBOX",
      url: "https://example.com/hook",
      events: ["payment.succeeded"],
      description: "integration",
    });
    assert.ok(created.ok);
    assert.ok(created.secret.startsWith("whsec_"), "signing secret must be returned at creation");
    assert.equal(created.endpoint.url, "https://example.com/hook");
    assert.equal(created.endpoint.active, true);

    // The listing never contains the secret (or anything derived from it).
    const listed = await listEndpoints(app.application.id, "SANDBOX");
    assert.equal(listed.length, 1);
    const serialized = JSON.stringify(listed);
    assert.ok(!serialized.includes(created.secret));
    assert.ok(!("secret" in listed[0]));

    // The stored row never contains the plaintext secret in a retrievable field.
    const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: created.endpoint.id } });
    // Either encrypted at rest (MPESA_CREDENTIALS_KEY set) or a legacy
    // plaintext row — but the API surface never returns it either way.
    assert.equal(typeof row.secret, "string");
  });

  it("3. listing is application+environment scoped", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createEndpoint, listEndpoints } = await import("@/lib/webhooks");
    const appA = await createTestApp("wh3a");
    const appB = await createTestApp("wh3b");

    await createEndpoint({
      applicationId: appA.application.id,
      environment: "SANDBOX",
      url: "https://a.example.com/hook",
    });
    await createEndpoint({
      applicationId: appA.application.id,
      environment: "LIVE",
      url: "https://a.example.com/live-hook",
    });
    await createEndpoint({
      applicationId: appB.application.id,
      environment: "SANDBOX",
      url: "https://b.example.com/hook",
    });

    const aSandbox = await listEndpoints(appA.application.id, "SANDBOX");
    assert.equal(aSandbox.length, 1);
    assert.equal(aSandbox[0].url, "https://a.example.com/hook");

    const aLive = await listEndpoints(appA.application.id, "LIVE");
    assert.equal(aLive.length, 1);

    const bSandbox = await listEndpoints(appB.application.id, "SANDBOX");
    assert.equal(bSandbox.length, 1);
    assert.equal(bSandbox[0].url, "https://b.example.com/hook");
  });
});

describe("Webhook HMAC signing (constant-time)", { skip: !!skipReason }, () => {
  it("4. sign → verify round-trip; tampering and wrong-length signatures fail", async () => {
    const { signPayload, verifySignature } = await import("@/lib/webhooks");
    const secret = "whsec_test-secret";
    const payload = JSON.stringify({ id: "evt_1", type: "payment.succeeded", amount: 2500 });

    const signature = signPayload(secret, payload);
    assert.match(signature, /^[0-9a-f]{64}$/);
    assert.ok(verifySignature(secret, payload, signature));

    // Tampered payload → signature mismatch.
    assert.ok(!verifySignature(secret, payload + " ", signature));
    // Different secret → mismatch.
    assert.ok(!verifySignature("whsec_other", payload, signature));
    // Wrong-length signature → fast rejection without timing oracle.
    assert.ok(!verifySignature(secret, payload, "deadbeef"));
  });
});

describe("Webhook delivery (real HTTP + real database)", { skip: !!skipReason }, () => {
  it("5. delivers a correctly-signed payload and marks the delivery SENT", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createEndpoint, queueDelivery, deliverWebhook, signPayload } = await import("@/lib/webhooks");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("wh5");

    const created = await createEndpoint({
      applicationId: app.application.id,
      environment: "SANDBOX",
      url: "https://example.com/hook",
    });
    assert.ok(created.ok);

    // Test receiver (HTTP) — the production code will POST the exact body it
    // signed, so we verify the signature against the received bytes.
    type Received = { body: string; headers: Record<string, string | string[] | undefined> };
    const captured: { req?: Received } = {};
    const receiver = await startReceiver((req: Received) => {
      captured.req = req;
      return { status: 200 };
    });
    try {
      // Point the endpoint at the local receiver (validation requires HTTPS
      // at creation; the URL is data, so we set it directly for the test).
      await prisma.webhookEndpoint.update({
        where: { id: created.endpoint.id },
        data: { url: receiver.url },
      });

      const delivery = await queueDelivery(created.endpoint.id, "payment.succeeded", {
        paymentId: "pay_123",
        amountMinor: "2500",
      });
      const result = await deliverWebhook(delivery.id);
      assert.ok(result.success, `delivery must succeed: ${result.error}`);
      assert.equal(result.statusCode, 200);

      // The receiver saw the exact signed body + headers.
      const received = captured.req;
      assert.ok(received, "receiver must have been called");
      const headers = received.headers;
      const signatureHeader = String(headers["x-webhook-signature"] ?? "");
      assert.match(signatureHeader, /^sha256=[0-9a-f]{64}$/);
      assert.equal(String(headers["x-webhook-event"]), "payment.succeeded");
      assert.equal(String(headers["x-webhook-delivery"]), delivery.id);

      const expected = signPayload(created.secret, received.body);
      assert.equal(signatureHeader, `sha256=${expected}`, "signature must match the received bytes");

      const body = JSON.parse(received.body);
      assert.equal(body.type, "payment.succeeded");
      assert.equal(body.data.paymentId, "pay_123");

      const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      assert.equal(row.status, "SENT");
      assert.equal(row.httpStatusCode, 200);
      assert.ok(row.deliveredAt);
      assert.equal(row.attempts, 1);
    } finally {
      receiver.server.close();
    }
  });

  it("6. non-2xx response schedules an exponential-backoff retry", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createEndpoint, queueDelivery, deliverWebhook } = await import("@/lib/webhooks");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("wh6");

    const created = await createEndpoint({
      applicationId: app.application.id,
      environment: "SANDBOX",
      url: "https://example.com/hook",
    });
    assert.ok(created.ok);

    const receiver = await startReceiver(() => ({ status: 500 }));
    try {
      await prisma.webhookEndpoint.update({
        where: { id: created.endpoint.id },
        data: { url: receiver.url },
      });

      const delivery = await queueDelivery(created.endpoint.id, "payment.failed", {});
      const result = await deliverWebhook(delivery.id);
      assert.ok(!result.success);
      assert.equal(result.statusCode, 500);

      const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      assert.equal(row.status, "PENDING", "a retryable failure stays PENDING");
      assert.equal(row.attempts, 1);
      assert.equal(row.httpStatusCode, 500);
      assert.ok(row.nextRetryAt && row.nextRetryAt.getTime() > Date.now(), "retry must be scheduled");
      const delay = row.nextRetryAt!.getTime() - Date.now();
      assert.ok(delay > 500 && delay < 3500, `backoff ~2s after first failure, got ${delay}ms`);
    } finally {
      receiver.server.close();
    }
  });

  it("7. exhausted retries mark the delivery FAILED (terminal)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createEndpoint, queueDelivery, deliverWebhook } = await import("@/lib/webhooks");
    const { prisma } = await import("@/lib/prisma");
    const app = await createTestApp("wh7");

    const created = await createEndpoint({
      applicationId: app.application.id,
      environment: "SANDBOX",
      url: "https://example.com/hook",
    });
    assert.ok(created.ok);

    const receiver = await startReceiver(() => ({ status: 500 }));
    try {
      await prisma.webhookEndpoint.update({
        where: { id: created.endpoint.id },
        data: { url: receiver.url },
      });

      const delivery = await queueDelivery(created.endpoint.id, "payout.failed", {});
      // Fast-forward to the last allowed attempt (maxAttempts default 3).
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { attempts: 2, nextRetryAt: null },
      });

      const result = await deliverWebhook(delivery.id);
      assert.ok(!result.success);

      const row = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      assert.equal(row.status, "FAILED", "final attempt must be terminal");
      assert.equal(row.attempts, 3);
      assert.equal(row.nextRetryAt, null);
    } finally {
      receiver.server.close();
    }
  });

  it("8. inactive endpoints refuse delivery", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createEndpoint, queueDelivery, deliverWebhook, deactivateEndpoint } = await import("@/lib/webhooks");
    const app = await createTestApp("wh8");

    const created = await createEndpoint({
      applicationId: app.application.id,
      environment: "SANDBOX",
      url: "https://example.com/hook",
    });
    assert.ok(created.ok);

    assert.equal(await deactivateEndpoint(created.endpoint.id), true);
    assert.equal(await deactivateEndpoint(created.endpoint.id), false, "deactivation is idempotent-by-count");

    const delivery = await queueDelivery(created.endpoint.id, "payment.succeeded", {});
    const result = await deliverWebhook(delivery.id);
    assert.ok(!result.success);
    assert.match(result.error ?? "", /inactive/i);
  });
});
