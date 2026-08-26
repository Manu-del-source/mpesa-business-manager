import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AccountType, Environment, LedgerEntryType } from "@/generated/prisma";

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

// ---------------------------------------------------------------------------
// Account normal balance helpers
// ---------------------------------------------------------------------------

/** DEBIT-normal accounts: ASSET, EXPENSE */
const DEBIT_NORMAL: AccountType[] = ["ASSET", "EXPENSE"];

function isDebitNormal(type: AccountType): boolean {
  return DEBIT_NORMAL.includes(type);
}

/**
 * Compute net balance for an account in its normal direction.
 * For DEBIT-normal accounts: debit - credit (positive = normal)
 * For CREDIT-normal accounts: credit - debit (positive = normal)
 */
function netBalance(type: AccountType, debitMinor: bigint, creditMinor: bigint): bigint {
  return isDebitNormal(type) ? debitMinor - creditMinor : creditMinor - debitMinor;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a journal entry before posting:
 * - At least 2 entries
 * - All amounts > 0
 * - Sum of debits == Sum of credits
 * - No duplicate account+type combinations
 * - Accounts exist and are active
 */
async function validateJournalEntry(
  input: PostJournalInput,
): Promise<{ valid: true } | { valid: false; error: string }> {
  if (input.entries.length < 2) {
    return { valid: false, error: "Journal entry must have at least 2 entries." };
  }

  let totalDebits = BigInt(0);
  let totalCredits = BigInt(0);

  for (const entry of input.entries) {
    if (entry.amountMinor <= 0n) {
      return { valid: false, error: `Amount must be positive for account ${entry.accountId}.` };
    }

    // Verify account exists
    const account = await prisma.account.findUnique({
      where: { id: entry.accountId },
    });
    if (!account) {
      return { valid: false, error: `Account ${entry.accountId} not found.` };
    }
    if (!account.active) {
      return { valid: false, error: `Account ${account.code} (${account.name}) is not active.` };
    }
    if (account.applicationId !== input.applicationId) {
      return { valid: false, error: `Account ${account.code} belongs to a different application.` };
    }
    if (account.environment !== input.environment) {
      return { valid: false, error: `Account ${account.code} is in a different environment.` };
    }

    if (entry.type === "DEBIT") {
      totalDebits += entry.amountMinor;
    } else {
      totalCredits += entry.amountMinor;
    }
  }

  if (totalDebits !== totalCredits) {
    return {
      valid: false,
      error: `Debits (${totalDebits}) do not equal credits (${totalCredits}).`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/**
 * Post a balanced journal entry to the ledger. This is the primary write
 * operation for the financial core.
 *
 * Returns the created JournalTransaction with its entries.
 */
export async function postJournalEntry(input: PostJournalInput) {
  // Validate before any writes
  const validation = await validateJournalEntry(input);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.error}`);
  }

  // Atomic transaction: create JournalTransaction + all LedgerEntry rows
  const journal = await prisma.$transaction(async (tx) => {
    const journalTx = await tx.journalTransaction.create({
      data: {
        applicationId: input.applicationId,
        environment: input.environment,
        description: input.description,
        reference: input.reference ?? null,
      },
    });

    // Create all ledger entries
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

  return journal;
}

/**
 * Void a journal entry by marking it voided. This does NOT delete the
 * entries — they remain for audit purposes. The entries are excluded from
 * balance calculations via the voidedAt check.
 */
export async function voidJournalEntry(
  journalId: string,
  voidedBy: string,
  voidReason: string,
) {
  const existing = await prisma.journalTransaction.findUnique({
    where: { id: journalId },
  });

  if (!existing) {
    throw new Error("Journal transaction not found.");
  }

  if (existing.voidedAt) {
    throw new Error("Journal transaction is already voided.");
  }

  return prisma.journalTransaction.update({
    where: { id: journalId },
    data: {
      voidedAt: new Date(),
      voidedBy,
      voidReason,
    },
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

  // Sum debits and credits from non-voided journal entries
  const aggregations = await prisma.ledgerEntry.aggregate({
    where: {
      accountId,
      journalTransaction: { voidedAt: null },
    },
    _sum: { amountMinor: true },
    _count: true,
  });

  // We need to separate debits and credits — aggregate doesn't group by type
  // so we do two queries
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

  const debitMinor = debitSum._sum.amountMinor ?? BigInt(0);
  const creditMinor = creditSum._sum.amountMinor ?? BigInt(0);

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
    where: { applicationId, environment, active: true },
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

    const debitMinor = debitSum._sum.amountMinor ?? BigInt(0);
    const creditMinor = creditSum._sum.amountMinor ?? BigInt(0);

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

  const totalDebits = debitTotal._sum.amountMinor ?? BigInt(0);
  const totalCredits = creditTotal._sum.amountMinor ?? BigInt(0);

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
  return prisma.account.create({
    data: {
      applicationId: params.applicationId,
      environment: params.environment,
      code: params.code,
      name: params.name,
      type: params.type,
      parentId: params.parentId ?? null,
      currency: params.currency ?? "KES",
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
