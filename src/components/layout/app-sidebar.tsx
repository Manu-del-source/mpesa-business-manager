"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  Package,
  ReceiptText,
  Settings,
  Smartphone,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { signOutAction } from "@/app/(auth)/actions";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sales", label: "Sales", icon: ReceiptText },
  { href: "/mpesa", label: "M-Pesa", icon: Smartphone },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <item.icon className={cn("h-4 w-4", active && "text-brand-400")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppSidebar({
  orgName,
  tier,
  userName,
  userEmail,
  isDemo,
}: {
  orgName: string;
  tier: string;
  userName: string;
  userEmail: string;
  isDemo: boolean;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card/50 md:flex">
      <div className="flex h-16 items-center border-b border-border px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <Logo />
        </Link>
      </div>

      <SidebarNav />

      <div className="border-t border-border p-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="truncate text-sm font-semibold">{orgName}</p>
          <Badge variant={tier === "PRO" ? "success" : "secondary"}>
            {tier === "PRO" ? (
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" /> PRO
              </span>
            ) : (
              "FREE"
            )}
          </Badge>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-400">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{userName}</p>
            <p className="truncate text-[11px] text-muted-foreground">{userEmail}</p>
          </div>
          <button
            type="button"
            onClick={() => void signOutAction()}
            title="Sign out"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {isDemo && (
          <p className="mt-3 px-1 text-[11px] text-muted-foreground">
            Demo mode — data is simulated. Connect Supabase to go live.
          </p>
        )}
      </div>
    </aside>
  );
}
