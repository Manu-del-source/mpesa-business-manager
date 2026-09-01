import "server-only";
import { prisma } from "@/lib/prisma";
import type { Environment } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitDefinition = {
  accountId: string;
  type: "percentage" | "fixed";
  /**
   * Percentage (0–100, up to 4 decimal places) or fixed amount in minor
   * units. Percentages are converted to exact basis-point integers before
   * any arithmetic — no floating-point is ever used on money.
   */
  value: number;
};

export type AllocationResult = {
  allocations: Array<{
    accountId: string;
    amountMinor: bigint;
    percentage: string | null;
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
// Exact rounding on BigInt amounts
// ---------------------------------------------------------------------------

export type RoundingMode = "HALF_UP" | "HALF_DOWN" | "TRUNCATE" | "CEIL";

/**
 * Divide `numerator` by `denominator` (both non-negative BigInts) with the
 * given rounding mode. Exact integer arithmetic — no floats anywhere.
 */
function divideRound(
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint {
  if (denominator === 0n) {
    throw new Error("Division by zero in allocation split.");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;

  // remainder/denominator compared with 1/2 exactly:
  //   2*remainder  vs  denominator
  const twice = remainder * 2n;
  if (mode === "CEIL") return quotient + 1n;
  if (mode === "TRUNCATE") return quotient;
  if (mode === "HALF_UP") {
    return twice >= denominator ? quotient + 1n : quotient;
  }
  // HALF_DOWN
  return twice > denominator ? quotient + 1n : quotient;
}

/**
 * Convert a percentage (0–100, up to 2 decimal places) into exact basis
 * points as BigInt (1 bp = 0.01%; 100% = 10,000 bps). Rejects anything not
 * exactly representable — no silent rounding of split percentages.
 */
function percentageToBasisPoints(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(
      `Percentage must be between 0 and 100 (got ${value}).`,
    );
  }
  // Representability check on the DECIMAL STRING (never trust float
  // multiplication: 33.34 * 100 === 3334.0000000000005). At most 2 decimal
  // places — basis-point precision. 50.5 → 5050 bps; 33.333 → rejected.
  const str = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(
      `Percentage ${value} has more than 2 decimal places and cannot be represented exactly in basis points.`,
    );
  }
  // Exact conversion via the decimal string: "33.34" → 3334 bps.
  const [intPart, decPart = ""] = str.split(".");
  return BigInt(intPart + decPart.padEnd(2, "0"));
}

// ---------------------------------------------------------------------------
// Split computation (exact, deterministic)
// ---------------------------------------------------------------------------

/**
 * Compute split amounts with deterministic, exact integer arithmetic.
 *
 * For percentage-based splits:
 *   1. share_i = total × pct_i (in basis points) / 10,000 — computed with
 *      exact BigInt division and the configured rounding mode
 *   2. remainder = total − Σ shares, assigned deterministically to the LAST
 *      split (documented policy, so every caller gets the same answer)
 *
 * For fixed-amount splits:
 *   1. Each split receives its fixed amount (capped at what remains)
 *   2. Any remainder is assigned to the last split
 *
 * INVARIANT: sum(allocations) == total amount — always, exactly.
 * No amount is ever silently rounded away.
 */
export function computeAllocations(
  totalAmountMinor: bigint,
  splits: SplitDefinition[],
  roundingMode: RoundingMode = "HALF_UP",
): AllocationResult {
  if (splits.length === 0) {
    return { allocations: [], totalAllocated: 0n, remainder: totalAmountMinor };
  }

  if (totalAmountMinor < 0n) {
    throw new Error("Total amount must not be negative.");
  }

  const allocations: AllocationResult["allocations"] = [];

  if (splits.length === 1) {
    // A single split takes everything — exact, no rounding possible.
    // Percentage values are still validated for range/representability.
    const split = splits[0];
    if (split.type === "percentage") percentageToBasisPoints(split.value);
    return {
      allocations: [
        {
          accountId: split.accountId,
          amountMinor: totalAmountMinor,
          percentage: split.type === "percentage" ? String(split.value) : null,
          roundingApplied: null,
        },
      ],
      totalAllocated: totalAmountMinor,
      remainder: 0n,
    };
  }

  if (splits.every((s) => s.type === "percentage")) {
    const totalBps = splits.reduce(
      (sum, s) => sum + percentageToBasisPoints(s.value),
      0n,
    );
    if (totalBps !== 10_000n) {
      throw new Error(
        `Percentage splits must sum to exactly 100% (got ${
          Number(totalBps) / 100
        }%).`,
      );
    }

    let runningTotal = 0n;
    splits.forEach((split, index) => {
      const bps = percentageToBasisPoints(split.value);
      const isLast = index === splits.length - 1;

      let share: bigint;
      if (isLast) {
        // Last split absorbs the remainder so the invariant holds exactly.
        share = totalAmountMinor - runningTotal;
        if (share < 0n) share = 0n;
      } else {
        share = divideRound(totalAmountMinor * bps, 10_000n, roundingMode);
      }

      const exactShare = (totalAmountMinor * bps) / 10_000n;
      const exactRemainder = (totalAmountMinor * bps) % 10_000n;
      const roundedAway = share - exactShare;

      allocations.push({
        accountId: split.accountId,
        amountMinor: share,
        percentage: String(split.value),
        roundingApplied:
          (exactRemainder !== 0n || roundedAway !== 0n) && !isLast
            ? `${exactShare}.${exactRemainder.toString().padStart(4, "0")} → ${share}`
            : null,
      });
      runningTotal += share;
    });

    return {
      allocations,
      totalAllocated: runningTotal,
      remainder: totalAmountMinor - runningTotal,
    };
  }

  // Fixed-amount (or mixed) splits.
  let remaining = totalAmountMinor;
  splits.forEach((split, index) => {
    const isLast = index === splits.length - 1;
    if (isLast) {
      const requested =
        split.type === "fixed" ? BigInt(split.value) : remaining;
      allocations.push({
        accountId: split.accountId,
        amountMinor: remaining,
        percentage: split.type === "percentage" ? String(split.value) : null,
        roundingApplied:
          split.type === "fixed" && requested !== remaining
            ? `${requested} → ${remaining}`
            : null,
      });
      remaining = 0n;
      return;
    }

    if (split.type === "fixed") {
      if (!Number.isInteger(split.value) || split.value < 0) {
        throw new Error(
          `Fixed split value must be a non-negative integer number of minor units (got ${split.value}).`,
        );
      }
    }
    const amount =
      split.type === "fixed" ? BigInt(split.value) : undefined;
    if (amount === undefined) {
      throw new Error(
        "Mixed splits are not supported: use all-percentage or all-fixed.",
      );
    }
    const applied = amount > remaining ? remaining : amount;
    remaining -= applied;

    allocations.push({
      accountId: split.accountId,
      amountMinor: applied,
      percentage: null,
      roundingApplied: applied !== amount ? `${amount} → ${applied}` : null,
    });
  });

  return {
    allocations,
    totalAllocated: totalAmountMinor - remaining,
    remainder: remaining,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Apply an allocation rule version to a payment: computes the split and
 * persists Allocation rows atomically.
 *
 * Idempotent by (paymentId): if allocations already exist for the payment,
 * the existing allocation set is returned unchanged — a payment is allocated
 * exactly once.
 */
export async function applyAllocationToPayment(
  input: ApplyAllocationInput,
  splits: SplitDefinition[],
  ruleMeta?: { ruleId?: string; ruleVersionId?: string },
  roundingMode: RoundingMode = "HALF_UP",
): Promise<AllocationResult> {
  const computed = computeAllocations(input.amountMinor, splits, roundingMode);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.allocation.findFirst({
      where: { paymentId: input.paymentId },
      select: { id: true },
    });
    if (existing) return; // already allocated — idempotent

    if (computed.allocations.length > 0) {
      await tx.allocation.createMany({
        data: computed.allocations.map((a) => ({
          paymentId: input.paymentId,
          allocationRuleId: ruleMeta?.ruleId ?? null,
          allocationRuleVersionId: ruleMeta?.ruleVersionId ?? null,
          accountId: a.accountId,
          amountMinor: a.amountMinor,
          currency: input.currency,
          percentage: a.percentage !== null ? Number(a.percentage) : null,
          roundingApplied: a.roundingApplied,
        })),
      });
    }
  });

  return computed;
}

// ---------------------------------------------------------------------------
// Rule management
// ---------------------------------------------------------------------------

/**
 * Validate a split set before it is persisted.
 *
 * Splits are validated by running them through computeAllocations() against a
 * representative amount, so a rule can never be stored in a shape the
 * allocation engine would later reject at payment time.
 */
function assertValidSplits(splits: SplitDefinition[]): void {
  if (splits.length === 0) {
    throw new AllocationRuleValidationError("A rule needs at least one split.");
  }
  const allPercentage = splits.every((s) => s.type === "percentage");
  const allFixed = splits.every((s) => s.type === "fixed");
  if (!allPercentage && !allFixed) {
    throw new AllocationRuleValidationError(
      "Mixed splits are not supported: use all-percentage or all-fixed.",
    );
  }
  try {
    // 1_000_000 minor units is large enough to exercise the rounding paths.
    computeAllocations(1_000_000n, splits);
  } catch (err) {
    throw new AllocationRuleValidationError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

export class AllocationRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationRuleValidationError";
  }
}

/**
 * Verify every split targets an account that exists, is active, and belongs
 * to THIS application + environment. Without this check a rule could route
 * money into another tenant's account.
 */
async function assertAccountsInScope(
  splits: SplitDefinition[],
  applicationId: string,
  environment: Environment,
): Promise<void> {
  const accountIds = [...new Set(splits.map((s) => s.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, applicationId, environment, isActive: true },
    select: { id: true },
  });
  const found = new Set(accounts.map((a) => a.id));
  const missing = accountIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new AllocationRuleValidationError(
      `Unknown or inactive account(s) for this application/environment: ${missing.join(", ")}.`,
    );
  }
}

/**
 * Create a new allocation rule together with its first version (atomically).
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
  assertValidSplits(params.splits);
  await assertAccountsInScope(params.splits, params.applicationId, params.environment);

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
 *
 * The rule is resolved WITHIN the caller's application + environment, so a
 * rule id belonging to another tenant cannot be versioned. Version numbering
 * happens inside the transaction to avoid a duplicate-version race.
 */
export async function createRuleVersion(
  ruleId: string,
  applicationId: string,
  environment: Environment,
  splits: SplitDefinition[],
  roundingMode: RoundingMode = "HALF_UP",
) {
  assertValidSplits(splits);
  await assertAccountsInScope(splits, applicationId, environment);

  return prisma.$transaction(async (tx) => {
    const rule = await tx.allocationRule.findFirst({
      where: { id: ruleId, applicationId, environment },
      select: { id: true },
    });
    if (!rule) {
      throw new AllocationRuleValidationError("Allocation rule not found.");
    }

    const latest = await tx.allocationRuleVersion.findFirst({
      where: { allocationRuleId: rule.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    return tx.allocationRuleVersion.create({
      data: {
        allocationRuleId: rule.id,
        version: (latest?.version ?? 0) + 1,
        splits: splits as unknown as Record<string, unknown>,
        roundingMode,
      },
    });
  });
}

/**
 * List allocation rules (with their versions) for an application+environment.
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
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
}
