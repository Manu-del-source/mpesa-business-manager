import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { requireAppContext } from "@/lib/auth";
import { getSafeMpesaConfig } from "@/lib/mpesa/config";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MpesaConfigForm } from "@/components/mpesa/mpesa-config-form";

export const metadata: Metadata = { title: "M-Pesa settings" };
export const dynamic = "force-dynamic";

export default async function MpesaSettingsPage() {
  const ctx = await requireAppContext();
  const canManage = ctx.role === "OWNER" || ctx.role === "ADMIN";

  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title="M-Pesa settings" description="Safaricom Daraja configuration." />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Only an owner or admin can manage M-Pesa credentials. Ask the business
            owner to configure Daraja for {ctx.org.name}.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Masked view only — secrets never leave the server.
  const config = await getSafeMpesaConfig(ctx.orgId);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to settings
      </Link>

      <PageHeader
        title="M-Pesa settings"
        description={`Connect ${ctx.org.name} to Safaricom Daraja for real STK push payments.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Safaricom Daraja</CardTitle>
          <CardDescription>
            Credentials are stored server-side and never shown again after saving.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MpesaConfigForm initial={config} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" /> How to get sandbox credentials
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Create a free account at{" "}
              <a
                href="https://developer.safaricom.co.ke"
                target="_blank"
                rel="noreferrer"
                className="text-brand-400 hover:underline"
              >
                developer.safaricom.co.ke
              </a>
              .
            </li>
            <li>
              Create an app and copy its <strong>Consumer Key</strong> and{" "}
              <strong>Consumer Secret</strong>.
            </li>
            <li>
              Open <strong>M-Pesa Express (Lipa Na M-Pesa Online)</strong> under
              APIs to get the sandbox <strong>passkey</strong>; the sandbox
              shortcode is <span className="font-mono">174379</span>.
            </li>
            <li>
              Paste them above, choose <strong>Sandbox</strong>, enable payments
              and press <strong>Test connection</strong>.
            </li>
            <li>
              Make sure your callback URL is reachable from the public internet
              (use an ngrok/Cloudflare tunnel while developing) — Safaricom
              cannot post to <span className="font-mono">localhost</span>.
            </li>
            <li>
              Send an STK push to the sandbox test number{" "}
              <span className="font-mono">254708374149</span> and enter PIN{" "}
              <span className="font-mono">1234</span> in the simulator.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
