import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniReconciliationView } from "@/components/reconciliation/omni-reconciliation-view";

export const metadata: Metadata = { title: "Reconciliation" };
export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  const { permissions } = await getPageContext();

  return <OmniReconciliationView canRun={permissions.includes("reconciliation:run")} />;
}
