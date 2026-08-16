"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth";
import {
  deleteMpesaConfig,
  getSafeMpesaConfig,
  resolveMpesaConfig,
  saveMpesaConfig,
  type SafeMpesaConfig,
} from "@/lib/mpesa/config";
import { verifyCredentials } from "@/lib/mpesa/oauth";
import { logMpesa, logMpesaError } from "@/lib/mpesa/log";
import { mpesaConfigSchema } from "@/lib/validations";

/**
 * Server actions for per-organization Daraja configuration.
 *
 * Every action returns only `SafeMpesaConfig` (masked). Consumer secrets and
 * passkeys are written but never read back to the caller.
 */

export type MpesaConfigActionResult = {
  error?: string;
  success?: string;
  data?: SafeMpesaConfig;
};

/** Only OWNER/ADMIN may view or change payment credentials. */
async function requireAdminContext() {
  const ctx = await requireAppContext();
  if (ctx.role !== "OWNER" && ctx.role !== "ADMIN") {
    return { ctx: null as never, error: "Only an owner or admin can manage M-Pesa settings." };
  }
  return { ctx, error: null };
}

export async function getMpesaConfigAction(): Promise<MpesaConfigActionResult> {
  const { ctx, error } = await requireAdminContext();
  if (error) return { error };
  return { data: await getSafeMpesaConfig(ctx.orgId) };
}

export async function saveMpesaConfigAction(
  input: unknown,
): Promise<MpesaConfigActionResult> {
  const { ctx, error } = await requireAdminContext();
  if (error) return { error };

  const parsed = mpesaConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid M-Pesa configuration." };
  }

  try {
    const data = await saveMpesaConfig(ctx.orgId, {
      environment: parsed.data.environment,
      shortcode: parsed.data.shortcode,
      consumerKey: parsed.data.consumerKey,
      consumerSecret: parsed.data.consumerSecret || undefined,
      passkey: parsed.data.passkey || undefined,
      enabled: parsed.data.enabled,
      callbackUrl: parsed.data.callbackUrl || undefined,
    });

    // Note: no credential values are logged here — only the outcome.
    logMpesa("config.saved", {
      orgId: ctx.orgId,
      environment: parsed.data.environment,
      enabled: parsed.data.enabled,
    });

    revalidatePath("/settings/mpesa");
    revalidatePath("/mpesa");
    return { success: "M-Pesa settings saved.", data };
  } catch (err) {
    logMpesaError("config.save_failed", {
      orgId: ctx.orgId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      error: err instanceof Error ? err.message : "Could not save M-Pesa settings.",
    };
  }
}

/** Fetch a Daraja OAuth token to prove the stored credentials work. */
export async function testMpesaConnectionAction(): Promise<MpesaConfigActionResult> {
  const { ctx, error } = await requireAdminContext();
  if (error) return { error };

  const config = await resolveMpesaConfig(ctx.orgId);
  if (!config) {
    return { error: "Save your Daraja credentials before testing the connection." };
  }
  if (!config.consumerKey || !config.consumerSecret) {
    return { error: "Consumer key and secret are required to test the connection." };
  }

  const result = await verifyCredentials(config);
  if (!result.ok) {
    logMpesaError("config.test_failed", { orgId: ctx.orgId, code: result.code });
    return { error: result.message };
  }

  logMpesa("config.test_ok", { orgId: ctx.orgId, environment: config.environment });
  return {
    success: `Connected to Safaricom Daraja (${config.environment}). Credentials are valid.`,
    data: await getSafeMpesaConfig(ctx.orgId),
  };
}

export async function deleteMpesaConfigAction(): Promise<MpesaConfigActionResult> {
  const { ctx, error } = await requireAdminContext();
  if (error) return { error };

  await deleteMpesaConfig(ctx.orgId);
  logMpesa("config.deleted", { orgId: ctx.orgId });

  revalidatePath("/settings/mpesa");
  revalidatePath("/mpesa");
  return {
    success: "M-Pesa credentials removed.",
    data: await getSafeMpesaConfig(ctx.orgId),
  };
}
