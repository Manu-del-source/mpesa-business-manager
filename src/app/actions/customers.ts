"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { customerSchema } from "@/lib/validations";

export type ActionResult = { error?: string; success?: string };

export async function createCustomerAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { name, phone, email, location, notes } = parsed.data;

  await prisma.customer.create({
    data: {
      organizationId: ctx.orgId,
      name,
      phone: phone || null,
      email: email || null,
      location: location || null,
      notes: notes || null,
    },
  });

  revalidatePath("/customers");
  return { success: `${name} added as a customer.` };
}

export async function updateCustomerAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const id = String((input as { id?: string }).id ?? "");
  if (!id) return { error: "Missing customer id." };

  const { name, phone, email, location, notes } = parsed.data;
  const existing = await prisma.customer.findFirst({
    where: { id, organizationId: ctx.orgId },
  });
  if (!existing) return { error: "Customer not found." };

  await prisma.customer.update({
    where: { id },
    data: {
      name,
      phone: phone || null,
      email: email || null,
      location: location || null,
      notes: notes || null,
    },
  });

  revalidatePath("/customers");
  return { success: `${name} updated.` };
}

export async function deleteCustomerAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const id = String((input as { id?: string }).id ?? "");
  const customer = await prisma.customer.findFirst({
    where: { id, organizationId: ctx.orgId },
  });
  if (!customer) return { error: "Customer not found." };

  await prisma.customer.delete({ where: { id } });
  revalidatePath("/customers");
  return { success: `${customer.name} deleted.` };
}
