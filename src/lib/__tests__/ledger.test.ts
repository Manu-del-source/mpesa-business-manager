/**
 * Ledger unit tests — importing the PRODUCTION pure helpers from
 * src/lib/ledger.ts (account normality, net balances).
 *
 * The posting/validation/reversal invariants (balanced journals, currency
 * enforcement, cross-scope protection) are exercised against a real database
 * in tests/integration/ledger.test.ts via the production postJournalEntry.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isDebitNormal, netBalance } from "@/lib/ledger";

describe("isDebitNormal (production)", () => {
  it("ASSET is debit-normal", () => assert.ok(isDebitNormal("ASSET")));
  it("EXPENSE is debit-normal", () => assert.ok(isDebitNormal("EXPENSE")));
  it("LIABILITY is credit-normal", () => assert.ok(!isDebitNormal("LIABILITY")));
  it("EQUITY is credit-normal", () => assert.ok(!isDebitNormal("EQUITY")));
  it("REVENUE is credit-normal", () => assert.ok(!isDebitNormal("REVENUE")));
});

describe("netBalance (production, exact BigInt)", () => {
  it("debit-normal: 1000 debit - 300 credit = 700", () => {
    assert.equal(netBalance("ASSET", 1000n, 300n), 700n);
  });
  it("credit-normal: 1000 credit - 300 debit = 700", () => {
    assert.equal(netBalance("REVENUE", 300n, 1000n), 700n);
  });
  it("equal debits and credits = 0 in both directions", () => {
    assert.equal(netBalance("ASSET", 500n, 500n), 0n);
    assert.equal(netBalance("LIABILITY", 500n, 500n), 0n);
  });
  it("debit-normal overdrawn goes negative", () => {
    assert.equal(netBalance("ASSET", 100n, 300n), -200n);
  });
  it("credit-normal with more debits goes negative", () => {
    assert.equal(netBalance("REVENUE", 300n, 100n), -200n);
  });
});
