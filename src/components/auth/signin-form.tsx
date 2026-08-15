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
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";

type SignInValues = z.infer<typeof signInSchema>;

export function SignInForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: demoMode ? "demo@kijani.local" : "", password: demoMode ? "demo1234" : "" },
  });

  async function onSubmit(values: SignInValues) {
    setPending(true);
    try {
      const result = await signInAction(values);
      if (result?.error) toast.error(result.error);
      if (result?.success) { toast.success(result.success); router.refresh(); }
    } finally { setPending(false); }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20">
      <div className="border-b border-border bg-gradient-to-br from-brand-500/15 via-card to-card p-6 sm:p-8">
        <div className="mb-3 inline-flex rounded-full border border-brand-500/25 bg-brand-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-300">
          {demoMode ? "Interactive demo" : "Business workspace"}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage sales, M-Pesa, stock and cash flow from one place.</p>
      </div>

      <div className="p-6 sm:p-8">
        {demoMode && (
          <div className="mb-6 rounded-xl border border-brand-500/25 bg-brand-500/10 p-4">
            <p className="text-sm font-semibold text-brand-200">Demo workspace ready</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              No account is required. The form is pre-filled with a sample business.
            </p>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>Email</FormLabel><FormControl>
                <Input className="h-11" type="email" placeholder="you@business.co.ke" autoComplete="email" {...field} />
              </FormControl><FormMessage /></FormItem>
            )}/>
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between"><FormLabel>Password</FormLabel>
                  <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground">Forgot password?</Link>
                </div>
                <FormControl><Input className="h-11" type="password" placeholder="••••••••" autoComplete="current-password" {...field}/></FormControl>
                <FormMessage />
              </FormItem>
            )}/>
            <Button type="submit" className="h-11 w-full shadow-lg shadow-brand-500/10" disabled={pending}>
              {pending ? "Opening workspace…" : demoMode ? "Enter demo workspace" : "Sign in"}
            </Button>
          </form>
        </Form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to M-Pesa Business Manager?{" "}
          <Link href="/signup" className="font-medium text-brand-400 hover:underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
