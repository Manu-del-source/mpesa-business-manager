/**
 * Typed Daraja failures.
 *
 * Every error carries a `code` used to pick a user-facing message and a
 * `userMessage` that is safe to display. Raw Safaricom responses are kept in
 * `detail` for server-side logging only — never render `detail` in the UI, and
 * never put credentials in it.
 */

export type DarajaErrorCode =
  | "NOT_CONFIGURED"
  | "DISABLED"
  | "INVALID_CREDENTIALS"
  | "AUTH_FAILED"
  | "NETWORK"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "DARAJA_ERROR"
  | "UNKNOWN";

const USER_MESSAGES: Record<DarajaErrorCode, string> = {
  NOT_CONFIGURED:
    "M-Pesa is not configured for this business yet. Add your Daraja credentials in M-Pesa settings.",
  DISABLED:
    "M-Pesa payments are switched off for this business. Enable them in M-Pesa settings.",
  INVALID_CREDENTIALS:
    "Safaricom rejected your Daraja credentials. Check the consumer key and secret in M-Pesa settings.",
  AUTH_FAILED:
    "Could not authenticate with Safaricom. Please try again in a moment.",
  NETWORK:
    "Could not reach Safaricom. Check your internet connection and try again.",
  TIMEOUT: "Safaricom took too long to respond. Please try again.",
  RATE_LIMITED: "Too many M-Pesa requests. Wait a few seconds and try again.",
  INVALID_REQUEST:
    "Safaricom rejected the payment request. Check the phone number and amount.",
  DARAJA_ERROR: "Safaricom could not process this request. Please try again.",
  UNKNOWN: "Something went wrong with the M-Pesa request. Please try again.",
};

export class DarajaError extends Error {
  readonly code: DarajaErrorCode;
  readonly userMessage: string;
  readonly detail?: string;
  readonly status?: number;

  constructor(
    code: DarajaErrorCode,
    options: { detail?: string; status?: number; userMessage?: string } = {},
  ) {
    super(options.detail ?? USER_MESSAGES[code]);
    this.name = "DarajaError";
    this.code = code;
    this.userMessage = options.userMessage ?? USER_MESSAGES[code];
    this.detail = options.detail;
    this.status = options.status;
  }
}

export function toDarajaError(err: unknown): DarajaError {
  if (err instanceof DarajaError) return err;

  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      return new DarajaError("TIMEOUT", { detail: err.message });
    }
    // Undici/fetch network failures.
    if (err.name === "TypeError" || /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(err.message)) {
      return new DarajaError("NETWORK", { detail: err.message });
    }
    return new DarajaError("UNKNOWN", { detail: err.message });
  }

  return new DarajaError("UNKNOWN", { detail: String(err) });
}

/** Map an HTTP status from Daraja to a typed error code. */
export function codeForStatus(status: number): DarajaErrorCode {
  if (status === 400) return "INVALID_REQUEST";
  if (status === 401 || status === 403) return "INVALID_CREDENTIALS";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "DARAJA_ERROR";
  return "DARAJA_ERROR";
}

export function userMessageFor(code: DarajaErrorCode): string {
  return USER_MESSAGES[code];
}
