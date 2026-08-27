/**
 * Phase 1 backfill: create Tenant + Application + TenantMember for every
 * existing Organization that doesn't have a tenantId yet.
 *
 * Run with:  npx tsx scripts/backfill-tenants.mjs
 *
 * Safe to re-run (idempotent — skips orgs that already have a tenant).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_APP_SLUG = "default-app";

async function main() {
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      tenantId: true,
      members: { select: { userId: true, role: true } },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    if (org.tenantId) {
      skipped++;
      continue;
    }

    console.log(`🔗 Backfilling tenant for org "${org.name}" (${org.slug})`);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Tenant
      const tenant = await tx.tenant.create({
        data: {
          name: org.name,
          slug: org.slug,
        },
      });

      // 2. Link Organization → Tenant
      await tx.organization.update({
        where: { id: org.id },
        data: { tenantId: tenant.id },
      });

      // 3. Create default Application
      const app = await tx.application.create({
        data: {
          tenantId: tenant.id,
          name: `${org.name} App`,
          slug: DEFAULT_APP_SLUG,
          description: "Default application (auto-created during backfill)",
        },
      });

      // 4. Copy memberships as TenantMembers
      for (const member of org.members) {
        const tenantRole =
          member.role === "OWNER"
            ? "OWNER"
            : member.role === "ADMIN"
              ? "ADMIN"
              : "VIEWER";

        await tx.tenantMember.upsert({
          where: {
            tenantId_userId: { tenantId: tenant.id, userId: member.userId },
          },
          create: {
            tenantId: tenant.id,
            userId: member.userId,
            role: tenantRole,
          },
          update: {},
        });
      }

      return { tenant, app };
    });

    console.log(
      `   ✅ Tenant "${result.tenant.name}" (${result.tenant.slug}) created`,
    );
    console.log(
      `   ✅ Application "${result.app.name}" (${result.app.slug}) created`,
    );
    console.log(`   ✅ ${org.members.length} member(s) copied`);
    created++;
  }

  console.log(`\n🎉 Done. ${created} org(s) backfilled, ${skipped} already had tenants.`);
}

main()
  .catch((err) => {
    console.error("❌ Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
