/**
 * Centralized, typed access to environment variables.
 *
 * When Supabase credentials are absent the app runs in **demo mode**:
 * - Auth is simulated with a signed-in demo user (cookie based).
 * - M-Pesa STK push is simulated end-to-end (no Safaricom credentials needed).
 *
 * The Postgres database (DATABASE_URL) is always required — via Supabase or
 * the bundled docker-compose Postgres.
 */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",

  // Optional: real Daraja (Safaricom M-Pesa) API credentials. When unset,
  // M-Pesa flows are simulated so the product is fully demoable.
  darajaEnabled: process.env.DARAJA_ENABLED === "true",
  darajaConsumerKey: process.env.DARAJA_CONSUMER_KEY ?? "",
  darajaConsumerSecret: process.env.DARAJA_CONSUMER_SECRET ?? "",
  darajaPasskey: process.env.DARAJA_PASSKEY ?? "",
  darajaShortcode: process.env.DARAJA_SHORTCODE ?? "",
  darajaEnvironment: process.env.DARAJA_ENVIRONMENT ?? "sandbox",
} as const;

export function isDemoMode(): boolean {
  return !env.supabaseUrl || !env.supabaseAnonKey;
}

export function isDarajaConfigured(): boolean {
  return (
    env.darajaEnabled &&
    Boolean(env.darajaConsumerKey && env.darajaConsumerSecret && env.darajaShortcode)
  );
}
