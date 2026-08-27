# M-Pesa Business Manager — Double-Entry Ledger

## Overview

The ledger is an append-only, double-entry bookkeeping system. Every financial event creates a balanced `JournalTransaction` with two or more `LedgerEntry` rows. Historical entries are never modified — to reverse an entry, post a new transaction with opposite debits/credits.

## Core Concepts

### Account

A chart of accounts entry with a type that determines its normal balance direction:

| Account Type | Normal Balance | Increases With |
|-------------|---------------|----------------|
| `ASSET` | Debit | Debit entries |
| `LIABILITY` | Credit | Credit entries |
| `EQUITY` | Credit | Credit entries |
| `REVENUE` | Credit | Credit entries |
| `EXPENSE` | Debit | Debit entries |

### Journal Transaction

The atomic unit of the ledger. Every financial event creates exactly one `JournalTransaction` with balanced entries.

**Invariants:**
- `sum(debits) == sum(credits)` for all non-voided entries
- At least two entries per transaction
- Never modified after creation (immutable)

### Ledger Entry

A single debit or credit line within a journal transaction. Append-only — never updated or deleted.

**Invariants:**
- `amountMinor > 0` (always positive)
- Amounts are in minor units (cents) as `BigInt`

## Example: Customer Payment

When a customer pays KES 1,000 via M-Pesa:

```sql
-- Journal Transaction
INSERT INTO JournalTransaction (id, description, reference)
VALUES ('jtx_001', 'Payment from customer via M-Pesa', 'pay_xxxxx');

-- Debit: Cash on Hand increases
INSERT INTO LedgerEntry (journalTransactionId, accountId, type, amountMinor)
VALUES ('jtx_001', 'acc_cash', 'DEBIT', 100000);

-- Credit: Sales Revenue increases
INSERT INTO LedgerEntry (journalTransactionId, accountId, type, amountMinor)
VALUES ('jtx_001', 'acc_revenue', 'CREDIT', 100000);
```

## Example: Refund

To refund KES 500 of the original payment:

```sql
-- Journal Transaction (reversal)
INSERT INTO JournalTransaction (id, description, reference)
VALUES ('jtx_002', 'Refund for pay_xxxxx', 'ref_yyyyy');

-- Debit: Sales Revenue decreases (reversal)
INSERT INTO LedgerEntry (journalTransactionId, accountId, type, amountMinor)
VALUES ('jtx_002', 'acc_revenue', 'DEBIT', 50000);

-- Credit: Cash on Hand decreases (reversal)
INSERT INTO LedgerEntry (journalTransactionId, accountId, type, amountMinor)
VALUES ('jtx_002', 'acc_cash', 'CREDIT', 50000);
```

## Example: Allocation Split

A KES 10,000 payment split 70/20/10 across accounts:

```sql
-- Journal Transaction
INSERT INTO JournalTransaction (id, description, reference)
VALUES ('jtx_003', 'Payment allocation', 'pay_zzzzz');

-- Debit: Cash on Hand
INSERT INTO LedgerEntry (journalTransactionId, accountId, type, amountMinor)
VALUES ('jtx_003', 'acc_cash', 'DEBIT', 100000);

-- Credit: Revenue (70%)
INSERT INTO LedgerEntry (journalTransactionId, accountId, type, amountMinor)
VALUES ('jtx_003', 'acc_revenue', 'CREDIT', 70000);

-- Credit: Tax (20%)
INSERT INTO LedgerEntry (journalTransactionId, accountId, type, amountMinor)
VALUES ('jtx_003', 'acc_tax', 'CREDIT', 20000);

-- Credit: Platform fee (10%)
INSERT INTO LedgerEntry (journalTransactionId, accountId, type, amountMinor)
VALUES ('jtx_003', 'acc_fee', 'CREDIT', 10000);
```

## Balance Computation

Account balances are computed on-the-fly from ledger entries:

```typescript
function computeBalance(entries: LedgerEntry[], accountType: AccountType): bigint {
  let balance = 0n;
  for (const entry of entries) {
    if (isNormalDebit(accountType)) {
      balance += entry.type === "DEBIT" ? entry.amountMinor : -entry.amountMinor;
    } else {
      balance += entry.type === "CREDIT" ? entry.amountMinor : -entry.amountMinor;
    }
  }
  return balance;
}
```

**Normal debit accounts:** ASSET, EXPENSE (debit increases balance)
**Normal credit accounts:** LIABILITY, EQUITY, REVENUE (credit increases balance)

## Voiding Entries

To void a journal transaction, update it with void metadata. The entries remain but are excluded from balance calculations:

```typescript
voidJournalTransaction(id, voidedBy, voidReason)
```

The void is recorded on the `JournalTransaction`:
- `voidedAt` — timestamp of void
- `voidedBy` — actor who voided
- `voidReason` — explanation

## Trial Balance

A trial balance verifies that total debits equal total credits across all active accounts:

```typescript
const trialBalance = await getTrialBalance(applicationId, environment);
// Returns: { accounts: [...], totalDebits, totalCredits, isBalanced }
```

## API

### POST /v1/journal

Create a balanced journal entry:

```json
{
  "description": "Payment from customer",
  "reference": "pay_xxxxx",
  "entries": [
    { "accountId": "acc_1000", "type": "DEBIT", "amountMinor": 50000 },
    { "accountId": "acc_4000", "type": "CREDIT", "amountMinor": 50000 }
  ]
}
```

### GET /v1/accounts

List accounts with optional balance computation:

```
GET /v1/accounts?type=ASSET&includeBalance=true
```

## Invariants

| # | Invariant | Enforcement |
|---|-----------|-------------|
| 1 | Entries balance | `postJournalEntry()` validates sum(debits) == sum(credits) |
| 2 | Positive amounts | Schema CHECK + application validation |
| 3 | At least 2 entries | Application validation |
| 4 | Immutable entries | Append-only; void via reversal |
| 5 | Account exists | Foreign key constraint |
| 6 | Scoped to application+environment | All queries filter by these |
