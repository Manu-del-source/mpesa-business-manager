import React from "react";
import type { Metadata } from "next";
import { OmniRefundsView } from "@/components/refunds/omni-refunds-view";

export const metadata: Metadata = { title: "Refunds" };
export const dynamic = "force-dynamic";

export default async function RefundsPage() {
  return <OmniRefundsView />;
}
