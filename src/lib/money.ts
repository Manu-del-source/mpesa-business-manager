/**
 * Exact money representation for the financial core.
 *
 * RULES (enforced platform-wide):
 *   1. Monetary amounts are integer minor units (cents) stored as BigInt.
 *   2. Public API boundaries accept decimal STRINGS ("1549") and convert
 *      them DIRECTLY to BigInt — never through a JS number.
 *   3. JSON numbers are accepted only when they are exactly representable
 *      (Number.isSafeInteger + integral); anything else is rejected.
 *   4. Nothing in this module (or anywhere else) rounds, truncates, floors,
 *      ceils or clamps a monetary amount. If a provider cannot represent an
 *      amount exactly, the operation is REJECTED.
 *
 * This module is dependency-free so tests and seed code can import it.
 */

export type MoneyParseResult =
  | { ok: true; amountMinor: bigint }
  | { ok: false; error: string; code: "INVALID_AMOUNT" };

/**
 * Absolute upper bound for any single minor-unit amount handled by the
 * platform: 2^63 - 1 minor units (the largest BigInt PostgreSQL's BIGINT
 * column can store). Anything at or above this is rejected before it reaches
 * the database.
 */
export const MAX_AMOUNT_MINOR = 9223372036854775807n; // 2^63 - 1

/** Strict decimal-string pattern: digits only, no sign, no whitespace. */
const DECIMAL_STRING_PATTERN = /^[0-9]+$/;

/**
 * Parse an amount in minor units from a decimal string or a JSON number.
 *
 * Strings are the recommended wire format: "1549" → 1549n exactly, of any
 * magnitude. Numbers are only accepted when Number.isSafeInteger(value)
 * holds — 9007199254740993 (already rounded by JSON.parse) is rejected.
 *
 * Zero and negative values are rejected here; "0" and "-100" never produce
 * a valid amount. Leading zeros ("007") are accepted (value-preserving).
 */
export function parseAmountMinor(
  input: string | number | unknown,
): MoneyParseResult {
  if (typeof input === "string") {
    if (!DECIMAL_STRING_PATTERN.test(input)) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        error:
          "Amount must be a non-negative integer in minor units, " +
          `provided as a decimal string (got ${JSON.stringify(input)}).`,
      };
    }
    if (input.length > 1 && input.startsWith("0")) {
      // Normalize leading zeros so "007" and "7" hash identically for
      // idempotency purposes; still exact.
      const normalized = input.replace(/^0+/, "") || "0";
      return parseAmountMinor(normalized);
    }
    const amountMinor = BigInt(input);
    if (amountMinor <= 0n) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        error: "Amount must be greater than zero.",
      };
    }
    if (amountMinor > MAX_AMOUNT_MINOR) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        error: "Amount exceeds the maximum supported minor-unit value.",
      };
    }
    return { ok: true, amountMinor };
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        error: "Amount must be a finite number.",
      };
    }
    if (!Number.isInteger(input)) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        error: `Amount must be an integer number of minor units (got ${input}).`,
      };
    }
    if (!Number.isSafeInteger(input)) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        error:
          "Amount exceeds JavaScript's safe integer range. Send the amount " +
          "as a decimal string, e.g. \"amountMinor\": \"9007199254740993\".",
      };
    }
    // Delegate to the string path for the range checks.
    return parseAmountMinor(String(input));
  }

  return {
    ok: false,
    code: "INVALID_AMOUNT",
    error: "Amount must be a decimal string or a safe integer.",
  };
}

/** Strict ISO-4217-style currency pattern: exactly 3 uppercase letters. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/** Validate a currency code (e.g. "KES"). */
export function isValidCurrency(currency: string): boolean {
  return CURRENCY_PATTERN.test(currency);
}

/**
 * Validate a currency code, returning a normalized result.
 */
export function parseCurrency(
  input: string | unknown,
): { ok: true; currency: string } | { ok: false; error: string } {
  if (typeof input !== "string" || !isValidCurrency(input)) {
    return {
      ok: false,
      error: `Currency must be a 3-letter ISO code (e.g. "KES"), got ${JSON.stringify(input)}.`,
    };
  }
  return { ok: true, currency: input };
}

// ---------------------------------------------------------------------------
// Provider constraints
// ---------------------------------------------------------------------------

/**
 * Daraja amount constraints.
 *
 * Daraja's STK Push `Amount` field is a whole number of Kenyan shillings —
 * it cannot represent fractional shillings. Rather than rounding a minor
 * amount to the nearest whole KES (which silently changes what the customer
 * is charged), we REJECT amounts that are not an exact multiple of 100
 * minor units.
 *
 * The per-transaction M-Pesa limit for paybill/till collections is
 * KES 150,000 per transaction; we validate it before calling the provider
 * so the internal record never diverges from an attempted provider charge.
 */
export const DARAJA_MAX_TRANSACTION_MINOR = 15_000_000n; // KES 150,000.00

/**
 * Validate a minor-unit amount against Daraja's constraints.
 * Returns null when acceptable, or a rejection reason.
 */
export function darajaAmountConstraint(
  amountMinor: bigint,
): { ok: true; amountKes: bigint } | { ok: false; error: string } {
  if (amountMinor <= 0n) {
    return { ok: false, error: "Amount must be greater than zero." };
  }
  if (amountMinor % 100n !== 0n) {
    return {
      ok: false,
      error:
        "Daraja only accepts whole Kenyan shillings. Amount must be a " +
        `multiple of 100 minor units (got ${amountMinor}).`,
    };
  }
  if (amountMinor > DARAJA_MAX_TRANSACTION_MINOR) {
    return {
      ok: false,
      error: `Amount exceeds the KES 150,000 per-transaction M-Pesa limit (got ${amountMinor} minor units).`,
    };
  }
  return { ok: true, amountKes: amountMinor / 100n };
}
