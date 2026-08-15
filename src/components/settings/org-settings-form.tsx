"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Zap } from "lucide-react";
import { orgSettingsSchema } from "@/lib/validations";
import { updateOrgAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

type Values = z.infer<typeof orgSettingsSchema>;

export function OrgSettingsForm({
  name,
  businessType,
  tier,
}: {
  name: string;
  businessType: string;
  tier: string;
}) {
  const [pending, setPending] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(orgSettingsSchema),
    defaultValues: { name, businessType },
  });

  async function onSubmit(values: Values) {
    setPending(true);
    try {
      const result = await updateOrgAction(values);
      if (result?.error) toast.error(result.error);
      else toast.success(result.success ?? "Business details updated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge variant={tier === "PRO" ? "success" : "secondary"}>
            {tier === "PRO" ? (
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" /> PRO plan
              </span>
            ) : (
              "FREE plan"
            )}
          </Badge>
        </div>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Kijani Fresh Foods" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="businessType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business type</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Retail, Restaurant, Agro-vet…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </form>
    </Form>
  );
}
