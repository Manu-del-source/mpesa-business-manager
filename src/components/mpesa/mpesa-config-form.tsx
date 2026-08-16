"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Lock,
  PlugZap,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { SafeMpesaConfig } from "@/lib/mpesa/config";
import { MPESA_KEEP_EXISTING } from "@/lib/validations";
import {
  deleteMpesaConfigAction,
  saveMpesaConfigAction,
  testMpesaConnectionAction,
} from "@/app/actions/mpesa-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { MpesaStateBanner } from "@/components/mpesa/mpesa-state";

/**
 * Daraja credential form.
 *
 * The component only ever receives a masked `SafeMpesaConfig` — secrets are
 * write-only. Leaving the secret fields blank on an existing configuration
 * keeps the stored values.
 */
export function MpesaConfigForm({ initial }: { initial: SafeMpesaConfig }) {
  const [config, setConfig] = useState(initial);
  const [environment, setEnvironment] = useState(initial.environment);
  const [shortcode, setShortcode] = useState(initial.shortcode);
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [passkey, setPasskey] = useState("");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [callbackUrl, setCallbackUrl] = useState(
    initial.source === "organization" ? initial.callbackUrl : "",
  );
  const [saving, startSaving] = useTransition();
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const isEnvManaged = config.source === "environment";

  function applyResult(next?: SafeMpesaConfig) {
    if (!next) return;
    setConfig(next);
    setEnvironment(next.environment);
    setShortcode(next.shortcode);
    setEnabled(next.enabled);
    // Never repopulate secrets.
    setConsumerSecret("");
    setPasskey("");
    setConsumerKey("");
  }

  function save() {
    startSaving(async () => {
      const result = await saveMpesaConfigAction({
        environment,
        shortcode,
        // Keep the stored key when the admin didn't retype it.
        consumerKey: consumerKey.trim() || MPESA_KEEP_EXISTING,
        consumerSecret: consumerSecret.trim(),
        passkey: passkey.trim(),
        enabled,
        callbackUrl: callbackUrl.trim(),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Saved.");
      applyResult(result.data);
    });
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await testMpesaConnectionAction();
      if (result.error) toast.error(result.error);
      else toast.success(result.success ?? "Connection OK.");
      applyResult(result.data);
    } finally {
      setTesting(false);
    }
  }

  async function removeConfig() {
    setRemoving(true);
    try {
      const result = await deleteMpesaConfigAction();
      if (result.error) toast.error(result.error);
      else toast.success(result.success ?? "Removed.");
      applyResult(result.data);
      setCallbackUrl("");
    } finally {
      setRemoving(false);
    }
  }

  async function copyCallback() {
    try {
      await navigator.clipboard.writeText(config.callbackUrl);
      toast.success("Callback URL copied.");
    } catch {
      toast.error("Could not copy — select and copy it manually.");
    }
  }

  return (
    <div className="space-y-6">
      <MpesaStateBanner config={config} />

      {isEnvManaged && (
        <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <p className="font-medium">Configured from environment variables</p>
            <p className="text-muted-foreground">
              This deployment uses the legacy <code>DARAJA_*</code> environment
              variables. Saving below creates per-business credentials that take
              precedence over them.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Environment</Label>
          <Select
            value={environment}
            onValueChange={(v) => setEnvironment(v as "sandbox" | "production")}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">Sandbox (testing)</SelectItem>
              <SelectItem value="production">Production (live money)</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Sandbox uses shortcode 174379 and test numbers only.
          </p>
        </div>

        <div>
          <Label>Business shortcode</Label>
          <Input
            className="mt-1.5"
            inputMode="numeric"
            placeholder="174379"
            value={shortcode}
            onChange={(e) => setShortcode(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Your paybill or till number.
          </p>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Daraja API credentials</p>
        </div>

        <div>
          <Label>Consumer key</Label>
          <Input
            className="mt-1.5 font-mono text-xs"
            autoComplete="off"
            placeholder={
              config.consumerKeyMasked
                ? `${config.consumerKeyMasked} — leave blank to keep`
                : "From your Daraja app"
            }
            value={consumerKey}
            onChange={(e) => setConsumerKey(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Consumer secret</Label>
            <Input
              className="mt-1.5 font-mono text-xs"
              type="password"
              autoComplete="new-password"
              placeholder={config.hasConsumerSecret ? "•••••••• — leave blank to keep" : "From your Daraja app"}
              value={consumerSecret}
              onChange={(e) => setConsumerSecret(e.target.value)}
            />
          </div>
          <div>
            <Label>Passkey</Label>
            <Input
              className="mt-1.5 font-mono text-xs"
              type="password"
              autoComplete="new-password"
              placeholder={config.hasPasskey ? "•••••••• — leave blank to keep" : "Lipa Na M-Pesa passkey"}
              value={passkey}
              onChange={(e) => setPasskey(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p>
            Secrets are stored server-side and are never sent back to the browser.
            {config.encryptionEnabled
              ? " They are encrypted at rest with AES-256-GCM."
              : " Set MPESA_CREDENTIALS_KEY to encrypt them at rest."}
          </p>
        </div>
      </div>

      <Separator />

      <div>
        <Label>Callback URL</Label>
        <div className="mt-1.5 flex gap-2">
          <Input
            className="font-mono text-xs"
            placeholder={config.callbackUrl}
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
          />
          <Button type="button" variant="outline" size="icon" onClick={copyCallback}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Safaricom posts payment results here. Must be a public HTTPS URL —
          currently <span className="font-mono">{config.callbackUrl}</span>
        </p>
        {!config.callbackReachable && config.callbackWarning && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {config.callbackWarning} Real payments cannot complete until this
              is fixed.
            </span>
          </p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-medium">Enable M-Pesa payments</p>
          <p className="text-xs text-muted-foreground">
            When off, STK push falls back to the simulated demo flow.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </Button>
        <Button
          variant="outline"
          onClick={testConnection}
          disabled={testing || !config.configured}
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          Test connection
        </Button>
        {config.source === "organization" && (
          <Button variant="ghost" onClick={removeConfig} disabled={removing} className="text-destructive">
            {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Remove credentials
          </Button>
        )}
        {config.configured && (
          <Badge variant={config.enabled ? "success" : "secondary"} className="ml-auto">
            {config.enabled ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Enabled
              </span>
            ) : (
              "Disabled"
            )}
          </Badge>
        )}
      </div>
    </div>
  );
}


