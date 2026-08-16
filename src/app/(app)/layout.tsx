import { requireAppContext } from "@/lib/auth";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();

  const shell = {
    orgName: ctx.org.name,
    tier: ctx.org.tier,
    userName: ctx.user.name,
    userEmail: ctx.user.email,
    isDemo: ctx.user.isDemo,
  };

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar {...shell} />
      <div className="flex min-h-screen flex-col md:pl-[248px]">
        <AppTopbar {...shell} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
