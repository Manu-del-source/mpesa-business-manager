import React from "react";
import { requireTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OmniSidebar } from "@/components/layout/omni-sidebar";
import { OmniTopbar } from "@/components/layout/omni-topbar";
import { SandboxBanner } from "@/components/layout/sandbox-banner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantContext();

  // Load available tenants and applications for switchers
  const [tenants, applications] = await Promise.all([
    prisma.tenant.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
    prisma.application.findMany({
      where: { tenantId: ctx.tenant.id },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const shellProps = {
    tenantName: ctx.tenant.name,
    tenantSlug: ctx.tenant.slug,
    applicationName: ctx.application.name,
    applicationSlug: ctx.application.slug,
    environment: ctx.environment,
    role: ctx.tenantRole,
    userName: ctx.user.name,
    userEmail: ctx.user.email,
    availableTenants: tenants,
    availableApplications: applications,
  };

  return (
    <div className="min-h-screen bg-background text-on-background antialiased flex flex-col">
      {/* Global Sandbox Warning Banner */}
      <SandboxBanner environment={ctx.environment} />

      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Fixed Sidebar */}
        <div className="hidden md:flex fixed left-0 top-0 bottom-0 z-40">
          <OmniSidebar {...shellProps} />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 md:ml-sidebar-width flex flex-col min-h-screen w-full">
          <OmniTopbar {...shellProps} />
          <main className="flex-1 p-4 md:p-gutter max-w-container-max mx-auto w-full">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
