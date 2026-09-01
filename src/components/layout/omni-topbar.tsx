"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OmniSidebar, SidebarProps } from "./omni-sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function OmniTopbar(props: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const isLive = props.environment === "LIVE";

  // Derive page title from pathname
  const segments = pathname.split("/").filter(Boolean);
  const currentSegment = segments[0] || "dashboard";
  const title =
    currentSegment === "dashboard"
      ? "Overview"
      : currentSegment.charAt(0).toUpperCase() + currentSegment.slice(1);

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center justify-between w-full px-gutter h-16 bg-background border-b border-outline-variant">
        <div className="flex items-center gap-3">
          {/* Mobile menu trigger */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 -ml-2 text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors"
            aria-label="Open navigation"
          >
            <span className="material-symbols-outlined text-[24px]">menu</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="md:hidden font-bold text-headline-sm text-primary">OMNI</span>
            <span className="md:hidden text-outline-variant">/</span>
            <h1 className="text-headline-sm md:text-headline-md font-headline-md text-primary font-bold">
              {title}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Environment Indicator Pill */}
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-label-caps font-label-caps font-bold transition-all ${
              isLive
                ? "bg-secondary text-white shadow-sm"
                : "bg-amber-100 border border-amber-300 text-amber-900"
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${isLive ? "bg-white animate-pulse" : "bg-amber-600"}`} />
            <span>{isLive ? "LIVE" : "SANDBOX"}</span>
          </div>

          <Link
            href="/developer"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-body-sm font-medium text-on-surface-variant hover:text-primary hover:bg-surface-container rounded-lg transition-colors border border-outline-variant/60"
          >
            <span className="material-symbols-outlined text-[16px]">terminal</span>
            <span>API Docs</span>
          </Link>
        </div>
      </header>

      {/* Mobile Drawer Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-sidebar-width bg-surface-container-lowest border-r border-outline-variant">
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <OmniSidebar {...props} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
