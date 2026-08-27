/**
 * Usage metering unit tests — importing the PRODUCTION period-bucketing
 * helpers from src/lib/usage.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getPeriodStart, getPeriodEnd } from "@/lib/usage";

describe("Usage period bucketing (production — monthly billing period)", () => {
  it("buckets any day of March 2026 into the March period", () => {
    const start = getPeriodStart(new Date("2026-03-14T15:06:07.890Z"));
    assert.equal(
      start.toISOString(),
      new Date("2026-03-01T00:00:00.000Z").toISOString(),
    );
  });

  it("period end is the last millisecond of the month", () => {
    const end = getPeriodEnd(new Date("2026-03-14T15:06:07.890Z"));
    assert.equal(
      end.toISOString(),
      new Date("2026-03-31T23:59:59.999Z").toISOString(),
    );
  });

  it("buckets consistently within the same month", () => {
    const a = getPeriodStart(new Date("2026-02-01T00:00:00.000Z"));
    const b = getPeriodStart(new Date("2026-02-28T23:59:59.999Z"));
    assert.equal(a.getTime(), b.getTime());
  });

  it("separate months bucket separately", () => {
    const a = getPeriodStart(new Date("2026-02-28T23:59:59.999Z"));
    const b = getPeriodStart(new Date("2026-03-01T00:00:00.000Z"));
    assert.notEqual(a.getTime(), b.getTime());
  });
});
