import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret, encryptionEnabled } from "@/lib/secrets";
import { logMpesaError } from "@/lib/mpesa/log";
import type { Environment } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateEndpointInput = {
  applicationId: string;
  environment: Environment;
  url: string;
  events?: string[];
  description?: string;
};

export type WebhookEndpointView = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  createdAt: string;
  lastTriggeredAt: string | null;
};

// ---------------------------------------------------------------------------
// Endpoint management
// ---------------------------------------------------------------------------

/**
 * Create a webhook endpoint with a generated signing secret.
 */
export async function createEndpoint(input: CreateEndpointInput) {
  // Validate URL is HTTPS
  try {
    const parsed = new URL(input.url);
    if (parsed.protocol !== "https:") {
      return { ok: false as const, error: "Webhook URL must use HTTPS.", code: "INVALID_URL" };
    }
  } catch {
    return { ok: false as const, error: "Invalid webhook URL.", code: "INVALID_URL" };
  }

  const secret = `whsec_${randomBytes(32).toString("base64url")}`;

  // The signing secret is ENCRYPTED AT REST (AES-256-GCM envelope — see
  // src/lib/secrets.ts) and only decrypted in memory when signing a
  // delivery. It is returned in plaintext exactly once, at creation.
  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      applicationId: input.applicationId,
      environment: input.environment,
      url: input.url,
      secret: encryptSecret(secret),
      events: input.events ?? [],
      description: input.description ?? null,
    },
  });

  if (!encryptionEnabled()) {
    logMpesaError("webhooks.secret_stored_unencrypted", {
      endpointId: endpoint.id,
      hint: "Set MPESA_CREDENTIALS_KEY to enable encryption at rest.",
    });
  }

  return {
    ok: true as const,
    endpoint: formatEndpoint(endpoint),
    secret, // Return secret exactly once — never retrievable later
  };
}

/**
 * Deactivate a webhook endpoint.
 */
export async function deactivateEndpoint(endpointId: string): Promise<boolean> {
  const result = await prisma.webhookEndpoint.updateMany({
    where: { id: endpointId, active: true },
    data: { active: false },
  });
  return result.count > 0;
}

/**
 * List webhook endpoints for an application.
 */
export async function listEndpoints(applicationId: string, environment: Environment) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { applicationId, environment },
    orderBy: { createdAt: "desc" },
  });
  return endpoints.map(formatEndpoint);
}

// ---------------------------------------------------------------------------
// HMAC signing
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 signature for a webhook payload.
 */
export function signPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Verify an HMAC-SHA256 signature.
 */
export function verifySignature(secret: string, payload: string, signature: string): boolean {
  const expected = signPayload(secret, payload);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Queue a webhook delivery for an event.
 */
export async function queueDelivery(
  endpointId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  return prisma.webhookDelivery.create({
    data: {
      webhookEndpointId: endpointId,
      eventType,
      payload: payload as never,
      status: "PENDING",
    },
  });
}

/**
 * Deliver a webhook (HTTP POST with HMAC signature).
 * Returns the delivery result.
 */
export async function deliverWebhook(deliveryId: string): Promise<{
  success: boolean;
  statusCode?: number;
  error?: string;
}> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhookEndpoint: true },
  });

  if (!delivery) return { success: false, error: "Delivery not found." };
  if (!delivery.webhookEndpoint.active) return { success: false, error: "Endpoint is inactive." };

  const body = JSON.stringify({
    id: delivery.id,
    type: delivery.eventType,
    data: delivery.payload,
    createdAt: delivery.createdAt.toISOString(),
  });

  // The stored secret is encrypted at rest; decrypt just-in-time (legacy
  // plaintext rows are tolerated so enabling encryption is non-breaking).
  const secret = decryptSecret(delivery.webhookEndpoint.secret);
  const signature = signPayload(secret, body);

  try {
    const res = await fetch(delivery.webhookEndpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${signature}`,
        "X-Webhook-Event": delivery.eventType,
        "X-Webhook-Delivery": delivery.id,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    const responseBody = await res.text().catch(() => "");

    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "SENT",
          httpStatusCode: res.status,
          responseBody: responseBody.slice(0, 1000),
          attempts: delivery.attempts + 1,
          deliveredAt: new Date(),
        },
      });

      await prisma.webhookEndpoint.update({
        where: { id: delivery.webhookEndpointId },
        data: { lastTriggeredAt: new Date() },
      });

      return { success: true, statusCode: res.status };
    }

    // Non-2xx response
    const attempts = delivery.attempts + 1;
    if (attempts >= delivery.maxAttempts) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: "FAILED", httpStatusCode: res.status, responseBody: responseBody.slice(0, 1000), attempts },
      });
    } else {
      const delayMs = Math.min(1000 * Math.pow(2, attempts), 60_000);
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { httpStatusCode: res.status, responseBody: responseBody.slice(0, 1000), attempts, nextRetryAt: new Date(Date.now() + delayMs) },
      });
    }

    return { success: false, statusCode: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    const attempts = delivery.attempts + 1;
    const error = err instanceof Error ? err.message : String(err);

    if (attempts >= delivery.maxAttempts) {
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: "FAILED", attempts, lastError: error },
      });
    } else {
      const delayMs = Math.min(1000 * Math.pow(2, attempts), 60_000);
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: { attempts, lastError: error, nextRetryAt: new Date(Date.now() + delayMs) },
      });
    }

    return { success: false, error };
  }
}

/**
 * Get pending webhook deliveries ready for dispatch.
 */
export async function getPendingDeliveries(limit = 10) {
  return prisma.webhookDelivery.findMany({
    where: {
      status: "PENDING",
      attempts: { lt: prisma.webhookDelivery.fields.maxAttempts },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

function formatEndpoint(e: {
  id: string; url: string; events: string[]; active: boolean;
  description: string | null; createdAt: Date; lastTriggeredAt: Date | null;
}): WebhookEndpointView {
  return {
    id: e.id, url: e.url, events: e.events, active: e.active,
    description: e.description, createdAt: e.createdAt.toISOString(),
    lastTriggeredAt: e.lastTriggeredAt?.toISOString() ?? null,
  };
}
