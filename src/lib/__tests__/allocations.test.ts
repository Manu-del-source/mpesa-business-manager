/**
 * Allocation engine unit tests — importing the PRODUCTION computeAllocations
 * (exact BigInt arithmetic; no floating point, no silent rounding).
 *
 * The old version of this file re-implemented the split logic inline — it
 * missed a real 100× basis-point bug in the production code that these tests
 * now pin down.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeAllocations } from "@/lib/allocations";

const S = (accountId: string, value: number) =>
  ({ accountId, type: "percentage" as const, value });
const F = (accountId: string, value: number) =>
  ({ accountId, type: "fixed" as const, value });

// ---------------------------------------------------------------------------
// Invariant: sum(allocations) == total (always, exactly)
// ---------------------------------------------------------------------------

describe("Allocation exactness (production computeAllocations)", () => {
  it("even 50/50 split of an odd amount preserves the total exactly", () => {
    // 101 minor units, 50/50: exact halves are 50.5 — HALF_UP gives 51 + 50.
    const r = computeAllocations(101n, [S("a", 50), S("b", 50)]);
    assert.equal(r.totalAllocated, 101n);
    assert.equal(r.remainder, 0n);
    const amounts = r.allocations.map((a) => a.amountMinor);
    assert.equal(amounts[0]! + amounts[1]!, 101n);
  });

  it("thirds of 100: 33.33/33.33/33.34 sums exactly to 100", () => {
    const r = computeAllocations(100n, [S("a", 33.33), S("b", 33.33), S("c", 33.34)]);
    assert.equal(r.totalAllocated, 100n);
    assert.equal(r.remainder, 0n);
  });

  it("thirds of 100 with equal 33.333333% splits are rejected (not representable)", () => {
    assert.throws(() =>
      computeAllocations(100n, [S("a", 100 / 3), S("b", 100 / 3), S("c", 100 / 3)]),
    );
  });

  it("percentages not summing to exactly 100% are rejected", () => {
    assert.throws(() => computeAllocations(1000n, [S("a", 60), S("b", 30)]), /exactly 100%/);
    assert.throws(() => computeAllocations(1000n, [S("a", 60), S("b", 50)]), /exactly 100%/);
  });

  it("percentages above 100 or negative are rejected", () => {
    assert.throws(() => computeAllocations(100n, [S("a", 150)]));
    assert.throws(() => computeAllocations(100n, [S("a", -10), S("b", 110)]));
  });

  it("single split takes everything (no rounding possible)", () => {
    const r = computeAllocations(999n, [S("a", 100)]);
    assert.deepEqual(
      r.allocations.map((x) => x.amountMinor),
      [999n],
    );
    assert.equal(r.remainder, 0n);
  });

  it("empty splits leave everything unallocated", () => {
    const r = computeAllocations(500n, []);
    assert.equal(r.totalAllocated, 0n);
    assert.equal(r.remainder, 500n);
  });

  it("negative total is rejected", () => {
    assert.throws(() => computeAllocations(-1n, [S("a", 100)]));
  });

  it("zero total allocates zero", () => {
    const r = computeAllocations(0n, [S("a", 50), S("b", 50)]);
    assert.equal(r.totalAllocated, 0n);
  });
});

// ---------------------------------------------------------------------------
// Rounding modes (production)
// ---------------------------------------------------------------------------

describe("Allocation rounding modes (production)", () => {
  it("HALF_UP rounds 50.5 up (101 → 51/50)", () => {
    const r = computeAllocations(101n, [S("a", 50), S("b", 50)], "HALF_UP");
    assert.deepEqual(
      r.allocations.map((x) => x.amountMinor),
      [51n, 50n],
    );
  });

  it("HALF_DOWN rounds 50.5 down (101 → 50/51)", () => {
    const r = computeAllocations(101n, [S("a", 50), S("b", 50)], "HALF_DOWN");
    assert.deepEqual(
      r.allocations.map((x) => x.amountMinor),
      [50n, 51n],
    );
  });

  it("TRUNCATE floors (101 → 50/51)", () => {
    const r = computeAllocations(101n, [S("a", 50), S("b", 50)], "TRUNCATE");
    assert.deepEqual(
      r.allocations.map((x) => x.amountMinor),
      [50n, 51n],
    );
  });

  it("CEIL ceilings (101 → 51/50)", () => {
    const r = computeAllocations(101n, [S("a", 50), S("b", 50)], "CEIL");
    assert.deepEqual(
      r.allocations.map((x) => x.amountMinor),
      [51n, 50n],
    );
  });

  it("rounding is RECORDED, never silent", () => {
    const r = computeAllocations(101n, [S("a", 50), S("b", 50)], "HALF_UP");
    assert.ok(r.allocations[0]!.roundingApplied !== null);
    // last split absorbs the remainder — no rounding annotation needed there
    assert.equal(r.allocations[1]!.roundingApplied, null);
  });

  it("deterministic: same inputs, same outputs", () => {
    const a = computeAllocations(1000001n, [S("a", 33.33), S("b", 33.33), S("c", 33.34)]);
    const b = computeAllocations(1000001n, [S("a", 33.33), S("b", 33.33), S("c", 33.34)]);
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// Fixed splits (production)
// ---------------------------------------------------------------------------

describe("Fixed splits (production)", () => {
  it("fixed amounts allocate exactly", () => {
    const r = computeAllocations(1000n, [F("a", 300), F("b", 700)]);
    assert.deepEqual(
      r.allocations.map((x) => x.amountMinor),
      [300n, 700n],
    );
    assert.equal(r.remainder, 0n);
  });

  it("last split absorbs the remainder", () => {
    const r = computeAllocations(1000n, [F("a", 300), F("b", 500)]);
    assert.deepEqual(
      r.allocations.map((x) => x.amountMinor),
      [300n, 700n],
    );
  });

  it("fixed split larger than total is capped (recorded)", () => {
    const r = computeAllocations(100n, [F("a", 80), F("b", 500)]);
    assert.deepEqual(
      r.allocations.map((x) => x.amountMinor),
      [80n, 20n],
    );
    assert.ok(r.allocations[1]!.roundingApplied !== null);
  });

  it("fractional fixed amounts are rejected, never truncated", () => {
    assert.throws(() => computeAllocations(1000n, [F("a", 10.5), F("b", 500)]));
    assert.throws(() => computeAllocations(1000n, [F("a", -5), F("b", 500)]));
  });

  it("mixed percentage/fixed splits are rejected with a clear error", () => {
    assert.throws(
      () => computeAllocations(1000n, [S("a", 50), F("b", 500)]),
      /Mixed splits/,
    );
  });
});

// ---------------------------------------------------------------------------
// Scale (production BigInt arithmetic — would break with floats)
// ---------------------------------------------------------------------------

describe("Allocation scale (production BigInt arithmetic)", () => {
  it("handles amounts beyond Number.MAX_SAFE_INTEGER exactly", () => {
    const total = 9007199254740993n; // exactly the first unsafe integer
    const r = computeAllocations(total, [S("a", 50), S("b", 50)]);
    assert.equal(r.totalAllocated, total);
    const [x, y] = r.allocations.map((a) => a.amountMinor);
    assert.equal(x! + y!, total);
  });

  it("handles 4-way splits with repeating decimals deterministically", () => {
    const r = computeAllocations(999999n, [S("a", 25), S("b", 25), S("c", 25), S("d", 25)]);
    assert.equal(r.totalAllocated, 999999n);
    // 999999/4 = 249999.75 → HALF_UP: 250000,250000,250000,249999
    assert.deepEqual(
      r.allocations.map((a) => a.amountMinor),
      [250000n, 250000n, 250000n, 249999n],
    );
  });
});
