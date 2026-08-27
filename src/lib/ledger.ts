import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isValidCurrency } from "@/lib/money";
import type { AccountType, Environment, LedgerEntryType } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LedgerEntryInput = {
  accountId: string;
  type: LedgerEntryType;
  amountMinor: bigint;
  currency?: string;
  description?: string;
};

export type PostJournalInput = {
  applicationId: string;
  environment: Environment;
  description: string;
  reference?: string;
  entries: LedgerEntryInput[];
};

export type AccountBalance = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debitMinor: bigint;
  creditMinor: bigint;
  /** Net balance in normal direction: debit - credit for DEBIT-normal accounts, credit - debit for CREDIT-normal accounts. */
  balanceMinor: bigint;
  currency: string;
};

/** Raised when a journal violates double-entry invariants. */
export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

// ---------------------------------------------------------------------------
// Account normal balance helpers
// ---------------------------------------------------------------------------

/** DEBIT-normal accounts: ASSET, EXPENSE */
const DEBIT_NORMAL: AccountType[] = ["ASSET", "EXPENSE"];

/** DEBIT-normal accounts increase with debits (ASSET, EXPENSE). Exported for tests. */
export function isDebitNormal(type: AccountType): boolean {
  return DEBIT_NORMAL.includes(type);
}

/**
 * Compute net balance for an account in its normal direction.
 * For DEBIT-normal accounts: debit - credit (positive = normal)
 * For CREDIT-normal accounts: credit - debit (positive = normal)
 */
/**
 * Net balance in the account's normal direction (positive = normal balance).
 * Exported for tests.
 */
export function netBalance(type: AccountType, debitMinor: bigint, creditMinor: bigint): bigint {
  return isDebitNormal(type) ? debitMinor - creditMinor : creditMinor - debitMinor;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a journal entry before posting:
 *  - At least 2 entries
 *  - All amounts > 0
 *  - Sum of debits == Sum of credits (double-entry invariant)
 *  - Accounts exist, are active, and belong to this application + environment
 *  - Every entry's currency matches its account's currency
 *  - A journal is single-currency (no FX mixing — FX accounting is future work)
 *
 * Runs INSIDE the posting transaction so the checks and the writes see the
 * same database state.
 */
async function validateJournalEntryTx(
  tx: Prisma.TransactionClient,
  input: PostJournalInput,
): Promise<void> {
  if (input.entries.length < 2) {
    throw new LedgerValidationError("Journal entry must have at least 2 entries.");
  }

  let totalDebits = 0n;
  let totalCredits = 0n;
  let journalCurrency: string | null = null;

  for (const entry of input.entries) {
    if (entry.amountMinor <= 0n) {
      throw new LedgerValidationError(
        `Amount must be positive for account ${entry.accountId}.`,
      );
    }

    const currency = entry.currency ?? "KES";
    if (!isValidCurrency(currency)) {
      throw new LedgerValidationError(
        `Invalid currency ${JSON.stringify(currency)} on account ${entry.accountId}.`,
      );
    }

    const account = await tx.account.findUnique({
      where: { id: entry.accountId },
    });
    if (!account) {
      throw new LedgerValidationError(`Account ${entry.accountId} not found.`);
    }
    if (!account.active) {
      throw new LedgerValidationError(
        `Account ${account.code} (${account.name}) is not active.`,
      );
    }
    if (account.applicationId !== input.applicationId) {
      throw new LedgerValidationError(
        `Account ${account.code} belongs to a different application.`,
      );
    }
    if (account.environment !== input.environment) {
      throw new LedgerValidationError(
        `Account ${account.code} is in a different environment.`,
      );
    }

    // CURRENCY INVARIANT: an entry posted to an account must use that
    // account's currency. The balance of an M-Pesa float account in KES can
    // never silently absorb a USD entry.
    if (currency !== account.currency) {
      throw new LedgerValidationError(
        `Entry currency ${currency} does not match account ${account.code} ` +
          `currency ${account.currency}.`,
      );
    }

    // Single currency per journal — mixing currencies inside one journal
    // would require FX accounting, which the platform does not implement.
    if (journalCurrency === null) {
      journalCurrency = currency;
    } else if (journalCurrency !== currency) {
      throw new LedgerValidationError(
        `Journal mixes currencies (${journalCurrency} and ${currency}). ` +
          "Multi-currency journals require FX accounting and are not supported.",
      );
    }

    if (entry.type === "DEBIT") {
      totalDebits += entry.amountMinor;
    } else {
      totalCredits += entry.amountMinor;
    }
  }

  if (totalDebits !== totalCredits) {
    throw new LedgerValidationError(
      `Debits (${totalDebits}) do not equal credits (${totalCredits}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/**
 * Post a balanced journal entry to the ledger. This is the primary write
 * operation for the financial core.
 *
 * The ledger is APPEND-ONLY: there is no update or delete path for
 * finalized entries. Corrections are made by posting a reversal journal
 * (see reverseJournalEntry). Validation and the writes run in a single
 * transaction, so an unbalanced journal can never be committed.
 */
export async function postJournalEntry(input: PostJournalInput) {
  if (!input.description?.trim()) {
    throw new LedgerValidationError("Journal description is required.");
  }

  return prisma.$transaction(async (tx) => {
    // Validate inside the transaction.
    await validateJournalEntryTx(tx, input);

    const journalTx = await tx.journalTransaction.create({
      data: {
        applicationId: input.applicationId,
        environment: input.environment,
        description: input.description,
        reference: input.reference ?? null,
      },
    });

    await tx.ledgerEntry.createMany({
      data: input.entries.map((entry) => ({
        journalTransactionId: journalTx.id,
        accountId: entry.accountId,
        type: entry.type,
        amountMinor: entry.amountMinor,
        currency: entry.currency ?? "KES",
        description: entry.description ?? null,
      })),
    });

    return journalTx;
  });
}

/**
 * Reverse a journal transaction by posting a compensating journal with
 * inverted debits/credits. The ORIGINAL entries are never modified or
 * deleted — both journals remain in the audit trail, and balances reflect
 * the net effect. This is the only correction mechanism for the ledger.
 *
 * The reversal references the original via `reference` and carries the
 * same environment/application scoping. Idempotent-safe: pass the original
 * journal id — reversing an already-reversed journal is rejected.
 */
export async function reverseJournalEntry(params: {
  journalId: string;
  reversedBy: string;
  reason: string;
}): Promise<{ reversalId: string }> {
  if (!params.reason?.trim()) {
    throw new LedgerValidationError("A reversal reason is required.");
  }

  return prisma.$transaction(async (tx) => {
    const original = await tx.journalTransaction.findUnique({
      where: { id: params.journalId },
      include: { entries: true },
    });

    if (!original) {
      throw new LedgerValidationError("Journal transaction not found.");
    }
    if (original.voidedAt) {
      throw new LedgerValidationError("Journal transaction is already voided.");
    }
    if (original.reference?.startsWith("reversal-of:")) {
      throw new LedgerValidationError("Reversal journals cannot be reversed.");
    }

    // Guard against double reversal: a journal with reference
    // "reversal-of:<originalId>" must not already exist.
    const existingReversal = await tx.journalTransaction.findFirst({
      where: {
        applicationId: original.applicationId,
        reference: `reversal-of:${original.id}`,
      },
      select: { id: true },
    });
    if (existingReversal) {
      throw new LedgerValidationError(
        `Journal ${original.id} has already been reversed by ${existingReversal.id}.`,
      );
    }

    const reversal = await tx.journalTransaction.create({
      data: {
        applicationId: original.applicationId,
        environment: original.environment,
        description: `Reversal of "${original.description}": ${params.reason}`,
        reference: `reversal-of:${original.id}`,
      },
    });

    // Inverted entries — every original debit becomes a credit and vice
    // versa. Balanced by construction.
    await tx.ledgerEntry.createMany({
      data: original.entries.map((entry) => ({
        journalTransactionId: reversal.id,
        accountId: entry.accountId,
        type: entry.type === "DEBIT" ? ("CREDIT" as const) : ("DEBIT" as const),
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        description: `Reversal (${entry.type === "DEBIT" ? "credit" : "debit"}) of ${entry.amountMinor} ${entry.currency}`,
      })),
    });

    return { reversalId: reversal.id };
  });
}

// ---------------------------------------------------------------------------
// Balance queries
// ---------------------------------------------------------------------------

/**
 * Get the balance for a single account. Balances are computed from
 * non-voided ledger entries only.
 */
export async function getAccountBalance(
  accountId: string,
): Promise<AccountBalance | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) return null;

  const [debitSum, creditSum] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: {
        accountId,
        type: "DEBIT",
        journalTransaction: { voidedAt: null },
      },
      _sum: { amountMinor: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        accountId,
        type: "CREDIT",
        journalTransaction: { voidedAt: null },
      },
      _sum: { amountMinor: true },
    }),
  ]);

  const debitMinor = debitSum._sum.amountMinor ?? 0n;
  const creditMinor = creditSum._sum.amountMinor ?? 0n;

  return {
    accountId: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    debitMinor,
    creditMinor,
    balanceMinor: netBalance(account.type, debitMinor, creditMinor),
    currency: account.currency,
  };
}

/**
 * Get balances for all accounts in an application + environment.
 * Used for trial balance, balance sheet, and income statement reports.
 */
export async function getAccountBalances(
  applicationId: string,
  environment: Environment,
): Promise<AccountBalance[]> {
  const accounts = await prisma.account.findMany({
    where: { applicationId, environment },
    orderBy: { code: "asc" },
  });

  const balances: AccountBalance[] = [];

  for (const account of accounts) {
    const [debitSum, creditSum] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        where: {
          accountId: account.id,
          type: "DEBIT",
          journalTransaction: { voidedAt: null },
        },
        _sum: { amountMinor: true },
      }),
      prisma.ledgerEntry.aggregate({
        where: {
          accountId: account.id,
          type: "CREDIT",
          journalTransaction: { voidedAt: null },
        },
        _sum: { amountMinor: true },
      }),
    ]);

    const debitMinor = debitSum._sum.amountMinor ?? 0n;
    const creditMinor = creditSum._sum.amountMinor ?? 0n;

    balances.push({
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      debitMinor,
      creditMinor,
      balanceMinor: netBalance(account.type, debitMinor, creditMinor),
      currency: account.currency,
    });
  }

  return balances;
}

/**
 * Verify that debits equal credits across all non-voided entries
 * for an application. Returns true if the ledger is balanced.
 */
export async function verifyLedgerBalance(
  applicationId: string,
  environment: Environment,
): Promise<{ balanced: true } | { balanced: false; totalDebits: bigint; totalCredits: bigint; difference: bigint }> {
  const [debitTotal, creditTotal] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: {
        journalTransaction: {
          applicationId,
          environment,
          voidedAt: null,
        },
        type: "DEBIT",
      },
      _sum: { amountMinor: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: {
        journalTransaction: {
          applicationId,
          environment,
          voidedAt: null,
        },
        type: "CREDIT",
      },
      _sum: { amountMinor: true },
    }),
  ]);

  const totalDebits = debitTotal._sum.amountMinor ?? 0n;
  const totalCredits = creditTotal._sum.amountMinor ?? 0n;

  if (totalDebits === totalCredits) {
    return { balanced: true };
  }

  return {
    balanced: false,
    totalDebits,
    totalCredits,
    difference: totalDebits - totalCredits,
  };
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

/** Raised when account creation parameters are invalid or cross-scope. */
export class AccountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountValidationError";
  }
}

/**
 * Create an account in the chart of accounts.
 *
 * SCOPE INVARIANT: when `parentId` is given, the parent account must belong
 * to the SAME application and environment — a tenant/application can never
 * attach its account to another tenant/application's account, and SANDBOX
 * can never attach to LIVE (or vice versa).
 */
export async function createAccount(params: {
  applicationId: string;
  environment: Environment;
  code: string;
  name: string;
  type: AccountType;
  parentId?: string;
  currency?: string;
  description?: string;
}) {
  const currency = params.currency ?? "KES";
  if (!isValidCurrency(currency)) {
    throw new AccountValidationError(
      `Currency must be a 3-letter ISO code (e.g. "KES"), got ${JSON.stringify(currency)}.`,
    );
  }

  if (params.parentId) {
    const parent = await prisma.account.findUnique({
      where: { id: params.parentId },
      select: { id: true, applicationId: true, environment: true, code: true },
    });
    if (!parent) {
      throw new AccountValidationError(`Parent account ${params.parentId} not found.`);
    }
    if (
      parent.applicationId !== params.applicationId ||
      parent.environment !== params.environment
    ) {
      throw new AccountValidationError(
        `Parent account ${parent.code} belongs to a different application or environment.`,
      );
    }
  }

  return prisma.account.create({
    data: {
      applicationId: params.applicationId,
      environment: params.environment,
      code: params.code,
      name: params.name,
      type: params.type,
      parentId: params.parentId ?? null,
      currency,
      description: params.description ?? null,
    },
  });
}

export async function listAccounts(applicationId: string, environment: Environment) {
  return prisma.account.findMany({
    where: { applicationId, environment },
    orderBy: { code: "asc" },
    include: { _count: { select: { entries: true } } },
  });
}
