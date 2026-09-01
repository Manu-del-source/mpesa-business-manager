import React from "react";
import { OmniDashboardView } from "@/components/dashboard/omni-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return <OmniDashboardView />;
}
