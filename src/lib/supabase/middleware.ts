import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * Refreshes the Supabase auth session on every request when Supabase is
 * configured. In demo mode (no Supabase env vars) requests pass through
 * untouched — auth is handled by the demo session cookie.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: avoid refreshing the session on auth endpoints themselves.
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/signin") || pathname.startsWith("/signup");
  if (!isAuthRoute) {
    await supabase.auth.getUser();
  }

  return response;
}
