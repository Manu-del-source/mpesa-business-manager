"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  ReceiptText,
  Settings,
  Smartphone,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/(auth)/actions";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavGroup = { label: string; items: NavItem[] };

/**
 * Navigation is grouped so the sidebar reads as a hierarchy rather than a
 * flat list of nine links. "Money" is what the shop owner touches daily.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Money",
    items: [
      { href: "/sales", label: "Sales", icon: ReceiptText },
      { href: "/mpesa", label: "M-Pesa", icon: Smartphone },
      { href: "/expenses", label: "Expenses", icon: Wallet },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/inventory", label: "Inventory", icon: Package },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
];

/** Flat list retained for any consumer that needs every destination. */
export const NAV_ITEMS: NavItem[] = [
  ...NAV_GROUPS.flatMap((g) => g.items),
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="thin-scroll flex-1 space-y-6 overflow-y-auto px-3 py-4">
      <Button asChild className="w-full justify-center" size="lg">
        <Link href="/sales" onClick={onNavigate}>
          <Plus className="h-4 w-4" /> New sale
        </Link>
      </Button>

      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="space-y-0.5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {/* Active rail — clearer than a background alone. */}
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}

      <div className="space-y-0.5">
        <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          System
        </p>
        {(() => {
          const active = isActive(pathname, "/settings");
          return (
            <Link
              href="/settings"
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Settings
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              Settings
            </Link>
          );
        })()}
      </div>
    </nav>
  );
}

export function SidebarFooter({
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
    <div className="space-y-3 border-t border-border p-3">
      {isDemo && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-2.5 py-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-[11px] leading-snug text-muted-foreground">
            <span className="font-medium text-warning">Demo mode</span> — data is
            simulated.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="truncate text-xs font-semibold" title={orgName}>
            {orgName}
          </p>
          <Badge variant={tier === "PRO" ? "success" : "muted"} size="sm">
            {tier}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">
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
            aria-label="Sign out"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppSidebar(props: {
  orgName: string;
  tier: string;
  userName: string;
  userEmail: string;
  isDemo: boolean;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
        <Link href="/dashboard" className="transition-opacity hover:opacity-80">
          <Logo />
        </Link>
      </div>
      <SidebarNav />
      <SidebarFooter {...props} />
    </aside>
  );
}
