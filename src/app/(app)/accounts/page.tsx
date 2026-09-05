import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniAccountsView } from "@/components/accounts/omni-accounts-view";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const { permissions } = await getPageContext();

  return <OmniAccountsView canCreate={permissions.includes("ledger:post")} />;
}
