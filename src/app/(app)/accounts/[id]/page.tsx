import React from "react";
import type { Metadata } from "next";
import { OmniAccountDetailView } from "@/components/accounts/omni-account-detail-view";

export const metadata: Metadata = { title: "Account Details" };
export const dynamic = "force-dynamic";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OmniAccountDetailView accountId={id} />;
}
