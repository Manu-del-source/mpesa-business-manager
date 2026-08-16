import "server-only";

/**
 * In-process rate limiting for STK push initiation.
 *
 * Two independent limits, because they stop different problems:
 *   - per organization: stops a compromised/buggy client burning through the
 *     Daraja quota for everyone.
 *   - per phone number: stops a customer being spammed with PIN prompts,
 *     which Safaricom treats as abuse (and which locks the subscriber).
 *
 * SCOPE: this is a single-process, in-memory limiter. It is genuinely useful
 * on a single instance, but it does NOT coordinate across replicas — a
 * horizontally scaled deployment needs a shared store (Redis, Upstash) to
 * enforce these limits globally. Treat it as defence in depth, not a
 * guarantee.
 */

type Bucket = { timestamps: number[] };

const orgBuckets = new Map<string, Bucket>();
const phoneBuckets = new Map<string, Bucket>();

/** Max STK pushes per organization per window. */
export const ORG_LIMIT = 30;
export const ORG_WINDOW_MS = 60_000;

/** Max STK pushes to a single MSISDN per window. */
export const PHONE_LIMIT = 3;
export const PHONE_WINDOW_MS = 60_000;

/** Drop buckets untouched for a while so the maps don't grow unbounded. */
const SWEEP_AFTER_MS = 10 * 60_000;
let lastSweep = Date.now();

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_AFTER_MS) return;
  lastSweep = now;
  for (const map of [orgBuckets, phoneBuckets]) {
    for (const [key, bucket] of map) {
      if (bucket.timestamps.every((t) => now - t > SWEEP_AFTER_MS)) map.delete(key);
    }
  }
}

function take(
  map: Map<string, Bucket>,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): { allowed: boolean; retryAfterSec: number } {
  const bucket = map.get(key) ?? { timestamps: [] };
  const fresh = bucket.timestamps.filter((t) => now - t < windowMs);

  if (fresh.length >= limit) {
    const oldest = Math.min(...fresh);
    map.set(key, { timestamps: fresh });
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  fresh.push(now);
  map.set(key, { timestamps: fresh });
  return { allowed: true, retryAfterSec: 0 };
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "org" | "phone"; retryAfterSec: number; message: string };

/**
 * Consume one STK push token for this org + phone. Call immediately before
 * initiating a push; a rejection means no Daraja request should be made.
 */
export function checkStkPushRateLimit(orgId: string, phone: string): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const perPhone = take(phoneBuckets, `${orgId}:${phone}`, PHONE_LIMIT, PHONE_WINDOW_MS, now);
  if (!perPhone.allowed) {
    return {
      allowed: false,
      reason: "phone",
      retryAfterSec: perPhone.retryAfterSec,
      message: `Too many payment requests to this number. Wait ${perPhone.retryAfterSec}s and try again.`,
    };
  }

  const perOrg = take(orgBuckets, orgId, ORG_LIMIT, ORG_WINDOW_MS, now);
  if (!perOrg.allowed) {
    return {
      allowed: false,
      reason: "org",
      retryAfterSec: perOrg.retryAfterSec,
      message: `Too many M-Pesa requests right now. Wait ${perOrg.retryAfterSec}s and try again.`,
    };
  }

  return { allowed: true };
}

/** Test/maintenance helper — clears all counters. */
export function resetRateLimits(): void {
  orgBuckets.clear();
  phoneBuckets.clear();
}
