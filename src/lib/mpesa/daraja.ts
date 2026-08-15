import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Safaricom Daraja API — STK Push (Lipa Na M-Pesa Online).
 *
 * This is the production seam for real M-Pesa payments. It is only invoked
 * when DARAJA_ENABLED=true and the Daraja credentials are present; otherwise
 * the app uses the simulated flow in `src/lib/mpesa/index.ts`.
 *
 * Setup (sandbox):
 *   1. Create a developer account at https://developer.safaricom.co.ke
 *   2. Create an app to get a Consumer Key + Secret.
 *   3. For sandbox you also need the M-PESA sandbox passkey + shortcode
 *      (174379) from the API docs, and a test phone (e.g. 254708374149).
 *   4. Set DARAJA_ENABLED=true, DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET,
 *      DARAJA_PASSKEY, DARAJA_SHORTCODE, DARAJA_ENVIRONMENT=sandbox.
 */

type DarajaToken = { access_token: string; expires_in: number };

async function getAccessToken(): Promise<string> {
  const auth = Buffer.from(
    `${env.darajaConsumerKey}:${env.darajaConsumerSecret}`,
  ).toString("base64");

  const baseUrl =
    env.darajaEnvironment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as DarajaToken;
  return data.access_token;
}

export async function initiateDarajaStkPush(input: {
  orgId: string;
  phone: string;
  amount: number;
  reference?: string;
  description?: string;
}): Promise<{ ok: true; transactionId: string } | { ok: false; error: string }> {
  try {
    const token = await getAccessToken();
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, "")
      .slice(0, 14);
    const password = Buffer.from(
      `${env.darajaShortcode}${env.darajaPasskey}${timestamp}`,
    ).toString("base64");

    const baseUrl =
      env.darajaEnvironment === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    const body = {
      BusinessShortCode: env.darajaShortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(input.amount),
      PartyA: input.phone,
      PartyB: env.darajaShortcode,
      PhoneNumber: input.phone,
      CallBackURL: `${env.appUrl}/api/mpesa/callback`,
      AccountReference: input.reference ?? "MBM-SALE",
      TransactionDesc: input.description ?? "Payment",
    };

    const res = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = (await res.json()) as {
      ResponseCode?: string;
      ResponseDescription?: string;
      CheckoutRequestID?: string;
    };

    if (data.ResponseCode !== "0" || !data.CheckoutRequestID) {
      return { ok: false, error: data.ResponseDescription ?? "M-Pesa request failed." };
    }

    const txn = await prisma.mpesaTransaction.create({
      data: {
        organizationId: input.orgId,
        direction: "INCOMING",
        phone: input.phone,
        amount: new Prisma.Decimal(input.amount),
        status: "PENDING",
        reference: input.reference ?? null,
        description: input.description ?? null,
        transactionType: "STK_PUSH",
      },
    });

    return { ok: true, transactionId: txn.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "M-Pesa request failed.",
    };
  }
}
