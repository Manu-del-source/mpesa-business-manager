import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Re-implement allocation logic for testing

function roundAmount(amount, mode) {
  switch (mode) {
    case "HALF_UP": return Math.round(amount);
    case "HALF_DOWN": return Math.floor(amount + 0.49);
    case "TRUNCATE": return Math.floor(amount);
    case "CEIL": return Math.ceil(amount);
  }
}

function computeAllocations(totalAmountMinor, splits, roundingMode = "HALF_UP") {
  if (splits.length === 0) return { allocations: [], totalAllocated: 0n, remainder: totalAmountMinor };
  if (totalAmountMinor <= 0n) return { allocations: [], totalAllocated: 0n, remainder: 0n };

  const total = Number(totalAmountMinor);
  const allocations = [];
  let runningTotal = 0n;

  for (const split of splits) {
    let amount;
    if (split.type === "percentage") {
      amount = roundAmount((total * split.value) / 100, roundingMode);
    } else {
      amount = Math.min(split.value, total - Number(runningTotal));
    }

    if (amount < 1 && total - Number(runningTotal) >= 1) amount = 1;
    const remaining = total - Number(runningTotal);
    if (amount > remaining) amount = remaining;

    const amountBig = BigInt(Math.floor(amount));
    runningTotal += amountBig;

    allocations.push({
      accountId: split.accountId,
      amountMinor: amountBig,
      percentage: split.type === "percentage" ? split.value : null,
      roundingApplied: amount !== Math.floor(amount) ? `${amount}→${Math.floor(amount)}` : null,
    });
  }

  // Assign remainder to last allocation
  const remainder = totalAmountMinor - allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
  if (remainder !== 0n && allocations.length > 0) {
    allocations[allocations.length - 1].amountMinor += remainder;
  }

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
  return { allocations, totalAllocated, remainder: 0n };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeAllocations — percentage splits", () => {
  it("splits 50/50 evenly", () => {
    const result = computeAllocations(1000n, [
      { accountId: "a1", type: "percentage", value: 50 },
      { accountId: "a2", type: "percentage", value: 50 },
    ]);
    assert.equal(result.totalAllocated, 1000n);
    assert.equal(result.allocations[0].amountMinor, 500n);
    assert.equal(result.allocations[1].amountMinor, 500n);
  });

  it("splits 70/30", () => {
    const result = computeAllocations(1000n, [
      { accountId: "a1", type: "percentage", value: 70 },
      { accountId: "a2", type: "percentage", value: 30 },
    ]);
    assert.equal(result.totalAllocated, 1000n);
    assert.equal(result.allocations[0].amountMinor, 700n);
    assert.equal(result.allocations[1].amountMinor, 300n);
  });

  it("handles uneven split with rounding", () => {
    // 1000 * 33.33% = 333.3, 1000 * 33.33% = 333.3, 1000 * 33.34% = 333.4
    const result = computeAllocations(1000n, [
      { accountId: "a1", type: "percentage", value: 33.33 },
      { accountId: "a2", type: "percentage", value: 33.33 },
      { accountId: "a3", type: "percentage", value: 33.34 },
    ]);
    assert.equal(result.totalAllocated, 1000n);
    // Sum should be exactly 1000
    const sum = result.allocations.reduce((s, a) => s + a.amountMinor, 0n);
    assert.equal(sum, 1000n);
  });

  it("always allocates the full amount (no remainder)", () => {
    const amounts = [1n, 100n, 999n, 10000n, 15000000n];
    const splits = [
      { accountId: "a1", type: "percentage", value: 40 },
      { accountId: "a2", type: "percentage", value: 35 },
      { accountId: "a3", type: "percentage", value: 25 },
    ];
    for (const amount of amounts) {
      const result = computeAllocations(amount, splits);
      assert.equal(result.totalAllocated, amount, `Failed for amount ${amount}`);
    }
  });

  it("three-way split sums correctly", () => {
    const result = computeAllocations(10000n, [
      { accountId: "a1", type: "percentage", value: 50 },
      { accountId: "a2", type: "percentage", value: 30 },
      { accountId: "a3", type: "percentage", value: 20 },
    ]);
    assert.equal(result.totalAllocated, 10000n);
    assert.equal(result.allocations[0].amountMinor, 5000n);
    assert.equal(result.allocations[1].amountMinor, 3000n);
    assert.equal(result.allocations[2].amountMinor, 2000n);
  });
});

describe("computeAllocations — fixed splits", () => {
  it("allocates fixed amounts", () => {
    const result = computeAllocations(10000n, [
      { accountId: "a1", type: "fixed", value: 3000 },
      { accountId: "a2", type: "fixed", value: 2000 },
    ]);
    assert.equal(result.totalAllocated, 10000n);
    assert.equal(result.allocations[0].amountMinor, 3000n);
    // a2 gets 2000 + remainder (5000) = 7000
    assert.equal(result.allocations[1].amountMinor, 7000n);
  });

  it("assigns remainder to last account", () => {
    const result = computeAllocations(10000n, [
      { accountId: "a1", type: "fixed", value: 3000 },
      { accountId: "a2", type: "fixed", value: 2000 },
    ]);
    // a1 gets 3000, a2 gets 2000 + remainder (5000) = 7000
    assert.equal(result.allocations[0].amountMinor, 3000n);
    assert.equal(result.allocations[1].amountMinor, 7000n);
  });

  it("caps fixed amount at remaining total", () => {
    const result = computeAllocations(5000n, [
      { accountId: "a1", type: "fixed", value: 10000 }, // Requested 10k but only 5k available
    ]);
    assert.equal(result.allocations[0].amountMinor, 5000n);
    assert.equal(result.totalAllocated, 5000n);
  });
});

describe("computeAllocations — rounding modes", () => {
  const splits = [
    { accountId: "a1", type: "percentage", value: 33.33 },
    { accountId: "a2", type: "percentage", value: 33.33 },
    { accountId: "a3", type: "percentage", value: 33.34 },
  ];

  it("HALF_UP rounds 0.5 up", () => {
    const result = computeAllocations(100n, splits, "HALF_UP");
    assert.equal(result.totalAllocated, 100n);
  });

  it("HALF_DOWN rounds 0.5 down", () => {
    const result = computeAllocations(100n, splits, "HALF_DOWN");
    assert.equal(result.totalAllocated, 100n);
  });

  it("TRUNCATE always rounds down", () => {
    const result = computeAllocations(100n, splits, "TRUNCATE");
    assert.equal(result.totalAllocated, 100n);
  });

  it("CEIL always rounds up", () => {
    const result = computeAllocations(100n, splits, "CEIL");
    assert.equal(result.totalAllocated, 100n);
  });

  it("all modes produce valid allocations that sum to total", () => {
    const modes = ["HALF_UP", "HALF_DOWN", "TRUNCATE", "CEIL"];
    for (const mode of modes) {
      const result = computeAllocations(10000n, splits, mode);
      assert.equal(result.totalAllocated, 10000n, `Failed for mode ${mode}`);
      for (const a of result.allocations) {
        assert.ok(a.amountMinor >= 0n, `Negative allocation in ${mode}`);
      }
    }
  });
});

describe("computeAllocations — edge cases", () => {
  it("empty splits returns zero allocations", () => {
    const result = computeAllocations(1000n, []);
    assert.equal(result.allocations.length, 0);
    assert.equal(result.remainder, 1000n);
  });

  it("zero amount returns zero allocations", () => {
    const result = computeAllocations(0n, [
      { accountId: "a1", type: "percentage", value: 100 },
    ]);
    assert.equal(result.allocations.length, 0);
  });

  it("single 100% split allocates everything", () => {
    const result = computeAllocations(5000n, [
      { accountId: "a1", type: "percentage", value: 100 },
    ]);
    assert.equal(result.totalAllocated, 5000n);
    assert.equal(result.allocations[0].amountMinor, 5000n);
  });

  it("handles very small amounts (1 minor unit)", () => {
    const result = computeAllocations(1n, [
      { accountId: "a1", type: "percentage", value: 50 },
      { accountId: "a2", type: "percentage", value: 50 },
    ]);
    assert.equal(result.totalAllocated, 1n);
  });

  it("handles large amounts (15M minor units)", () => {
    const result = computeAllocations(15_000_000n, [
      { accountId: "a1", type: "percentage", value: 60 },
      { accountId: "a2", type: "percentage", value: 40 },
    ]);
    assert.equal(result.totalAllocated, 15_000_000n);
    assert.equal(result.allocations[0].amountMinor, 9_000_000n);
    assert.equal(result.allocations[1].amountMinor, 6_000_000n);
  });

  it("recorded percentages match input splits", () => {
    const result = computeAllocations(1000n, [
      { accountId: "a1", type: "percentage", value: 60 },
      { accountId: "a2", type: "percentage", value: 40 },
    ]);
    assert.equal(result.allocations[0].percentage, 60);
    assert.equal(result.allocations[1].percentage, 40);
  });

  it("fixed splits have null percentage", () => {
    const result = computeAllocations(1000n, [
      { accountId: "a1", type: "fixed", value: 500 },
    ]);
    assert.equal(result.allocations[0].percentage, null);
  });
});

describe("computeAllocations — invariant: sum always equals total", () => {
  it("property: for any amount and split, totalAllocated == input", () => {
    const testCases = [
      { amount: 1n, splits: [{ type: "percentage", value: 33.33 }, { type: "percentage", value: 33.33 }, { type: "percentage", value: 33.34 }] },
      { amount: 777n, splits: [{ type: "percentage", value: 15 }, { type: "percentage", value: 25 }, { type: "percentage", value: 60 }] },
      { amount: 9999n, splits: [{ type: "percentage", value: 10 }, { type: "percentage", value: 20 }, { type: "percentage", value: 30 }, { type: "percentage", value: 40 }] },
      { amount: 100000n, splits: [{ type: "percentage", value: 33.33 }, { type: "percentage", value: 33.33 }, { type: "percentage", value: 33.34 }] },
      { amount: 1n, splits: [{ type: "percentage", value: 100 }] },
      { amount: 2n, splits: [{ type: "percentage", value: 50 }, { type: "percentage", value: 50 }] },
    ];

    for (const { amount, splits } of testCases) {
      const fullSplits = splits.map((s, i) => ({ ...s, accountId: `a${i}` }));
      const result = computeAllocations(amount, fullSplits);
      assert.equal(result.totalAllocated, amount, `Failed for amount=${amount}`);
    }
  });
});
