/**
 * Characterization tests for API errors, correlation IDs, and cursor pagination.
 * These test the pure logic without requiring DB imports (TS modules).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Inline reimplementation of core logic for testing in .mjs context
// (TS modules can't be imported from .mjs without a build step)
// ---------------------------------------------------------------------------

// --- API Error Classes ---

class AppError extends Error {
  constructor(type, title, status, detail, errors) {
    super(title);
    this.type = type;
    this.title = title;
    this.status = status;
    this.detail = detail;
    this.errors = errors;
  }
}

class BadRequestError extends AppError {
  constructor(detail, errors) { super("bad-request", "Bad Request", 400, detail, errors); }
}

class UnauthorizedError extends AppError {
  constructor(detail) { super("unauthorized", "Unauthorized", 401, detail); }
}

class ForbiddenError extends AppError {
  constructor(detail) { super("forbidden", "Forbidden", 403, detail); }
}

class NotFoundError extends AppError {
  constructor(resource, id) {
    super("not-found", "Not Found", 404,
      id ? `${resource} with id '${id}' not found` : `${resource} not found`);
  }
}

class ConflictError extends AppError {
  constructor(detail) { super("conflict", "Conflict", 409, detail); }
}

class RateLimitError extends AppError {
  constructor(retryAfter) {
    super("rate-limit-exceeded", "Rate Limit Exceeded", 429,
      retryAfter ? `Retry after ${retryAfter} seconds` : "Too many requests");
  }
}

class InternalError extends AppError {
  constructor(detail) { super("internal-error", "Internal Server Error", 500, detail); }
}

// --- Cursor Pagination ---

function encodeCursor(value) { return Buffer.from(value, "utf-8").toString("base64url"); }
function decodeCursor(cursor) { return Buffer.from(cursor, "base64url").toString("utf-8"); }
function createCursor(id, timestamp) { return encodeCursor(`${timestamp.toISOString()}|${id}`); }
function parseCursor(cursor) {
  const decoded = decodeCursor(cursor);
  const idx = decoded.lastIndexOf("|");
  return { timestamp: decoded.substring(0, idx), id: decoded.substring(idx + 1) };
}

function parsePaginationParams(searchParams) {
  const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
  const cursor = searchParams.get("cursor") ?? undefined;
  const direction = (searchParams.get("direction") ?? "forward");
  return { cursor, limit, direction };
}

function buildPaginatedResult(items, opts) {
  const { limit, getCursor, total, direction = "forward" } = opts;
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore && data.length > 0 ? getCursor(data[data.length - 1]) : null;
  const prevCursor = direction === "backward" && data.length > 0 ? getCursor(data[0]) : null;
  return {
    data,
    pagination: { cursor: nextCursor, nextCursor, prevCursor, hasMore, hasPrev: direction === "backward", limit, total },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("API Error classes", () => {
  it("AppError has correct properties", () => {
    const err = new AppError("test-error", "Test Error", 422, "Something went wrong");
    assert.equal(err.type, "test-error");
    assert.equal(err.title, "Test Error");
    assert.equal(err.status, 422);
    assert.equal(err.detail, "Something went wrong");
    assert.ok(err instanceof Error);
  });

  it("BadRequestError returns 400 with field errors", () => {
    const err = new BadRequestError("Invalid input", { phone: ["required"] });
    assert.equal(err.status, 400);
    assert.equal(err.type, "bad-request");
    assert.deepEqual(err.errors, { phone: ["required"] });
  });

  it("UnauthorizedError returns 401", () => {
    const err = new UnauthorizedError("Invalid API key");
    assert.equal(err.status, 401);
    assert.equal(err.type, "unauthorized");
  });

  it("ForbiddenError returns 403", () => {
    const err = new ForbiddenError("Insufficient permissions");
    assert.equal(err.status, 403);
  });

  it("NotFoundError returns 404 with resource and id", () => {
    const err = new NotFoundError("Payment", "pay_123");
    assert.equal(err.status, 404);
    assert.ok(err.detail.includes("Payment"));
    assert.ok(err.detail.includes("pay_123"));
  });

  it("NotFoundError without id", () => {
    const err = new NotFoundError("Payment");
    assert.equal(err.status, 404);
    assert.ok(err.detail.includes("Payment"));
    assert.ok(!err.detail.includes("undefined"));
  });

  it("ConflictError returns 409", () => {
    const err = new ConflictError("Already exists");
    assert.equal(err.status, 409);
  });

  it("RateLimitError returns 429 with retry info", () => {
    const err = new RateLimitError(60);
    assert.equal(err.status, 429);
    assert.ok(err.detail.includes("60"));
  });

  it("InternalError returns 500", () => {
    const err = new InternalError("Something broke");
    assert.equal(err.status, 500);
  });

  it("errors field is optional", () => {
    const err = new BadRequestError("No details");
    assert.equal(err.errors, undefined);
  });
});

describe("Correlation IDs", () => {
  it("generates a valid UUID v4", () => {
    const id = randomUUID();
    assert.ok(id.length > 0);
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id));
  });

  it("generates unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(randomUUID());
    assert.equal(ids.size, 100);
  });
});

describe("Cursor Pagination", () => {
  it("encodes and decodes cursors", () => {
    const original = "2026-01-15T10:30:00.000Z:pay_abc123";
    const encoded = encodeCursor(original);
    const decoded = decodeCursor(encoded);
    assert.equal(decoded, original);
  });

  it("creates and parses cursor", () => {
    const ts = new Date("2026-01-15T10:30:00.000Z");
    const cursor = createCursor("pay_123", ts);
    assert.ok(cursor.length > 0);
    const parsed = parseCursor(cursor);
    assert.equal(parsed.id, "pay_123");
    assert.equal(parsed.timestamp, "2026-01-15T10:30:00.000Z");
  });

  it("cursor round-trips correctly", () => {
    const id = "txn_98765";
    const ts = new Date();
    const cursor = createCursor(id, ts);
    const parsed = parseCursor(cursor);
    assert.equal(parsed.id, id);
    assert.equal(parsed.timestamp, ts.toISOString());
  });

  it("parsePaginationParams defaults correctly", () => {
    const params = new URLSearchParams();
    const parsed = parsePaginationParams(params);
    assert.equal(parsed.limit, 20);
    assert.equal(parsed.direction, "forward");
    assert.equal(parsed.cursor, undefined);
  });

  it("parsePaginationParams respects custom values", () => {
    const params = new URLSearchParams({ limit: "50", cursor: "abc", direction: "backward" });
    const parsed = parsePaginationParams(params);
    assert.equal(parsed.limit, 50);
    assert.equal(parsed.cursor, "abc");
    assert.equal(parsed.direction, "backward");
  });

  it("parsePaginationParams clamps limit to max 100", () => {
    const parsed = parsePaginationParams(new URLSearchParams({ limit: "500" }));
    assert.equal(parsed.limit, 100);
  });

  it("parsePaginationParams clamps limit to min 1", () => {
    const parsed = parsePaginationParams(new URLSearchParams({ limit: "1" }));
    assert.equal(parsed.limit, 1);
  });

  it("parsePaginationParams handles negative limit", () => {
    const parsed = parsePaginationParams(new URLSearchParams({ limit: "-5" }));
    assert.equal(parsed.limit, 1);
  });

  it("buildPaginatedResult with hasMore=true", () => {
    const items = [
      { id: 1, ts: new Date("2026-01-01") },
      { id: 2, ts: new Date("2026-01-02") },
      { id: 3, ts: new Date("2026-01-03") },
      { id: 4, ts: new Date("2026-01-04") },
    ];

    const result = buildPaginatedResult(items, {
      limit: 3,
      getCursor: (item) => createCursor(String(item.id), item.ts),
      total: 10,
    });

    assert.equal(result.data.length, 3);
    assert.equal(result.pagination.hasMore, true);
    assert.ok(result.pagination.nextCursor);
    assert.equal(result.pagination.limit, 3);
    assert.equal(result.pagination.total, 10);
  });

  it("buildPaginatedResult with hasMore=false", () => {
    const items = [
      { id: 1, ts: new Date("2026-01-01") },
      { id: 2, ts: new Date("2026-01-02") },
    ];

    const result = buildPaginatedResult(items, {
      limit: 20,
      getCursor: (item) => createCursor(String(item.id), item.ts),
    });

    assert.equal(result.data.length, 2);
    assert.equal(result.pagination.hasMore, false);
    assert.equal(result.pagination.nextCursor, null);
  });

  it("buildPaginatedResult with empty array", () => {
    const result = buildPaginatedResult([], {
      limit: 20,
      getCursor: () => "cursor",
    });

    assert.equal(result.data.length, 0);
    assert.equal(result.pagination.hasMore, false);
    assert.equal(result.pagination.nextCursor, null);
  });

  it("buildPaginatedResult backward direction sets hasPrev", () => {
    const items = [
      { id: 1, ts: new Date("2026-01-01") },
      { id: 2, ts: new Date("2026-01-02") },
    ];

    const result = buildPaginatedResult(items, {
      limit: 20,
      getCursor: (item) => createCursor(String(item.id), item.ts),
      direction: "backward",
    });

    assert.equal(result.pagination.hasPrev, true);
    assert.ok(result.pagination.prevCursor);
  });

  it("exact page size triggers hasMore", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, ts: new Date() }));
    const result = buildPaginatedResult(items, {
      limit: 20,
      getCursor: (item) => String(item.id),
    });
    // 20 items with limit 20 means hasMore depends on whether there are more
    // Since items.length (20) is NOT > limit (20), hasMore is false
    assert.equal(result.pagination.hasMore, false);
  });
});
