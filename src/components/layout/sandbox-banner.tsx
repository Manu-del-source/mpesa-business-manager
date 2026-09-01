"use client";

import React from "react";

export function SandboxBanner({ environment }: { environment: "SANDBOX" | "LIVE" }) {
  if (environment !== "SANDBOX") return null;

  return (
    <div
      id="sandbox-banner"
      className="sticky top-0 z-[60] w-full bg-amber-500 text-amber-950 text-label-caps font-label-caps py-1 px-4 text-center font-bold tracking-widest uppercase flex items-center justify-center gap-2 shadow-sm"
    >
      <span className="material-symbols-outlined text-[16px]">science</span>
      <span>Sandbox Environment Active — Test Mode • No Real Money Moved</span>
    </div>
  );
}
