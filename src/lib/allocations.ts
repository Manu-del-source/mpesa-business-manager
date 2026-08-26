import "server-only";
import { prisma } from "@/lib/prisma";
import type { Environment } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitDefinition = {
  accountId: string;
  type: "percentage" | "fixed";
  value: number; // percentage (0-100) or fixed amount in minor units
};

export type AllocationResult = {
  allocations: Array<{
    accountId: string;
    amountMinor: bigint;
    percentage: number | null;
    roundingApplied: string | null;
  }>;
  totalAllocated: bigint;
  remainder: bigint; // Unallocated amount due to rounding
};

export type ApplyAllocationInput = {
  paymentId: string;
  applicationId: string;
  environment: Environment;
  amountMinor: bigint;
  currency: string;
  ruleId?: string;
};

// ---------------------------------------------------------------------------
// Rounding strategies
// ---------------------------------------------------------------------------

type RoundingMode = "HALF_UP" | "HALF_DOWN" | "TRUNCATE" | "CEIL";

function roundAmount(amount: number, mode: RoundingMode): number {
  switch (mode) {
    case "HALF_UP":
      return Math.round(amount);
    case "HALF_DOWN":
      return Math.floor(amount + 0.49);
    case "TRUNCATE":
      return Math.floor(amount);
    case "CEIL":
      return Math.ceil(amount);
  }
}

/**
 * Compute split amounts with deterministic rounding.
 *
 * For percentage-based splits:
 *   1. Compute each share = total × percentage / 100
 *   2. Round each share according to the rounding mode
 *   3. Assign remainder (total - sum of rounded shares) to the last account
 *
 * For fixed-amount splits:
 *   1. Assign the fixed amount to each account
 *   2. Assign remainder to the last account
 *
 * Invariants:
 *   - Sum of allocations == total amount
 *   - No allocation is negative
 *   - Every account in the split gets at least 1 minor unit (if total allows)
 */
export function computeAllocations(
  totalAmountMinor: bigint,
  splits: SplitDefinition[],
  roundingMode: RoundingMode = "HALF_UP",
): AllocationResult {
  if (splits.length === 0) {
    return { allocations: [], totalAllocated: 0n, remainder: totalAmountMinor };
  }

  if (totalAmountMinor <= 0n) {
    return { allocations: [], totalAllocated: 0n, remainder: 0n };
  }

  const total = Number(totalAmountMinor);
  const allocations: AllocationResult["allocations"] = [];
  let runningTotal = 0n;

  // First pass: compute rounded amounts
  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    let amount: number;

    if (split.type === "percentage") {
      amount = roundAmount((total * split.value) / 100, roundingMode);
    } else {
      amount = Math.min(split.value, total - Number(runningTotal));
    }

    // Ensure at least 1 minor unit if total allows
    if (amount < 1 && total - Number(runningTotal) >= 1) {
      amount = 1;
    }

    // Don't exceed remaining total
    const remaining = total - Number(runningTotal);
    if (amount > remaining) {
      amount = remaining;
    }

    const amountBig = BigInt(Math.floor(amount));
    runningTotal += amountBig;

    allocations.push({
      accountId: split.accountId,
      amountMinor: amountBig,
      percentage: split.type === "percentage" ? split.value : null,
      roundingApplied: amount !== Math.floor(amount) ? `${amount}→${Math.floor(amount)}` : null,
    });
  }

  // Assign remainder to the last allocation (ensures sum == total)
  const expectedTotal = totalAmountMinor;
  const actualTotal = allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
  const remainder = expectedTotal - actualTotal;

  if (remainder !== 0n && allocations.length > 0) {
    allocations[allocations.length - 1].amountMinor += remainder;
    allocations[allocations.length - 1].roundingApplied =
      `+${remainder} remainder`;
  }

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amountMinor, 0n);

  return {
    allocations,
    totalAllocated,
    remainder: 0n, // Remainder is always absorbed
  };
}

// ---------------------------------------------------------------------------
// Allocation application
// ---------------------------------------------------------------------------

/**
 * Apply allocations to a payment. Creates Allocation records in the database
 * and links them to the payment and (optionally) the allocation rule version.
 */
export async function applyAllocation(input: ApplyAllocationInput): Promise<AllocationResult> {
  // Find the active allocation rule for this application + environment
  let rule: { id: string; versions: Array<{ id: string; splits: unknown; roundingMode: string }> } | null = null;

  if (input.ruleId) {
    rule = await prisma.allocationRule.findUnique({
      where: { id: input.ruleId },
      include: {
        versions: {
          where: { active: true },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });
  } else {
    rule = await prisma.allocationRule.findFirst({
      where: {
        applicationId: input.applicationId,
        environment: input.environment,
        active: true,
      },
      include: {
        versions: {
          where: { active: true },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
      orderBy: { priority: "desc" },
    });
  }

  if (!rule || rule.versions.length === 0) {
    throw new Error("No active allocation rule found.");
  }

  const version = rule.versions[0];
  const splits = version.splits as SplitDefinition[];
  const roundingMode = (version.roundingMode as RoundingMode) ?? "HALF_UP";

  // Compute allocations
  const result = computeAllocations(input.amountMinor, splits, roundingMode);

  // Create allocation records
  await prisma.allocation.createMany({
    data: result.allocations.map((a) => ({
      paymentId: input.paymentId,
      allocationRuleId: rule!.id,
      allocationRuleVersionId: version.id,
      accountId: a.accountId,
      amountMinor: a.amountMinor,
      currency: input.currency,
      percentage: a.percentage,
      roundingApplied: a.roundingApplied,
    })),
  });

  return result;
}

// ---------------------------------------------------------------------------
// Rule management
// ---------------------------------------------------------------------------

/**
 * Create a new allocation rule with its first version.
 */
export async function createAllocationRule(params: {
  applicationId: string;
  environment: Environment;
  name: string;
  description?: string;
  priority?: number;
  splits: SplitDefinition[];
  roundingMode?: RoundingMode;
}) {
  return prisma.$transaction(async (tx) => {
    const rule = await tx.allocationRule.create({
      data: {
        applicationId: params.applicationId,
        environment: params.environment,
        name: params.name,
        description: params.description ?? null,
        priority: params.priority ?? 0,
      },
    });

    await tx.allocationRuleVersion.create({
      data: {
        allocationRuleId: rule.id,
        version: 1,
        splits: params.splits as unknown as Record<string, unknown>,
        roundingMode: params.roundingMode ?? "HALF_UP",
      },
    });

    return rule;
  });
}

/**
 * Create a new version of an existing allocation rule.
 */
export async function createRuleVersion(
  ruleId: string,
  splits: SplitDefinition[],
  roundingMode: RoundingMode = "HALF_UP",
) {
  // Get current max version
  const latest = await prisma.allocationRuleVersion.findFirst({
    where: { allocationRuleId: ruleId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const newVersion = (latest?.version ?? 0) + 1;

  return prisma.allocationRuleVersion.create({
    data: {
      allocationRuleId: ruleId,
      version: newVersion,
      splits: splits as unknown as Record<string, unknown>,
      roundingMode,
    },
  });
}

/**
 * List allocation rules for an application.
 */
export async function listAllocationRules(
  applicationId: string,
  environment: Environment,
) {
  return prisma.allocationRule.findMany({
    where: { applicationId, environment },
    include: {
      versions: { orderBy: { version: "desc" } },
    },
    orderBy: { priority: "desc" },
  });
}
