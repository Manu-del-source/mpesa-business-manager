import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Smartphone } from "lucide-react";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { OrgSettingsForm } from "@/components/settings/org-settings-form";
import { DangerZone } from "@/components/settings/danger-zone";
import { MpesaStateBadge } from "@/components/mpesa/mpesa-state";
import { getSafeMpesaConfig } from "@/lib/mpesa/config";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireAppContext();

  const [members, counts, mpesaConfig] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.orgId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.$transaction([
      prisma.product.count({ where: { organizationId: ctx.orgId } }),
      prisma.sale.count({ where: { organizationId: ctx.orgId } }),
      prisma.customer.count({ where: { organizationId: ctx.orgId } }),
    ]),
    getSafeMpesaConfig(ctx.orgId),
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
          <CardTitle className="text-base">M-Pesa payments</CardTitle>
          <CardDescription>
            Connect Safaricom Daraja to accept real STK push payments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/settings/mpesa"
            className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:bg-accent/50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/15">
                <Smartphone className="h-4 w-4 text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Daraja configuration</p>
                <p className="text-xs text-muted-foreground">
                  Shortcode, consumer key, secret and passkey
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <MpesaStateBadge config={mpesaConfig} />
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>
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
