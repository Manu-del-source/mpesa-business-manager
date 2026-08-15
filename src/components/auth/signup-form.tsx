"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { signUpSchema } from "@/lib/validations";
import { signUpAction } from "@/app/(auth)/actions";
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

type SignUpValues = z.infer<typeof signUpSchema>;

export function SignUpForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      fullName: demoMode ? "Demo Owner" : "",
      email: demoMode ? "demo@kijani.local" : "",
      password: demoMode ? "demo1234" : "",
    },
  });

  async function onSubmit(values: SignUpValues) {
    setPending(true);
    try {
      const result = await signUpAction(values);
      if (result?.error) toast.error(result.error);
      if (result?.success) {
        toast.success(result.success);
        router.push("/signin");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8">
      <div className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Start running your business from one dashboard.
        </p>
      </div>

      {demoMode && (
        <div className="mb-6 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-xs text-brand-300">
          <span className="font-semibold">Demo mode</span> — click{" "}
          <span className="font-semibold">Create account</span> to jump straight in.
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input placeholder="Grace Wanjiru" autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="At least 6 characters" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/signin" className="font-medium text-brand-400 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
