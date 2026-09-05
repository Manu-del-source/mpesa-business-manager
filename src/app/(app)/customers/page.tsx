import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniCustomersView } from "@/components/customers/omni-customers-view";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const { permissions } = await getPageContext();

  return <OmniCustomersView canCreate={permissions.includes("payments:create")} />;
}
