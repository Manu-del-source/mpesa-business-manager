"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

export function createClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    // Demo mode — browser client is a no-op; auth is simulated server-side.
    return null;
  }
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
