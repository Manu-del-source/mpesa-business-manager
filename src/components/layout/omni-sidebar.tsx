"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import { switchContext } from "@/lib/api/tenant";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SidebarProps = {
  tenantName: string;
  tenantSlug: string;
  applicationName: string;
  applicationSlug: string;
  environment: "SANDBOX" | "LIVE";
  role?: string;
  userName?: string;
  userEmail?: string;
  availableTenants?: Array<{ id: string; name: string; slug: string }>;
  availableApplications?: Array<{ id: string; name: string; slug: string }>;
  onNavigate?: () => void;
};

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/payments", label: "Payments", icon: "payments" },
  { href: "/customers", label: "Customers", icon: "group" },
  { href: "/accounts", label: "Accounts", icon: "account_balance" },
  { href: "/ledger", label: "Ledgers", icon: "account_balance_wallet" },
  { href: "/allocations", label: "Allocations", icon: "pie_chart" },
  { href: "/payouts", label: "Payouts", icon: "outbox" },
  { href: "/refunds", label: "Refunds", icon: "sync" },
  { href: "/reconciliation", label: "Reconciliation", icon: "compare_arrows" },
  { href: "/developer", label: "Developers", icon: "code" },
  { href: "/team", label: "Team & RBAC", icon: "badge" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function OmniSidebar({
  tenantName,
  tenantSlug,
  applicationName,
  applicationSlug,
  environment,
  role = "OWNER",
  userName = "User",
  userEmail = "user@domain.com",
  availableTenants = [],
  availableApplications = [],
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const isLive = environment === "LIVE";

  const handleToggleEnvironment = async () => {
    const nextEnv = isLive ? "SANDBOX" : "LIVE";
    await switchContext({ environment: nextEnv });
    startTransition(() => {
      router.refresh();
    });
  };

  const handleSwitchTenant = async (slug: string) => {
    await switchContext({ tenantSlug: slug });
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <aside className="w-sidebar-width h-full flex flex-col p-stack-default bg-surface-container-lowest border-r border-outline-variant select-none">
      {/* Header (Profile / Brand) */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary shrink-0">
            <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              developer_board
            </span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-headline-sm font-headline-sm font-bold text-primary tracking-tight">OMNI</span>
            <span className="text-body-sm font-body-sm text-on-surface-variant truncate">Developer Console</span>
          </div>
        </div>

        {/* Tenant & App Context Pickers */}
        <div className="mt-4 flex flex-col gap-1.5 p-2 rounded-lg border border-outline-variant bg-surface-container-low">
          <div className="flex items-center justify-between">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 text-body-sm font-medium text-primary hover:text-secondary text-left truncate max-w-[170px]">
                  <span className="truncate">{tenantName || "Select Org"}</span>
                  <span className="material-symbols-outlined text-[16px] text-outline">expand_more</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-surface-container-lowest border-outline-variant">
                <DropdownMenuLabel className="text-label-caps font-label-caps text-on-surface-variant">
                  Organizations
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {availableTenants.length > 0 ? (
                  availableTenants.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      onClick={() => handleSwitchTenant(t.slug)}
                      className={`text-body-sm cursor-pointer flex justify-between ${
                        t.slug === tenantSlug ? "bg-surface-container font-semibold" : ""
                      }`}
                    >
                      <span className="truncate">{t.name}</span>
                      {t.slug === tenantSlug && <span className="material-symbols-outlined text-[14px] text-secondary">check</span>}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem className="text-body-sm text-on-surface-variant" disabled>
                    {tenantName}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">
              {role}
            </span>
          </div>

          <div className="text-[11px] text-on-surface-variant truncate flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-outline">apps</span>
            <span className="truncate">{applicationName}</span>
          </div>
        </div>

        {/* Environment Switcher */}
        <div className="mt-3 flex items-center justify-between p-2 rounded-lg border border-outline-variant bg-surface-container-low">
          <div className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isLive ? "bg-secondary-container animate-pulse" : "bg-amber-500"
              }`}
            />
            <span className="text-label-caps font-label-caps uppercase font-bold text-primary">
              {isLive ? "Live Mode" : "Sandbox"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleToggleEnvironment}
            disabled={isPending}
            className="text-body-sm font-body-sm text-secondary hover:text-primary font-semibold transition-colors disabled:opacity-50"
          >
            {isLive ? "Switch to Test" : "Switch to Live"}
          </button>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto thin-scroll pr-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3.5 py-2 rounded-lg transition-colors font-medium text-body-md ${
                active
                  ? "text-on-secondary-fixed-variant bg-secondary-fixed font-semibold"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              <span className="text-body-md font-body-md truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer Meta & Sign out */}
      <div className="mt-auto pt-3 border-t border-outline-variant flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold text-primary">OMNI Infrastructure</span>
            <span className="text-code-sm font-code-sm text-on-surface-variant">KES Wallet • v2.4.1</span>
          </div>
          <button
            type="button"
            onClick={() => void signOutAction()}
            title="Sign out"
            className="p-1.5 text-on-surface-variant hover:text-red-700 hover:bg-red-50 rounded transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
