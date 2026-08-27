/**
 * SandboxProvider — a deterministic payment simulator that implements the
 * PaymentProvider interface. Used for:
 *
 *   - Local development without Safaricom credentials
 *   - Automated testing (deterministic responses)
 *   - Demo mode (always succeeds unless explicitly failed)
 *
 * The sandbox never contacts any external service. All state is ephemeral.
 */

import type {
  PaymentProvider,
  ProviderCapabilities,
  StkPushRequest,
  StkPushResponse,
  PaymentQueryRequest,
  PaymentQueryResponse,
} from "@/lib/providers/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type SandboxConfig = {
  /** If true, every STK push fails with INSUFFICIENT_FUNDS. */
  alwaysFail?: boolean;
  /** If set, this percentage of STK pushes fail randomly (0-100). */
  failureRate?: number;
  /** Simulated processing delay in ms (default 0). */
  delayMs?: number;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type PendingPayment = {
  checkoutId: string;
  requestId: string;
  phone: string;
  amountMinor: bigint;
  reference?: string;
  createdAt: Date;
  status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  resultCode: number;
  resultDesc: string;
};

// ---------------------------------------------------------------------------
// SandboxProvider
// ---------------------------------------------------------------------------

export class SandboxProvider implements PaymentProvider {
  readonly name = "sandbox";

  readonly capabilities: ProviderCapabilities = {
    stkPush: true,
    stkQuery: true,
    b2c: false,
    sandbox: true,
    currencies: ["KES"],
  };

  private config: SandboxConfig;
  private pending = new Map<string, PendingPayment>();
  private requestCounter = 0;

  constructor(config: SandboxConfig = {}) {
    this.config = config;
  }

  async initiateStkPush(request: StkPushRequest): Promise<StkPushResponse> {
    if (this.config.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }

    const checkoutId = `sbx_CO_${Date.now()}_${++this.requestCounter}`;
    const requestId = `sbx_MR_${Date.now()}_${this.requestCounter}`;

    // Determine if this payment should fail
    const shouldFail =
      this.config.alwaysFail ||
      (this.config.failureRate && Math.random() * 100 < this.config.failureRate);

    if (shouldFail) {
      const failure: PendingPayment = {
        checkoutId,
        requestId,
        phone: request.phone,
        amountMinor: request.amountMinor,
        reference: request.reference,
        createdAt: new Date(),
        status: "FAILED",
        resultCode: 1, // INSUFFICIENT_FUNDS
        resultDesc: "The initiator has insufficient funds in their M-Pesa account.",
      };
      this.pending.set(checkoutId, failure);

      return {
        accepted: true, // Safaricom always accepts the request
        requestId,
        checkoutId,
        customerMessage: "Insufficient funds in M-Pesa account.",
      };
    }

    // Success path — mark as PENDING (will be completed via query or callback)
    const pending: PendingPayment = {
      checkoutId,
      requestId,
      phone: request.phone,
      amountMinor: request.amountMinor,
      reference: request.reference,
      createdAt: new Date(),
      status: "PENDING",
      resultCode: 0,
      resultDesc: "The service request is processed successfully.",
    };
    this.pending.set(checkoutId, pending);

    return {
      accepted: true,
      requestId,
      checkoutId,
      customerMessage: "Success. Request accepted for processing.",
    };
  }

  async queryStkPush(request: PaymentQueryRequest): Promise<PaymentQueryResponse> {
    if (this.config.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }

    const payment = this.pending.get(request.checkoutId);

    if (!payment) {
      return {
        pending: false,
        resultCode: 1,
        resultDesc: "Transaction not found.",
        amountMinor: null,
        receiptNumber: null,
        transactionDate: null,
      };
    }

    // Auto-complete after a short time (simulates customer entering PIN)
    const elapsed = Date.now() - payment.createdAt.getTime();
    if (payment.status === "PENDING" && elapsed > 2000) {
      payment.status = "COMPLETED";
    }

    if (payment.status === "PENDING") {
      return {
        pending: true,
        resultCode: null,
        resultDesc: null,
        amountMinor: null,
        receiptNumber: null,
        transactionDate: null,
      };
    }

    if (payment.status === "FAILED") {
      return {
        pending: false,
        resultCode: payment.resultCode,
        resultDesc: payment.resultDesc,
        amountMinor: null,
        receiptNumber: null,
        transactionDate: payment.createdAt,
      };
    }

    // COMPLETED
    const receiptNo = `SBX${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    return {
      pending: false,
      resultCode: 0,
      resultDesc: payment.resultDesc,
      amountMinor: payment.amountMinor,
      receiptNumber: receiptNo,
      transactionDate: payment.createdAt,
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  // -------------------------------------------------------------------------
  // Sandbox-specific helpers (not part of the provider interface)
  // -------------------------------------------------------------------------

  /**
   * Manually complete a pending payment (for testing).
   * Returns the checkoutId if found and completed.
   */
  completePayment(checkoutId: string): boolean {
    const payment = this.pending.get(checkoutId);
    if (!payment || payment.status !== "PENDING") return false;
    payment.status = "COMPLETED";
    payment.resultCode = 0;
    return true;
  }

  /**
   * Manually fail a pending payment (for testing).
   */
  failPayment(checkoutId: string, resultCode = 1): boolean {
    const payment = this.pending.get(checkoutId);
    if (!payment || payment.status !== "PENDING") return false;
    payment.status = "FAILED";
    payment.resultCode = resultCode;
    payment.resultDesc = `Simulated failure with code ${resultCode}`;
    return true;
  }

  /**
   * Get the number of pending payments.
   */
  get pendingCount(): number {
    return Array.from(this.pending.values()).filter((p) => p.status === "PENDING").length;
  }

  /**
   * Clear all pending payments (for test cleanup).
   */
  reset(): void {
    this.pending.clear();
    this.requestCounter = 0;
  }
}
