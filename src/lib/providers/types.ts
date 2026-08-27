/**
 * PaymentProvider — the port (interface) that all payment provider adapters
 * must implement. This is the primary abstraction boundary between the
 * payment domain and external services (Daraja, Stripe, etc.).
 *
 * Every method is provider-agnostic: the domain sends normalized requests
 * and receives normalized responses. Provider-specific details are hidden
 * inside the adapter implementation.
 */

// ---------------------------------------------------------------------------
// Request/Response types
// ---------------------------------------------------------------------------

export type StkPushRequest = {
  /** Normalized phone number (254XXXXXXXXXX). */
  phone: string;
  /** Amount in minor units (cents). KES only initially. */
  amountMinor: bigint;
  /** Currency code. */
  currency: string;
  /** Business short code or account identifier. */
  shortcode: string;
  /** Optional reference (order ID, receipt number). */
  reference?: string;
  /** Optional description for the customer. */
  description?: string;
  /** Callback URL for async results. */
  callbackUrl?: string;
};

export type StkPushResponse = {
  /** Whether the provider accepted the request. */
  accepted: boolean;
  /** Provider's request ID (e.g. MerchantRequestID). */
  requestId: string | null;
  /** Provider's checkout/session ID (e.g. CheckoutRequestID). */
  checkoutId: string | null;
  /** Message to display to the customer. */
  customerMessage: string;
  /** Provider-specific error code if rejected. */
  errorCode?: string;
  /** Human-readable error if rejected. */
  errorMessage?: string;
};

export type PaymentQueryRequest = {
  /** The checkout/session ID to query. */
  checkoutId: string;
};

export type PaymentQueryResponse = {
  /** Whether the payment is still pending. */
  pending: boolean;
  /** Provider result code (0 = success). */
  resultCode: number | null;
  /** Provider result description. */
  resultDesc: string | null;
  /** Amount received (if successful). */
  amountMinor: bigint | null;
  /** Provider receipt number (if successful). */
  receiptNumber: string | null;
  /** Transaction date from provider. */
  transactionDate: Date | null;
};

export type B2CRequest = {
  /** Recipient phone number. */
  phone: string;
  /** Amount in minor units. */
  amountMinor: bigint;
  /** Currency code. */
  currency: string;
  /** Sender/originator shortcode. */
  shortcode: string;
  /** Optional reference. */
  reference?: string;
  /** Optional remarks. */
  remarks?: string;
};

export type B2CResponse = {
  accepted: boolean;
  requestId: string | null;
  conversationId: string | null;
  errorCode?: string;
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

/**
 * Declares what a provider can do. Used for feature detection at runtime
 * so the domain doesn't assume all providers support all operations.
 */
export type ProviderCapabilities = {
  /** Can initiate STK Push (customer-initiated payments). */
  stkPush: boolean;
  /** Can query STK Push status. */
  stkQuery: boolean;
  /** Can send B2C (business-to-customer) payments. */
  b2c: boolean;
  /** Supports sandbox/test mode. */
  sandbox: boolean;
  /** Supported currencies. */
  currencies: string[];
};

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * The PaymentProvider port. All provider adapters implement this interface.
 *
 * Implementations should be stateless — any state (tokens, caches) is managed
 * internally by the adapter. The domain calls methods and expects normalized
 * responses.
 */
export interface PaymentProvider {
  /** Unique provider identifier (e.g. "daraja", "sandbox", "stripe"). */
  readonly name: string;

  /** Declares provider capabilities. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Initiate an STK Push (customer-initiated payment).
   * Returns immediately with a request ID — the actual result comes via
   * callback or polling with queryStkPush.
   */
  initiateStkPush(request: StkPushRequest): Promise<StkPushResponse>;

  /**
   * Query the status of a previously initiated STK Push.
   * Used for reconciliation when callbacks fail.
   */
  queryStkPush(request: PaymentQueryRequest): Promise<PaymentQueryResponse>;

  /**
   * Send a B2C payment (business to customer).
   * Only available for providers with b2c capability.
   */
  sendB2C?(request: B2CRequest): Promise<B2CResponse>;

  /**
   * Validate that the provider is configured and ready.
   * Returns true if healthy, throws if not.
   */
  healthCheck(): Promise<boolean>;
}
