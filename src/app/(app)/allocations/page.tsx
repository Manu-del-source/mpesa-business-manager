import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniAllocationsView } from "@/components/allocations/omni-allocations-view";

export const metadata: Metadata = { title: "Allocations" };
export const dynamic = "force-dynamic";

export default async function AllocationsPage() {
  const { permissions } = await getPageContext();

  return <OmniAllocationsView canManage={permissions.includes("ledger:post")} />;
}
