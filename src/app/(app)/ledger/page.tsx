import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniLedgerView } from "@/components/ledger/omni-ledger-view";

export const metadata: Metadata = { title: "Ledger" };
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const { ctx, permissions } = await getPageContext();

  return (
    <OmniLedgerView
      environment={ctx.environment}
      applicationName={ctx.application.name}
      canPost={permissions.includes("ledger:post")}
    />
  );
}
