import "server-only";

/**
 * Credential-safe logging for the M-Pesa subsystem.
 *
 * Anything logged here goes through `redact()`, which strips values for keys
 * that could carry credentials or bearer tokens. Never log a raw Daraja
 * request body (it contains the base64 STK password) or an Authorization
 * header.
 */

const SENSITIVE_KEY = /(secret|passkey|password|authorization|token|consumerkey|credential)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}

/** Partially mask an MSISDN for logs: 254712345678 -> 2547****5678 */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return "****";
  return `${phone.slice(0, 4)}****${phone.slice(-4)}`;
}

export function logMpesa(event: string, context: Record<string, unknown> = {}): void {
  const payload = redact({
    ...context,
    ...(typeof context.phone === "string" ? { phone: maskPhone(context.phone) } : {}),
  });
  console.info(`[mpesa] ${event}`, JSON.stringify(payload));
}

export function logMpesaError(event: string, context: Record<string, unknown> = {}): void {
  console.error(`[mpesa] ${event}`, JSON.stringify(redact(context)));
}
