/**
 * Structured API error responses for /v1 endpoints.
 *
 * Follows RFC 7807 Problem Details format for consistent error handling.
 *
 * @module lib/api-errors
 */

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiError {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class AppError extends Error {
  public readonly type: string;
  public readonly title: string;
  public readonly status: number;
  public readonly detail?: string;
  public readonly errors?: Record<string, string[]>;

  constructor(
    type: string,
    title: string,
    status: number,
    detail?: string,
    errors?: Record<string, string[]>,
  ) {
    super(title);
    this.type = type;
    this.title = title;
    this.status = status;
    this.detail = detail;
    this.errors = errors;
  }
}

export class BadRequestError extends AppError {
  constructor(detail?: string, errors?: Record<string, string[]>) {
    super("bad-request", "Bad Request", 400, detail, errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail?: string) {
    super("unauthorized", "Unauthorized", 401, detail);
  }
}

export class ForbiddenError extends AppError {
  constructor(detail?: string) {
    super("forbidden", "Forbidden", 403, detail);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      "not-found",
      "Not Found",
      404,
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
    );
  }
}

export class ConflictError extends AppError {
  constructor(detail?: string) {
    super("conflict", "Conflict", 409, detail);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super(
      "rate-limit-exceeded",
      "Rate Limit Exceeded",
      429,
      retryAfter ? `Retry after ${retryAfter} seconds` : "Too many requests",
    );
  }
}

export class InternalError extends AppError {
  constructor(detail?: string) {
    super("internal-error", "Internal Server Error", 500, detail);
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/**
 * Create a structured error response (RFC 7807 Problem Details).
 */
export function errorResponse(
  error: AppError,
  correlationId?: string,
  instance?: string,
): NextResponse {
  const body: ApiError = {
    type: `https://api.mpesa-business-manager.com/errors/${error.type}`,
    title: error.title,
    status: error.status,
    detail: error.detail,
    instance,
    errors: error.errors,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/problem+json",
  };

  if (correlationId) {
    headers["x-request-id"] = correlationId;
  }

  if (error instanceof RateLimitError) {
    headers["Retry-After"] = "60";
  }

  return NextResponse.json(body, { status: error.status, headers });
}

/**
 * Create a structured success response.
 */
export function successResponse<T>(
  data: T,
  correlationId?: string,
  meta?: Record<string, unknown>,
): NextResponse {
  const body = {
    data,
    ...(meta ? { meta } : {}),
  };

  const headers: Record<string, string> = {};
  if (correlationId) {
    headers["x-request-id"] = correlationId;
  }

  return NextResponse.json(body, { headers });
}

/**
 * Create a paginated success response.
 */
export function paginatedResponse<T>(
  data: T[],
  opts: {
    total: number;
    limit: number;
    offset: number;
    correlationId?: string;
  },
): NextResponse {
  return successResponse(data, opts.correlationId, {
    total: opts.total,
    limit: opts.limit,
    offset: opts.offset,
    hasMore: opts.offset + opts.limit < opts.total,
  });
}
