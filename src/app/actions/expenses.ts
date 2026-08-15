"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { requireAppContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { expenseSchema } from "@/lib/validations";

export type ActionResult = { error?: string; success?: string };

export async function createExpenseAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { category, amount, description, vendor, expenseDate } = parsed.data;

  await prisma.expense.create({
    data: {
      organizationId: ctx.orgId,
      category,
      amount: new Prisma.Decimal(amount),
      description,
      vendor: vendor || null,
      expenseDate,
    },
  });

  revalidatePath("/expenses");
  return { success: "Expense recorded." };
}

export async function updateExpenseAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const id = String((input as { id?: string }).id ?? "");
  if (!id) return { error: "Missing expense id." };

  const existing = await prisma.expense.findFirst({
    where: { id, organizationId: ctx.orgId },
  });
  if (!existing) return { error: "Expense not found." };

  const { category, amount, description, vendor, expenseDate } = parsed.data;
  await prisma.expense.update({
    where: { id },
    data: {
      category,
      amount: new Prisma.Decimal(amount),
      description,
      vendor: vendor || null,
      expenseDate,
    },
  });

  revalidatePath("/expenses");
  return { success: "Expense updated." };
}

export async function deleteExpenseAction(input: unknown): Promise<ActionResult> {
  const ctx = await requireAppContext();
  const id = String((input as { id?: string }).id ?? "");
  const expense = await prisma.expense.findFirst({
    where: { id, organizationId: ctx.orgId },
  });
  if (!expense) return { error: "Expense not found." };

  await prisma.expense.delete({ where: { id } });
  revalidatePath("/expenses");
  return { success: "Expense deleted." };
}
