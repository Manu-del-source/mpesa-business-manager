/**
 * INTEGRATION: tenant isolation — exercises the PRODUCTION authorization
 * core (src/lib/tenant-context.ts resolveTenantContext) and provisioning
 * (src/lib/provisioning.ts) against a real PostgreSQL database with the
 * real migrations applied.
 *
 * Regression coverage:
 *   - selecting a tenant you are NOT a member of → denied (never auto-member)
 *   - cross-tenant / tenantId-spoofing attempts
 *   - tampered environment cookie values are ignored
 *   - provisioning is idempotent and race-safe
 *   - cross-application entity access returns NOT FOUND
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
  db = await createIntegrationDb("tenant");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

describe("Tenant isolation (production resolveTenantContext)", { skip: !!skipReason }, () => {
  it("provisions a tenant + default application for a new org (idempotent)", async () => {
    const { createTestApp, appContextFor } = await import("../helpers/fixtures.js");
    const { resolveTenantContext } = await import("@/lib/tenant-context");
    const { prisma } = await import("@/lib/prisma");

    const app = await createTestApp("iso");
    const ctx = await resolveTenantContext({ appCtx: appContextFor(app) });

    assert.equal(ctx.tenant.id, app.tenant.id);
    assert.equal(ctx.application.id, app.application.id);
    assert.equal(ctx.environment, "SANDBOX");
    assert.equal(ctx.tenantRole, "OWNER"); // org OWNER → tenant OWNER

    // Re-running provisioning must not create a second tenant/application.
    const again = await resolveTenantContext({ appCtx: appContextFor(app) });
    assert.equal(again.tenant.id, app.tenant.id);
    const tenantCount = await prisma.tenant.count({
      where: { slug: app.tenant.slug },
    });
    assert.equal(tenantCount, 1);
  });

  it("DENIES a tenant the user is not a member of (no auto-membership)", async () => {
    const { createTestApp, appContextFor, strangerUserId } = await import("../helpers/fixtures.js");
    const { resolveTenantContext, TenantAccessDeniedError } = await import("@/lib/tenant-context");

    const appA = await createTestApp("alpha");
    const appB = await createTestApp("beta"); // another tenant entirely

    // User A (member of tenant A only) asks for tenant B via the cookie.
    const stranger = await strangerUserId();
    assert.notEqual(stranger, appA.userId);

    await assert.rejects(
      resolveTenantContext({
        appCtx: appContextFor(appA),
        activeTenantSlug: appB.tenant.slug,
      }),
      TenantAccessDeniedError,
    );

    // Critically: no TenantMember may have been created as a side effect.
    const { prisma } = await import("@/lib/prisma");
    const membership = await prisma.tenantMember.findUnique({
      where: {
        tenantId_userId: { tenantId: appB.tenant.id, userId: appA.userId },
      },
    });
    assert.equal(membership, null, "membership must never be auto-created");
  });

  it("ALLOWS a tenant the user IS a member of (cookie-selected)", async () => {
    const { createTestApp, appContextFor, addTenantMember } = await import("../helpers/fixtures.js");
    const { resolveTenantContext } = await import("@/lib/tenant-context");

    const appA = await createTestApp("member");
    const appB = await createTestApp("target");

    // Grant B membership to user A (admin action).
    await addTenantMember(appB.tenant.id, appA.userId, "FINANCE");

    const ctx = await resolveTenantContext({
      appCtx: appContextFor(appA),
      activeTenantSlug: appB.tenant.slug,
    });
    assert.equal(ctx.tenant.id, appB.tenant.id);
    assert.equal(ctx.tenantRole, "FINANCE");
  });

  it("falls back to the user's own org tenant for a stale/unknown slug", async () => {
    const { createTestApp, appContextFor } = await import("../helpers/fixtures.js");
    const { resolveTenantContext } = await import("@/lib/tenant-context");

    const app = await createTestApp("stale");
    const ctx = await resolveTenantContext({
      appCtx: appContextFor(app),
      activeTenantSlug: "no-such-tenant-exists",
    });
    // Falls back to the user's OWN org tenant — never to an arbitrary tenant.
    assert.equal(ctx.tenant.id, app.tenant.id);
  });

  it("ignores tampered environment cookie values", async () => {
    const { createTestApp, appContextFor } = await import("../helpers/fixtures.js");
    const { resolveTenantContext, parseEnvironmentCookie } = await import("@/lib/tenant-context");

    const app = await createTestApp("env");
    const ctx = await resolveTenantContext({
      appCtx: appContextFor(app),
      activeEnvironment: parseEnvironmentCookie("LIVE"),
    });
    assert.equal(ctx.environment, "LIVE");

    // Tampered cookie → undefined → defaults to SANDBOX (never leaks into queries)
    assert.equal(parseEnvironmentCookie("LIVE'; DROP TABLE--"), undefined);
    assert.equal(parseEnvironmentCookie(""), undefined);
    const ctx2 = await resolveTenantContext({
      appCtx: appContextFor(app),
      activeEnvironment: parseEnvironmentCookie("live"), // wrong case
    });
    assert.equal(ctx2.environment, "SANDBOX");
  });

  it("concurrent provisioning attempts converge on ONE tenant (no find-then-create races)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { provisionTenantForOrg } = await import("@/lib/provisioning");

    const org = await prisma.organization.create({
      data: { name: "Race Org", slug: `race-${Date.now()}-${process.pid}`, businessType: "Retail" },
      select: { id: true, name: true, slug: true },
    });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => provisionTenantForOrg(org)),
    );
    const tenantIds = new Set(results.map((r) => r.tenant.id));
    assert.equal(tenantIds.size, 1, "concurrent provisioning must converge");

    const linked = await prisma.organization.findUniqueOrThrow({
      where: { id: org.id },
      select: { tenantId: true },
    });
    assert.equal(linked.tenantId, [...tenantIds][0]);
  });

  it("cross-application payment lookups return NOT FOUND (IDOR protection)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment, getPayment } = await import("@/lib/payments");

    const appA = await createTestApp("idora");
    const appB = await createTestApp("idorb");

    const created = await createPayment({
      applicationId: appA.application.id,
      environment: "SANDBOX",
      amountMinor: 1000n,
      idempotencyKey: `idor-${Date.now()}`,
    });
    assert.ok(created.ok);

    // App B cannot read app A's payment even with the exact id.
    const leaked = await getPayment(
      created.ok ? created.payment.id : "",
      appB.application.id,
    );
    assert.equal(leaked, null);
  });

  it("payments are scoped by application+environment (same key, different app → separate payments)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createPayment } = await import("@/lib/payments");

    const appA = await createTestApp("scopea");
    const appB = await createTestApp("scopeb");
    const key = `shared-key-${Date.now()}-${process.pid}`;

    const a = await createPayment({
      applicationId: appA.application.id,
      environment: "SANDBOX",
      amountMinor: 500n,
      idempotencyKey: key,
    });
    const b = await createPayment({
      applicationId: appB.application.id,
      environment: "SANDBOX",
      amountMinor: 500n,
      idempotencyKey: key,
    });

    // Two different applications may legitimately reuse the same key —
    // idempotency is scoped per (application, environment, key).
    assert.ok(a.ok && b.ok);
    assert.notEqual(a.ok && a.payment.id, b.ok && b.payment.id);
  });
});
