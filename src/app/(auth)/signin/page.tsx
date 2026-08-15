import type { Metadata } from "next";
import { isDemoMode } from "@/lib/env";
import { SignInForm } from "@/components/auth/signin-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <SignInForm demoMode={isDemoMode()} />;
}
