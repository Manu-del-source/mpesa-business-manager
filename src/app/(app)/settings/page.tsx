import type { Metadata } from "next";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { OrgSettingsForm } from "@/components/settings/org-settings-form";
import { DangerZone } from "@/components/settings/danger-zone";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireAppContext();

  const [members, counts] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.$transaction([
      prisma.product.count({ where: { organizationId: ctx.orgId } }),
      prisma.sale.count({ where: { organizationId: ctx.orgId } }),
      prisma.customer.count({ where: { organizationId: ctx.orgId } }),
    ]),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Manage your business profile and data." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business profile</CardTitle>
          <CardDescription>
            Shown across the app and on your receipts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgSettingsForm
            name={ctx.org.name}
            businessType={ctx.org.businessType}
            tier={ctx.org.tier}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
          <CardDescription>
            {members.length} member{members.length === 1 ? "" : "s"} on this account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15 text-xs font-bold text-brand-400">
                  {(member.firstName ?? "U").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {[member.firstName, member.lastName].filter(Boolean).join(" ") || "Team member"}
                  </p>
                  <p className="text-xs text-muted-foreground">{member.userId}</p>
                </div>
              </div>
              <Badge variant={member.role === "OWNER" ? "success" : "secondary"}>
                {member.role}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your data</CardTitle>
          <CardDescription>
            {counts[0]} products · {counts[1]} sales · {counts[2]} customers
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DangerZone />
        </CardContent>
      </Card>

      <Separator />
      <p className="pb-8 text-center text-xs text-muted-foreground">
        M-Pesa Business Manager · v1.0.0 · Made in Nairobi 🇰🇪
      </p>
    </div>
  );
}
