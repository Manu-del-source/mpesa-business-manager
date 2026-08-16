"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarFooter, SidebarNav, NAV_ITEMS } from "@/components/layout/app-sidebar";
import { ThemeToggle } from "@/components/theme/theme-toggle";

/**
 * Top bar for every authenticated page.
 *
 * Unlike the previous mobile-only header this is always visible: on desktop it
 * carries page context and the theme control, on mobile it also holds the
 * navigation drawer trigger.
 */
export function AppTopbar({
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
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const current =
    NAV_ITEMS.find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    ) ?? null;

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-ml-1 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link href="/dashboard" className="md:hidden">
          <Logo compact />
        </Link>

        {/* Desktop: show where you are. */}
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          <span className="truncate text-sm font-medium text-muted-foreground">
            {orgName}
          </span>
          {current && (
            <>
              <span className="text-muted-foreground/40">/</span>
              <span className="truncate text-sm font-semibold text-foreground">
                {current.label}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isDemo && (
          <Badge variant="warning" className="hidden sm:inline-flex" dot>
            <span className="hidden md:inline">Demo mode</span>
            <span className="md:hidden">Demo</span>
          </Badge>
        )}
        <ThemeToggle className="hidden sm:inline-flex" />
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white md:hidden"
          title={userName}
        >
          {userName.slice(0, 1).toUpperCase()}
        </div>
      </div>

      {/* Mobile navigation drawer */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-[280px] flex-col gap-0 bg-surface p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-16 shrink-0 items-center border-b border-border px-4">
            <Logo />
          </div>
          <SidebarNav onNavigate={() => setOpen(false)} />
          <div className="px-3 pb-2 sm:hidden">
            <ThemeToggle className="w-full justify-center" />
          </div>
          <SidebarFooter
            orgName={orgName}
            tier={tier}
            userName={userName}
            userEmail={userEmail}
            isDemo={isDemo}
          />
        </SheetContent>
      </Sheet>
    </header>
  );
}

/** Small inline demo hint used on marketing/auth surfaces. */
export function DemoHint() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Sparkles className="h-3 w-3 text-warning" /> Demo mode
    </span>
  );
}
