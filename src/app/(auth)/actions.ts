"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isDemoMode, env } from "@/lib/env";
import { DEMO_SESSION_COOKIE } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validations";

export type AuthActionResult = { error?: string; success?: string };

async function setDemoSession() {
  const store = await cookies();
  store.set(DEMO_SESSION_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function signInAction(input: unknown): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  const { email, password } = parsed.data;

  if (isDemoMode()) {
    await setDemoSession();
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect("/dashboard");
}

export async function signUpAction(input: unknown): Promise<AuthActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  const { email, password, fullName } = parsed.data;

  if (isDemoMode()) {
    await setDemoSession();
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const { error, data } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${env.appUrl}/auth/callback` },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/dashboard");
  return { success: "Account created! Check your inbox to confirm your email, then sign in." };
}

export async function forgotPasswordAction(input: unknown): Promise<AuthActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter a valid email." };

  if (!isDemoMode()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${env.appUrl}/auth/callback?next=/reset-password`,
    });
    if (error) return { error: error.message };
  }
  return { success: "If that account exists, a password reset link has been sent to your email." };
}

export async function updatePasswordAction(input: unknown): Promise<AuthActionResult> {
  const parsed = signInSchema.pick({ password: true }).safeParse(input);
  if (!parsed.success) return { error: "Password must be at least 6 characters." };
  if (isDemoMode()) return { success: "Demo mode doesn't use passwords — you're all set." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };
  return { success: "Password updated. You can now sign in." };
}

export async function signOutAction(): Promise<void> {
  if (isDemoMode()) {
    const store = await cookies();
    store.delete(DEMO_SESSION_COOKIE);
  } else {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/signin");
}
