import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Re-implement ledger logic for testing

const DEBIT_NORMAL = ["ASSET", "EXPENSE"];

function isDebitNormal(type) {
  return DEBIT_NORMAL.includes(type);
}

function netBalance(type, debitMinor, creditMinor) {
  return isDebitNormal(type) ? debitMinor - creditMinor : creditMinor - debitMinor;
}

function validateJournalEntry(entries) {
  if (entries.length < 2) {
    return { valid: false, error: "Journal entry must have at least 2 entries." };
  }

  let totalDebits = BigInt(0);
  let totalCredits = BigInt(0);

  for (const entry of entries) {
    if (entry.amountMinor <= 0n) {
      return { valid: false, error: `Amount must be positive.` };
    }
    if (entry.type === "DEBIT") {
      totalDebits += entry.amountMinor;
    } else {
      totalCredits += entry.amountMinor;
    }
  }

  if (totalDebits !== totalCredits) {
    return { valid: false, error: `Debits (${totalDebits}) != credits (${totalCredits}).` };
  }

  return { valid: true };
}

function computeTrialBalance(accounts, entries) {
  const result = [];
  for (const account of accounts) {
    const accountEntries = entries.filter((e) => e.accountId === account.id);
    let debitMinor = BigInt(0);
    let creditMinor = BigInt(0);
    for (const e of accountEntries) {
      if (e.type === "DEBIT") debitMinor += e.amountMinor;
      else creditMinor += e.amountMinor;
    }
    result.push({
      ...account,
      debitMinor,
      creditMinor,
      balanceMinor: netBalance(account.type, debitMinor, creditMinor),
    });
  }
  return result;
}

describe("isDebitNormal", () => {
  it("ASSET is debit-normal", () => assert.ok(isDebitNormal("ASSET")));
  it("EXPENSE is debit-normal", () => assert.ok(isDebitNormal("EXPENSE")));
  it("LIABILITY is credit-normal", () => assert.ok(!isDebitNormal("LIABILITY")));
  it("EQUITY is credit-normal", () => assert.ok(!isDebitNormal("EQUITY")));
  it("REVENUE is credit-normal", () => assert.ok(!isDebitNormal("REVENUE")));
});

describe("netBalance", () => {
  it("debit-normal: 1000 debit - 300 credit = 700", () => {
    assert.equal(netBalance("ASSET", 1000n, 300n), 700n);
  });
  it("credit-normal: 1000 credit - 300 debit = 700", () => {
    assert.equal(netBalance("LIABILITY", 300n, 1000n), 700n);
  });
  it("debit-normal: equal debits and credits = 0", () => {
    assert.equal(netBalance("EXPENSE", 500n, 500n), 0n);
  });
  it("credit-normal: equal debits and credits = 0", () => {
    assert.equal(netBalance("REVENUE", 500n, 500n), 0n);
  });
  it("debit-normal: more credits than debits = negative (overdrawn)", () => {
    assert.equal(netBalance("ASSET", 100n, 200n), -100n);
  });
});

describe("validateJournalEntry", () => {
  it("accepts balanced entry with 2+ lines", () => {
    const entries = [
      { accountId: "a1", type: "DEBIT", amountMinor: 1000n },
      { accountId: "a2", type: "CREDIT", amountMinor: 1000n },
    ];
    assert.ok(validateJournalEntry(entries).valid);
  });

  it("accepts balanced entry with 3+ lines", () => {
    const entries = [
      { accountId: "a1", type: "DEBIT", amountMinor: 500n },
      { accountId: "a2", type: "DEBIT", amountMinor: 500n },
      { accountId: "a3", type: "CREDIT", amountMinor: 1000n },
    ];
    assert.ok(validateJournalEntry(entries).valid);
  });

  it("rejects single entry", () => {
    const entries = [
      { accountId: "a1", type: "DEBIT", amountMinor: 1000n },
    ];
    const result = validateJournalEntry(entries);
    assert.ok(!result.valid);
    assert.ok(result.error.includes("at least 2"));
  });

  it("rejects unbalanced entry", () => {
    const entries = [
      { accountId: "a1", type: "DEBIT", amountMinor: 1000n },
      { accountId: "a2", type: "CREDIT", amountMinor: 500n },
    ];
    const result = validateJournalEntry(entries);
    assert.ok(!result.valid);
    assert.ok(result.error.includes("!=") || result.error.includes("not equal"));
  });

  it("rejects zero amount", () => {
    const entries = [
      { accountId: "a1", type: "DEBIT", amountMinor: 0n },
      { accountId: "a2", type: "CREDIT", amountMinor: 0n },
    ];
    const result = validateJournalEntry(entries);
    assert.ok(!result.valid);
    assert.ok(result.error.includes("positive"));
  });

  it("rejects negative amount", () => {
    const entries = [
      { accountId: "a1", type: "DEBIT", amountMinor: -100n },
      { accountId: "a2", type: "CREDIT", amountMinor: 100n },
    ];
    const result = validateJournalEntry(entries);
    assert.ok(!result.valid);
  });
});

describe("computeTrialBalance", () => {
  const accounts = [
    { id: "cash", code: "1000", name: "Cash", type: "ASSET" },
    { id: "receivable", code: "1100", name: "Accounts Receivable", type: "ASSET" },
    { id: "revenue", code: "4000", name: "Sales Revenue", type: "REVENUE" },
    { id: "expense", code: "5000", name: "COGS", type: "EXPENSE" },
  ];

  it("computes correct balances for a simple sale", () => {
    // Sale: Dr Cash 1000, Cr Revenue 1000
    const entries = [
      { accountId: "cash", type: "DEBIT", amountMinor: 1000n },
      { accountId: "revenue", type: "CREDIT", amountMinor: 1000n },
    ];
    const balances = computeTrialBalance(accounts, entries);

    const cash = balances.find((b) => b.id === "cash");
    const revenue = balances.find((b) => b.id === "revenue");

    assert.equal(cash.balanceMinor, 1000n); // ASSET: debit - credit
    assert.equal(revenue.balanceMinor, 1000n); // REVENUE: credit - debit
  });

  it("computes correct balances for a compound entry", () => {
    // Sale on credit: Dr Cash 600, Dr AR 400, Cr Revenue 1000
    const entries = [
      { accountId: "cash", type: "DEBIT", amountMinor: 600n },
      { accountId: "receivable", type: "DEBIT", amountMinor: 400n },
      { accountId: "revenue", type: "CREDIT", amountMinor: 1000n },
    ];
    const balances = computeTrialBalance(accounts, entries);

    assert.equal(balances.find((b) => b.id === "cash").balanceMinor, 600n);
    assert.equal(balances.find((b) => b.id === "receivable").balanceMinor, 400n);
    assert.equal(balances.find((b) => b.id === "revenue").balanceMinor, 1000n);
    assert.equal(balances.find((b) => b.id === "expense").balanceMinor, 0n);
  });

  it("trial balance debits equal credits for balanced entries", () => {
    const entries = [
      { accountId: "cash", type: "DEBIT", amountMinor: 1000n },
      { accountId: "revenue", type: "CREDIT", amountMinor: 1000n },
      { accountId: "expense", type: "DEBIT", amountMinor: 300n },
      { accountId: "cash", type: "CREDIT", amountMinor: 300n },
    ];
    const balances = computeTrialBalance(accounts, entries);
    const totalDebits = balances.reduce((sum, b) => sum + b.debitMinor, 0n);
    const totalCredits = balances.reduce((sum, b) => sum + b.creditMinor, 0n);
    assert.equal(totalDebits, totalCredits);
  });

  it("handles multiple entries on same account", () => {
    const entries = [
      { accountId: "cash", type: "DEBIT", amountMinor: 1000n },
      { accountId: "cash", type: "DEBIT", amountMinor: 500n },
      { accountId: "cash", type: "CREDIT", amountMinor: 200n },
      { accountId: "revenue", type: "CREDIT", amountMinor: 1500n },
    ];
    const balances = computeTrialBalance(accounts, entries);
    const cash = balances.find((b) => b.id === "cash");
    assert.equal(cash.debitMinor, 1500n);
    assert.equal(cash.creditMinor, 200n);
    assert.equal(cash.balanceMinor, 1300n); // ASSET: 1500 - 200
  });

  it("returns zero balances for accounts with no entries", () => {
    const entries = [];
    const balances = computeTrialBalance(accounts, entries);
    for (const b of balances) {
      assert.equal(b.balanceMinor, 0n);
      assert.equal(b.debitMinor, 0n);
      assert.equal(b.creditMinor, 0n);
    }
  });
});

describe("double-entry invariants", () => {
  it("every balanced journal maintains total debits == total credits", () => {
    // Simulate 5 different journal entries
    const journals = [
      // Simple sale: Cash +1000, Revenue +1000
      [
        { accountId: "cash", type: "DEBIT", amountMinor: 1000n },
        { accountId: "revenue", type: "CREDIT", amountMinor: 1000n },
      ],
      // Expense: COGS +300, Cash -300
      [
        { accountId: "expense", type: "DEBIT", amountMinor: 300n },
        { accountId: "cash", type: "CREDIT", amountMinor: 300n },
      ],
      // Partial payment: Cash +500, AR -500
      [
        { accountId: "cash", type: "DEBIT", amountMinor: 500n },
        { accountId: "receivable", type: "CREDIT", amountMinor: 500n },
      ],
      // Compound: Cash +200, AR +300, Revenue +500
      [
        { accountId: "cash", type: "DEBIT", amountMinor: 200n },
        { accountId: "receivable", type: "DEBIT", amountMinor: 300n },
        { accountId: "revenue", type: "CREDIT", amountMinor: 500n },
      ],
      // Refund: Revenue -100, Cash -100
      [
        { accountId: "revenue", type: "DEBIT", amountMinor: 100n },
        { accountId: "cash", type: "CREDIT", amountMinor: 100n },
      ],
    ];

    // All entries should be individually balanced
    for (const journal of journals) {
      const result = validateJournalEntry(journal);
      assert.ok(result.valid, `Journal should be balanced: ${result.error}`);
    }

    // Aggregate: total debits across all journals == total credits
    const allEntries = journals.flat();
    const totalDebits = allEntries
      .filter((e) => e.type === "DEBIT")
      .reduce((sum, e) => sum + e.amountMinor, 0n);
    const totalCredits = allEntries
      .filter((e) => e.type === "CREDIT")
      .reduce((sum, e) => sum + e.amountMinor, 0n);
    assert.equal(totalDebits, totalCredits);
  });
});
