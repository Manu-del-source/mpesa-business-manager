/**
 * Shared fixtures for integration tests — built on PRODUCTION provisioning
 * (src/lib/provisioning.ts) so tests exercise the real code paths.
 */
import { prisma } from "@/lib/prisma";
import {
  ensureTenantMember,
  provisionTenantForOrg,
} from "@/lib/provisioning";

export type TestApp = {
  orgId: string;
  userId: string;
  tenant: { id: string; name: string; slug: string };
  application: { id: string; name: string; slug: string };
};

let counter = 0;

/** Unique suffix so parallel files never collide on slugs. */
export function uniqueSlug(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${process.pid}-${counter}`;
}

/**
 * Create an Organization (with an OWNER member), provision its Tenant +
 * default Application, and return the ids — the same shape a real
 * authenticated user's context resolves to.
 */
export async function createTestApp(label = "app"): Promise<TestApp> {
  const slug = uniqueSlug(label);
  const userId = `user_${slug}`;

  const org = await prisma.organization.create({
    data: {
      name: `Test Org ${slug}`,
      slug,
      businessType: "Retail",
    },
    select: { id: true },
  });

  await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId,
      role: "OWNER",
      firstName: "Test",
      lastName: "Owner",
    },
  });

  const { tenant, application } = await provisionTenantForOrg({
    id: org.id,
    name: `Test Org ${slug}`,
    slug,
  });

  return { orgId: org.id, userId, tenant, application };
}

/** A second user with no membership anywhere. */
export async function strangerUserId(label = "stranger"): Promise<string> {
  return `user_${uniqueSlug(label)}`;
}

/** Grant tenant membership directly (admin-style fixture setup). */
export async function addTenantMember(
  tenantId: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "DEVELOPER" | "FINANCE" | "VIEWER" = "VIEWER",
) {
  return ensureTenantMember(tenantId, userId, role);
}

/** Minimal AppContext for resolveTenantContext (production type). */
export function appContextFor(app: TestApp) {
  return {
    user: {
      id: app.userId,
      email: `${app.userId}@example.com`,
      name: "Test Owner",
      isDemo: false,
    },
    orgId: app.orgId,
    org: {
      id: app.orgId,
      name: `Test Org`,
      slug: app.tenant.slug,
      tier: "FREE" as const,
      businessType: "Retail",
    },
    role: "OWNER" as const,
  };
}
