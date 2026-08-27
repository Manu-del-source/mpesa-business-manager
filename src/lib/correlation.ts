/**
 * Correlation ID middleware — generates and injects a unique request ID
 * into every request/response cycle.
 *
 * Used for distributed tracing across the platform.
 *
 * @module lib/correlation
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const CORRELATION_HEADER = "x-request-id";

/**
 * Generate a unique correlation ID for a request.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Middleware that ensures every request has a correlation ID.
 * If the client sends one, we reuse it (for distributed tracing).
 * Otherwise, we generate a new one.
 */
export function withCorrelationId(request: NextRequest): {
  correlationId: string;
  response: NextResponse;
} {
  const correlationId =
    request.headers.get(CORRELATION_HEADER) || generateCorrelationId();

  const response = NextResponse.next();
  response.headers.set(CORRELATION_HEADER, correlationId);

  return { correlationId, response };
}

/**
 * Create a response with correlation ID header.
 */
export function jsonResponseWithCorrelation(
  body: unknown,
  status: number,
  correlationId: string,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      [CORRELATION_HEADER]: correlationId,
    },
  });
}
