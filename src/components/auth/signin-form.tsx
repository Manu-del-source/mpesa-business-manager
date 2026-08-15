"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { signInSchema } from "@/lib/validations";
import { signInAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type SignInValues = z.infer<typeof signInSchema>;

export function SignInForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: demoMode ? "demo@kijani.local" : "",
      password: demoMode ? "demo1234" : "",
    },
  });

  async function onSubmit(values: SignInValues) {
    setPending(true);
    try {
      const result = await signInAction(values);
      if (result?.error) toast.error(result.error);
      if (result?.success) {
        toast.success(result.success);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
      <div className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your business dashboard.</p>
      </div>

      {demoMode && (
        <div className="mb-6 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-xs text-brand-300">
          <span className="font-semibold">Demo mode</span> — no account needed. Click{" "}
          <span className="font-semibold">Sign in</span> to explore with sample data.
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="you@business.co.ke" autoComplete="email" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <Input type="password" placeholder="••••••••" autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to M-Pesa Business Manager?{" "}
        <Link href="/signup" className="font-medium text-brand-400 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
