/**
 * INTEGRATION: ledger invariants — exercising the PRODUCTION
 * postJournalEntry / reverseJournalEntry / createAccount / verifyLedgerBalance
 * (src/lib/ledger.ts) against a real PostgreSQL database.
 *
 * Required coverage: balanced journals, imbalance rejection, currency
 * enforcement (entry vs account, single-currency journal), cross-scope
 * account protection (application + environment + parent), immutability via
 * reversals only, double-reversal rejection.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  createIntegrationDb,
  dropIntegrationDb,
  integrationTestsAvailable,
  type IntegrationDb,
} from "../helpers/integration-db.js";

const skipReason = integrationTestsAvailable()
  ? undefined
  : "integration tests need TEST_DATABASE_ADMIN_URL (or DATABASE_URL) pointing at a PostgreSQL server";

let db: IntegrationDb | null = null;

before(async () => {
  if (skipReason) return;
  db = await createIntegrationDb("ledger");
});

after(async () => {
  if (db) await dropIntegrationDb(db);
});

async function makeAccount(
  applicationId: string,
  code: string,
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE",
  currency = "KES",
  environment: "SANDBOX" | "LIVE" = "SANDBOX",
) {
  const { createAccount } = await import("@/lib/ledger");
  return createAccount({
    applicationId,
    environment,
    code,
    name: code,
    type,
    currency,
  });
}

describe("Ledger posting invariants (production postJournalEntry)", { skip: !!skipReason }, () => {
  it("posts a balanced journal and verifies ledger-wide balance", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, verifyLedgerBalance } = await import("@/lib/ledger");
    const app = await createTestApp("led1");

    const cash = await makeAccount(app.application.id, "CASH", "ASSET");
    const revenue = await makeAccount(app.application.id, "REV", "REVENUE");

    const journal = await postJournalEntry({
      applicationId: app.application.id,
      environment: "SANDBOX",
      description: "Cash sale",
      entries: [
        { accountId: cash.id, type: "DEBIT", amountMinor: 1500n },
        { accountId: revenue.id, type: "CREDIT", amountMinor: 1500n },
      ],
    });
    assert.ok(journal.id);

    const verdict = await verifyLedgerBalance(app.application.id, "SANDBOX");
    assert.ok(verdict.balanced);
  });

  it("rejects an unbalanced journal (debits ≠ credits)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led2");

    const cash = await makeAccount(app.application.id, "CASH", "ASSET");
    const revenue = await makeAccount(app.application.id, "REV", "REVENUE");

    await assert.rejects(
      postJournalEntry({
        applicationId: app.application.id,
        environment: "SANDBOX",
        description: "unbalanced",
        entries: [
          { accountId: cash.id, type: "DEBIT", amountMinor: 1500n },
          { accountId: revenue.id, type: "CREDIT", amountMinor: 1000n },
        ],
      }),
      LedgerValidationError,
    );
  });

  it("rejects a single-entry journal", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led3");

    const cash = await makeAccount(app.application.id, "CASH", "ASSET");
    await assert.rejects(
      postJournalEntry({
        applicationId: app.application.id,
        environment: "SANDBOX",
        description: "one-sided",
        entries: [{ accountId: cash.id, type: "DEBIT", amountMinor: 100n }],
      }),
      LedgerValidationError,
    );
  });

  it("rejects zero/negative amounts", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led4");

    const cash = await makeAccount(app.application.id, "CASH", "ASSET");
    const revenue = await makeAccount(app.application.id, "REV", "REVENUE");

    await assert.rejects(
      postJournalEntry({
        applicationId: app.application.id,
        environment: "SANDBOX",
        description: "zero",
        entries: [
          { accountId: cash.id, type: "DEBIT", amountMinor: 0n },
          { accountId: revenue.id, type: "CREDIT", amountMinor: 0n },
        ],
      }),
      LedgerValidationError,
    );
  });

  it("rejects an entry whose currency ≠ account currency", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led5");

    const kesCash = await makeAccount(app.application.id, "CASH", "ASSET", "KES");
    const kesRevenue = await makeAccount(app.application.id, "REV", "REVENUE", "KES");

    // A USD entry against a KES account must be REJECTED — never converted.
    await assert.rejects(
      postJournalEntry({
        applicationId: app.application.id,
        environment: "SANDBOX",
        description: "currency mismatch",
        entries: [
          { accountId: kesCash.id, type: "DEBIT", amountMinor: 1000n, currency: "USD" },
          { accountId: kesRevenue.id, type: "CREDIT", amountMinor: 1000n },
        ],
      }),
      LedgerValidationError,
    );
  });

  it("rejects a journal that mixes currencies (no FX support)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led6");

    const kesCash = await makeAccount(app.application.id, "CASH", "ASSET", "KES");
    const usdCash = await makeAccount(app.application.id, "USD_CASH", "ASSET", "USD");

    await assert.rejects(
      postJournalEntry({
        applicationId: app.application.id,
        environment: "SANDBOX",
        description: "mixed currencies",
        entries: [
          { accountId: kesCash.id, type: "DEBIT", amountMinor: 1000n, currency: "KES" },
          { accountId: usdCash.id, type: "CREDIT", amountMinor: 1000n, currency: "USD" },
        ],
      }),
      LedgerValidationError,
    );
  });

  it("rejects entries against ANOTHER application's accounts", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const appA = await createTestApp("led7a");
    const appB = await createTestApp("led7b");

    const foreignCash = await makeAccount(appB.application.id, "CASH", "ASSET");
    const ownRevenue = await makeAccount(appA.application.id, "REV", "REVENUE");

    await assert.rejects(
      postJournalEntry({
        applicationId: appA.application.id,
        environment: "SANDBOX",
        description: "cross-application",
        entries: [
          { accountId: foreignCash.id, type: "DEBIT", amountMinor: 100n },
          { accountId: ownRevenue.id, type: "CREDIT", amountMinor: 100n },
        ],
      }),
      LedgerValidationError,
    );
  });

  it("rejects entries against an account in a DIFFERENT environment", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led8");

    const liveCash = await makeAccount(app.application.id, "CASH", "ASSET", "KES", "LIVE");
    const sandboxRevenue = await makeAccount(app.application.id, "REV", "REVENUE", "KES", "SANDBOX");

    await assert.rejects(
      postJournalEntry({
        applicationId: app.application.id,
        environment: "SANDBOX",
        description: "cross-environment",
        entries: [
          { accountId: liveCash.id, type: "DEBIT", amountMinor: 100n },
          { accountId: sandboxRevenue.id, type: "CREDIT", amountMinor: 100n },
        ],
      }),
      LedgerValidationError,
    );
  });

  it("multi-line balanced journals are accepted (3+ entries)", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, verifyLedgerBalance } = await import("@/lib/ledger");
    const app = await createTestApp("led9");

    const cash = await makeAccount(app.application.id, "CASH", "ASSET");
    const fee = await makeAccount(app.application.id, "FEE", "EXPENSE");
    const revenue = await makeAccount(app.application.id, "REV", "REVENUE");

    const journal = await postJournalEntry({
      applicationId: app.application.id,
      environment: "SANDBOX",
      description: "sale with fee",
      entries: [
        { accountId: cash.id, type: "DEBIT", amountMinor: 1000n },
        { accountId: fee.id, type: "DEBIT", amountMinor: 29n },
        { accountId: revenue.id, type: "CREDIT", amountMinor: 1029n },
      ],
    });
    assert.ok(journal.id);

    const verdict = await verifyLedgerBalance(app.application.id, "SANDBOX");
    assert.ok(verdict.balanced);
  });
});

describe("Ledger immutability & reversals (production reverseJournalEntry)", { skip: !!skipReason }, () => {
  it("reversal posts compensating entries; original stays intact; balances net to zero", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, reverseJournalEntry, getAccountBalance, verifyLedgerBalance } = await import("@/lib/ledger");
    const app = await createTestApp("led10");

    const cash = await makeAccount(app.application.id, "CASH", "ASSET");
    const revenue = await makeAccount(app.application.id, "REV", "REVENUE");

    const original = await postJournalEntry({
      applicationId: app.application.id,
      environment: "SANDBOX",
      description: "to be reversed",
      entries: [
        { accountId: cash.id, type: "DEBIT", amountMinor: 2000n },
        { accountId: revenue.id, type: "CREDIT", amountMinor: 2000n },
      ],
    });

    const { reversalId } = await reverseJournalEntry({
      journalId: original.id,
      reversedBy: "admin",
      reason: "posted in error",
    });
    assert.ok(reversalId);

    // Original journal entries still exist (append-only audit trail).
    const { prisma } = await import("@/lib/prisma");
    const originalEntries = await prisma.ledgerEntry.count({
      where: { journalTransactionId: original.id },
    });
    assert.equal(originalEntries, 2);

    // Net effect on the cash account is zero.
    const cashBalance = await getAccountBalance(cash.id);
    assert.ok(cashBalance);
    assert.equal(cashBalance.balanceMinor, 0n);

    const verdict = await verifyLedgerBalance(app.application.id, "SANDBOX");
    assert.ok(verdict.balanced);
  });

  it("double reversal is rejected", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, reverseJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led11");

    const cash = await makeAccount(app.application.id, "CASH", "ASSET");
    const revenue = await makeAccount(app.application.id, "REV", "REVENUE");

    const journal = await postJournalEntry({
      applicationId: app.application.id,
      environment: "SANDBOX",
      description: "reverse once",
      entries: [
        { accountId: cash.id, type: "DEBIT", amountMinor: 100n },
        { accountId: revenue.id, type: "CREDIT", amountMinor: 100n },
      ],
    });

    await reverseJournalEntry({ journalId: journal.id, reversedBy: "a", reason: "1st" });
    await assert.rejects(
      reverseJournalEntry({ journalId: journal.id, reversedBy: "a", reason: "2nd" }),
      LedgerValidationError,
    );
  });

  it("a reversal reason is required", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { postJournalEntry, reverseJournalEntry, LedgerValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led12");

    const cash = await makeAccount(app.application.id, "CASH", "ASSET");
    const revenue = await makeAccount(app.application.id, "REV", "REVENUE");

    const journal = await postJournalEntry({
      applicationId: app.application.id,
      environment: "SANDBOX",
      description: "x",
      entries: [
        { accountId: cash.id, type: "DEBIT", amountMinor: 100n },
        { accountId: revenue.id, type: "CREDIT", amountMinor: 100n },
      ],
    });

    await assert.rejects(
      reverseJournalEntry({ journalId: journal.id, reversedBy: "a", reason: "  " }),
      LedgerValidationError,
    );
  });
});

describe("Cross-scope account protection (production createAccount)", { skip: !!skipReason }, () => {
  it("rejects a parent account from ANOTHER application", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createAccount, AccountValidationError } = await import("@/lib/ledger");
    const appA = await createTestApp("led13a");
    const appB = await createTestApp("led13b");

    const foreignParent = await createAccount({
      applicationId: appB.application.id,
      environment: "SANDBOX",
      code: "FOREIGN",
      name: "Foreign parent",
      type: "ASSET",
    });

    await assert.rejects(
      createAccount({
        applicationId: appA.application.id,
        environment: "SANDBOX",
        code: "CHILD",
        name: "Child of foreign parent",
        type: "ASSET",
        parentId: foreignParent.id,
      }),
      AccountValidationError,
    );
  });

  it("rejects a parent account from a DIFFERENT environment", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createAccount, AccountValidationError } = await import("@/lib/ledger");
    const app = await createTestApp("led14");

    const liveParent = await createAccount({
      applicationId: app.application.id,
      environment: "LIVE",
      code: "LIVE_PARENT",
      name: "Live parent",
      type: "ASSET",
    });

    await assert.rejects(
      createAccount({
        applicationId: app.application.id,
        environment: "SANDBOX",
        code: "SANDBOX_CHILD",
        name: "Sandbox child",
        type: "ASSET",
        parentId: liveParent.id,
      }),
      AccountValidationError,
    );
  });

  it("accepts a parent account in the SAME scope", async () => {
    const { createTestApp } = await import("../helpers/fixtures.js");
    const { createAccount } = await import("@/lib/ledger");
    const app = await createTestApp("led15");

    const parent = await createAccount({
      applicationId: app.application.id,
      environment: "SANDBOX",
      code: "PARENT",
      name: "Parent",
      type: "ASSET",
    });
    const child = await createAccount({
      applicationId: app.application.id,
      environment: "SANDBOX",
      code: "CHILD",
      name: "Child",
      type: "ASSET",
      parentId: parent.id,
    });
    assert.equal(child.parentId, parent.id);
  });
});
