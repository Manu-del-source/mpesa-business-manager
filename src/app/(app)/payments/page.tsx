import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniPaymentsView } from "@/components/payments/omni-payments-view";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const { ctx, permissions } = await getPageContext();

  return (
    <OmniPaymentsView
      environment={ctx.environment}
      applicationName={ctx.application.name}
      canCreate={permissions.includes("payments:create")}
    />
  );
}
