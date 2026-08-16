import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  FlaskConical,
  Settings2,
} from "lucide-react";
import type { SafeMpesaConfig } from "@/lib/mpesa/config";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The canonical M-Pesa configuration states surfaced across the UI:
 *   demo          — DEMO_MODE, simulated end to end
 *   not_configured— no credentials saved
 *   disabled      — credentials saved but switched off
 *   ready         — live Daraja, sandbox or production
 */
export type MpesaConfigState = "demo" | "not_configured" | "disabled" | "ready";

export function resolveConfigState(config: SafeMpesaConfig): MpesaConfigState {
  if (config.demoMode) return "demo";
  if (!config.configured) return "not_configured";
  if (!config.enabled) return "disabled";
  return "ready";
}

const STATE_META: Record<
  MpesaConfigState,
  { label: string; variant: "success" | "warning" | "secondary" | "muted" }
> = {
  demo: { label: "Demo mode", variant: "warning" },
  not_configured: { label: "Not configured", variant: "secondary" },
  disabled: { label: "Disabled", variant: "muted" },
  ready: { label: "Ready", variant: "success" },
};

export function MpesaStateBadge({ config }: { config: SafeMpesaConfig }) {
  const state = resolveConfigState(config);
  const meta = STATE_META[state];
  return (
    <Badge variant={meta.variant}>
      {meta.label}
      {state === "ready" && config.environment === "sandbox" ? " · Sandbox" : ""}
      {state === "ready" && config.environment === "production" ? " · Live" : ""}
    </Badge>
  );
}

/** Full-width explanatory banner for the M-Pesa and settings pages. */
export function MpesaStateBanner({
  config,
  showSettingsLink = false,
  className,
}: {
  config: SafeMpesaConfig;
  showSettingsLink?: boolean;
  className?: string;
}) {
  const state = resolveConfigState(config);

  const content: Record<
    MpesaConfigState,
    { icon: React.ReactNode; title: string; body: string; tone: string }
  > = {
    demo: {
      icon: <FlaskConical className="h-4 w-4 text-warning" />,
      title: "Demo mode — payments are simulated",
      body: "No requests are sent to Safaricom. STK pushes create a pending transaction you can complete with “Simulate payment”. Set DEMO_MODE=false and add Daraja credentials to go live.",
      tone: "border-warning/30 bg-warning/5",
    },
    not_configured: {
      icon: <Settings2 className="h-4 w-4 text-muted-foreground" />,
      title: "M-Pesa is not configured",
      body: "Add your Safaricom Daraja consumer key, secret, passkey and shortcode to start accepting real payments. Until then STK push runs in simulated mode.",
      tone: "border-border bg-muted/30",
    },
    disabled: {
      icon: <CircleSlash className="h-4 w-4 text-muted-foreground" />,
      title: "M-Pesa payments are disabled",
      body: "Credentials are saved but switched off, so STK push falls back to the simulated flow. Turn on “Enable M-Pesa payments” when you're ready.",
      tone: "border-border bg-muted/30",
    },
    ready: {
      icon:
        config.environment === "production" ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <FlaskConical className="h-4 w-4 text-brand-400" />
        ),
      title:
        config.environment === "production"
          ? `Live on Safaricom production · shortcode ${config.shortcode}`
          : `Connected to Daraja sandbox · shortcode ${config.shortcode}`,
      body:
        config.environment === "production"
          ? "STK pushes are real and move real money. Payments are confirmed by the Safaricom callback."
          : "STK pushes go to the Daraja sandbox. Use a Safaricom test MSISDN such as 254708374149.",
      tone:
        config.environment === "production"
          ? "border-success/30 bg-success/5"
          : "border-brand-500/30 bg-brand-500/5",
    },
  };

  const meta = content[state];

  return (
    <div className={cn("flex gap-3 rounded-lg border p-4 text-sm", meta.tone, className)}>
      <div className="mt-0.5 shrink-0">{meta.icon}</div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{meta.title}</p>
        <p className="mt-0.5 text-muted-foreground">{meta.body}</p>
        {!config.encryptionEnabled && config.source === "organization" && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="h-3 w-3" />
            MPESA_CREDENTIALS_KEY is not set — secrets are stored unencrypted.
          </p>
        )}
        {showSettingsLink && (
          <Link
            href="/settings/mpesa"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:underline"
          >
            <Settings2 className="h-3 w-3" /> Open M-Pesa settings
          </Link>
        )}
      </div>
    </div>
  );
}
