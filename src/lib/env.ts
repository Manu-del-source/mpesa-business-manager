/**
 * Centralized, typed access to environment variables.
 *
 * Demo mode is explicit: set DEMO_MODE=true for local/demo environments.
 * Supabase credentials may still be omitted in demo mode.
 */
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  demoMode: process.env.DEMO_MODE === "true",
  darajaEnabled: process.env.DARAJA_ENABLED === "true",
  darajaConsumerKey: process.env.DARAJA_CONSUMER_KEY ?? "",
  darajaConsumerSecret: process.env.DARAJA_CONSUMER_SECRET ?? "",
  darajaPasskey: process.env.DARAJA_PASSKEY ?? "",
  darajaShortcode: process.env.DARAJA_SHORTCODE ?? "",
  darajaEnvironment: process.env.DARAJA_ENVIRONMENT ?? "sandbox",
} as const;

export function isDemoMode(): boolean {
  return env.demoMode;
}

export function isDarajaConfigured(): boolean {
  return (
    env.darajaEnabled &&
    Boolean(env.darajaConsumerKey && env.darajaConsumerSecret && env.darajaShortcode)
  );
}

export function assertDatabaseConfigured(): void {
  if (!env.databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Start PostgreSQL and set DATABASE_URL in .env.",
    );
  }
}
