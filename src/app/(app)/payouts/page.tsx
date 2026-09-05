import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniPayoutsView } from "@/components/payouts/omni-payouts-view";

export const metadata: Metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const { ctx, permissions } = await getPageContext();

  return (
    <OmniPayoutsView
      environment={ctx.environment}
      applicationName={ctx.application.name}
      canCreate={permissions.includes("payouts:create")}
    />
  );
}
