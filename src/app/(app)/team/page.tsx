import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniTeamView } from "@/components/team/omni-team-view";

export const metadata: Metadata = { title: "Team & RBAC" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { ctx, permissions } = await getPageContext();

  return <OmniTeamView canManage={permissions.includes("members:manage")} currentUserRole={ctx.tenantRole} />;
}
