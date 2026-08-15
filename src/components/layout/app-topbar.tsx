"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, Menu, Zap } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "@/components/layout/app-sidebar";
import { signOutAction } from "@/app/(auth)/actions";

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

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:hidden">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard">
          <Logo compact />
        </Link>
      </div>

      <div className="flex items-center gap-2">
        {isDemo && (
          <Badge variant="warning">
            <Zap className="h-3 w-3" /> Demo
          </Badge>
        )}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-xs font-bold text-brand-400">
          {userName.slice(0, 1).toUpperCase()}
        </div>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-72 flex-col p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-16 items-center border-b border-border px-5">
            <Logo />
          </div>
          <SidebarNav onNavigate={() => setOpen(false)} />
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
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
