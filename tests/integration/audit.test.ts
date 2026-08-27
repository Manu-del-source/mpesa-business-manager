/**
 * INTEGRATION: audit log scoping & querying — exercising the PRODUCTION
 * src/lib/audit.ts (logAudit / logAuditWithCorrelation / queryAuditLog /
 * getEntityAuditTrail) against a real PostgreSQL database.
 *
 * Required scenarios:
 *   1. append-only writes land with the right application/environment
 *   2. queries are APPLICATION-SCOPED — one app can never read another's log
 *   3. environment, actor, action and target filters compose
 *   4. time windows (since/until) bound the result
 *   5. pagination returns total + page slices
 *   6. correlation IDs are injected into metadata
 *   7. entity trails are scoped by application AND target
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

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
  db = await createIntegrationDb("audit");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

describe("Audit log (production audit.ts)", { skip: !!skipReason }, () => {
  it("1. entries are appended with full context and returned newest-first", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { logAudit, queryAuditLog } = await import("@/lib/audit");
    const app = await createTestApp("au1");

    await logAudit({
      applicationId: app.application.id,
      environment: "SANDBOX",
      actorId: "user_1",
      action: "payment.created",
      targetType: "Payment",
      targetId: "pay_1",
    });
    await logAudit({
      applicationId: app.application.id,
      environment: "SANDBOX",
      actorId: "user_1",
      action: "payment.succeeded",
      targetType: "Payment",
      targetId: "pay_1",
      changes: { status: { from: "PROCESSING", to: "SUCCEEDED" } },
    });

    const { entries, total } = await queryAuditLog({ applicationId: app.application.id });
    assert.equal(total, 2);
    assert.equal(entries.length, 2);
    // Newest first.
    assert.equal(entries[0].action, "payment.succeeded");
    assert.deepEqual(entries[0].changes, { status: { from: "PROCESSING", to: "SUCCEEDED" } });
  });

  it("2. queries are APPLICATION-SCOPED — no cross-application leakage", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { logAudit, queryAuditLog } = await import("@/lib/audit");
    const appA = await createTestApp("au2a");
    const appB = await createTestApp("au2b");

    await logAudit({
      applicationId: appA.application.id,
      environment: "SANDBOX",
      actorId: "user_a",
      action: "api_key.created",
      targetType: "ApiKey",
      targetId: "key_a",
    });
    await logAudit({
      applicationId: appB.application.id,
      environment: "SANDBOX",
      actorId: "user_b",
      action: "api_key.created",
      targetType: "ApiKey",
      targetId: "key_b",
    });

    const fromA = await queryAuditLog({ applicationId: appA.application.id });
    assert.equal(fromA.total, 1);
    assert.equal(fromA.entries[0].actorId, "user_a");

    const fromB = await queryAuditLog({ applicationId: appB.application.id });
    assert.equal(fromB.total, 1);
    assert.equal(fromB.entries[0].actorId, "user_b");
  });

  it("3. environment filter separates SANDBOX from LIVE", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { logAudit, queryAuditLog } = await import("@/lib/audit");
    const app = await createTestApp("au3");

    for (const environment of ["SANDBOX", "LIVE"] as const) {
      await logAudit({
        applicationId: app.application.id,
        environment,
        actorId: "user_1",
        action: "payout.created",
        targetType: "Payout",
        targetId: `po_${environment}`,
      });
    }

    const sandboxOnly = await queryAuditLog({ applicationId: app.application.id, environment: "SANDBOX" });
    assert.equal(sandboxOnly.total, 1);
    assert.equal(sandboxOnly.entries[0].targetId, "po_SANDBOX");

    const liveOnly = await queryAuditLog({ applicationId: app.application.id, environment: "LIVE" });
    assert.equal(liveOnly.total, 1);
    assert.equal(liveOnly.entries[0].targetId, "po_LIVE");
  });

  it("4. actor / action / target filters compose", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { logAudit, queryAuditLog } = await import("@/lib/audit");
    const app = await createTestApp("au4");

    const rows = [
      { actorId: "user_1", action: "payment.created", targetType: "Payment", targetId: "pay_1" },
      { actorId: "user_1", action: "payment.refunded", targetType: "Payment", targetId: "pay_1" },
      { actorId: "user_2", action: "payment.created", targetType: "Payment", targetId: "pay_2" },
      { actorId: "user_2", action: "webhook.endpoint_created", targetType: "WebhookEndpoint", targetId: "we_1" },
    ] as const;
    for (const r of rows) {
      await logAudit({ applicationId: app.application.id, environment: "SANDBOX", ...r });
    }

    const byActor = await queryAuditLog({ applicationId: app.application.id, actorId: "user_1" });
    assert.equal(byActor.total, 2);

    const byAction = await queryAuditLog({ applicationId: app.application.id, action: "payment.created" });
    assert.equal(byAction.total, 2);

    const byTarget = await queryAuditLog({
      applicationId: app.application.id,
      targetType: "Payment",
      targetId: "pay_1",
    });
    assert.equal(byTarget.total, 2);

    const composed = await queryAuditLog({
      applicationId: app.application.id,
      actorId: "user_2",
      action: "payment.created",
    });
    assert.equal(composed.total, 1);
    assert.equal(composed.entries[0].targetId, "pay_2");
  });

  it("5. since/until time windows bound the query", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { logAudit, queryAuditLog } = await import("@/lib/audit");
    const app = await createTestApp("au5");

    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);

    await logAudit({
      applicationId: app.application.id,
      environment: "SANDBOX",
      actorId: "user_1",
      action: "settings.updated",
      targetType: "Application",
      targetId: "app_1",
    });

    const sinceFuture = await queryAuditLog({ applicationId: app.application.id, since: future });
    assert.equal(sinceFuture.total, 0, "nothing is newer than the future");

    const untilPast = await queryAuditLog({ applicationId: app.application.id, until: past });
    assert.equal(untilPast.total, 0, "nothing is older than the past");

    const window = await queryAuditLog({
      applicationId: app.application.id,
      since: past,
      until: future,
    });
    assert.equal(window.total, 1);
  });

  it("6. pagination returns total + page slices", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { logAudit, queryAuditLog } = await import("@/lib/audit");
    const app = await createTestApp("au6");

    for (let i = 0; i < 5; i++) {
      await logAudit({
        applicationId: app.application.id,
        environment: "SANDBOX",
        actorId: `user_${i}`,
        action: "usage.queried",
        targetType: "Usage",
        targetId: `usage_${i}`,
      });
    }

    const page1 = await queryAuditLog({ applicationId: app.application.id, limit: 2, offset: 0 });
    const page2 = await queryAuditLog({ applicationId: app.application.id, limit: 2, offset: 2 });
    assert.equal(page1.total, 5);
    assert.equal(page2.total, 5);
    assert.equal(page1.entries.length, 2);
    assert.equal(page2.entries.length, 2);
    // No overlap between pages.
    const ids1 = new Set(page1.entries.map((e) => e.id));
    for (const e of page2.entries) assert.ok(!ids1.has(e.id));
  });

  it("7. correlation IDs land in metadata", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { logAuditWithCorrelation, queryAuditLog } = await import("@/lib/audit");
    const app = await createTestApp("au7");

    await logAuditWithCorrelation(
      {
        applicationId: app.application.id,
        environment: "SANDBOX",
        actorId: "user_1",
        action: "payment.created",
        targetType: "Payment",
        targetId: "pay_corr",
      },
      "req_abc123",
    );

    const { entries } = await queryAuditLog({ applicationId: app.application.id });
    assert.equal(entries.length, 1);
    const metadata = entries[0].metadata as Record<string, unknown> | null;
    assert.equal(metadata?.correlationId, "req_abc123");
  });

  it("8. entity trails are scoped by application AND target", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { logAudit, getEntityAuditTrail } = await import("@/lib/audit");
    const appA = await createTestApp("au8a");
    const appB = await createTestApp("au8b");

    // Same target id in two applications — must not leak across.
    for (const app of [appA, appB]) {
      await logAudit({
        applicationId: app.application.id,
        environment: "SANDBOX",
        actorId: "user_1",
        action: "payout.created",
        targetType: "Payout",
        targetId: "po_shared",
      });
    }

    const trailA = await getEntityAuditTrail(appA.application.id, "Payout", "po_shared");
    assert.equal(trailA.length, 1);
    assert.equal(trailA[0].applicationId, appA.application.id);
  });
});
