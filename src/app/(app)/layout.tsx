import { requireAppContext } from "@/lib/auth";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();

  return (
    <div className="min-h-screen">
      <AppSidebar
        orgName={ctx.org.name}
        tier={ctx.org.tier}
        userName={ctx.user.name}
        userEmail={ctx.user.email}
        isDemo={ctx.user.isDemo}
      />
      <div className="flex min-h-screen flex-col md:pl-64">
        <AppTopbar
          orgName={ctx.org.name}
          tier={ctx.org.tier}
          userName={ctx.user.name}
          userEmail={ctx.user.email}
          isDemo={ctx.user.isDemo}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
