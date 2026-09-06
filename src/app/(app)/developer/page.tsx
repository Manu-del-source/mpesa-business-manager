import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniDeveloperView } from "@/components/developer/omni-developer-view";

export const metadata: Metadata = { title: "Developers" };
export const dynamic = "force-dynamic";

export default async function DeveloperPage() {
  const { permissions } = await getPageContext();

  return (
    <OmniDeveloperView
      canManageApplications={permissions.includes("settings:manage")}
      canManageKeys={permissions.includes("api-keys:manage")}
      canManageWebhooks={permissions.includes("webhooks:manage")}
    />
  );
}
