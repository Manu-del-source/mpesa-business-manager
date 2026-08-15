"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orgSettingsSchema } from "@/lib/validations";

export type ActionResult = { error?: string; success?: string };

export async function updateOrgAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const parsed = orgSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  await prisma.organization.update({
    where: { id: ctx.orgId },
    data: { name: parsed.data.name, businessType: parsed.data.businessType },
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { success: "Business details updated." };
}

/** Danger zone: wipe all data for the current organization. */
export async function clearOrganizationDataAction(): Promise<ActionResult> {
  const ctx = await requireAppContext();

  await prisma.$transaction([
    prisma.saleItem.deleteMany({ where: { sale: { organizationId: ctx.orgId } } }),
    prisma.sale.deleteMany({ where: { organizationId: ctx.orgId } }),
    prisma.expense.deleteMany({ where: { organizationId: ctx.orgId } }),
    prisma.mpesaTransaction.deleteMany({ where: { organizationId: ctx.orgId } }),
    prisma.customer.deleteMany({ where: { organizationId: ctx.orgId } }),
    prisma.product.deleteMany({ where: { organizationId: ctx.orgId } }),
  ]);

  revalidatePath("/", "layout");
  return { success: "All business data has been cleared." };
}
