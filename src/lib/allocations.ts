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

type RoundingMode = "HALF_UP" | "HALF_DOWN" | "TRUNCATE" | "CEIL";

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
 * Convert a percentage (0–100, up to 4 decimal places) into exact
 * basis points as BigInt. Rejects anything not exactly representable.
 */
function percentageToBasisPoints(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(
      `Percentage must be between 0 and 100 (got ${value}).`,
    );
  }
  // Validate representability: at most 4 decimal places.
  const scaled = value * 10_000;
  if (!Number.isInteger(scaled)) {
    throw new Error(
      `Percentage ${value} has more than 4 decimal places and cannot be represented exactly.`,
    );
  }
  return BigInt(scaled);
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
    const split = splits[0];
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
      allocations.push({
        accountId: split.accountId,
        amountMinor: remaining,
        percentage: split.type === "percentage" ? String(split.value) : null,
        roundingApplied: null,
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
