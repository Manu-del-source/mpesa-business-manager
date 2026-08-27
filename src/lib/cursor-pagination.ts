/**
 * Cursor-based pagination for the /v1 REST API.
 *
 * Uses opaque base64-encoded cursors for stable pagination.
 * Supports both forward and backward pagination.
 *
 * @module lib/cursor-pagination
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginationParams {
  cursor?: string; // Opaque cursor (base64-encoded)
  limit?: number; // Items per page (default: 20, max: 100)
  direction?: "forward" | "backward";
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    cursor: string | null; // Current position cursor
    nextCursor: string | null; // Cursor for next page
    prevCursor: string | null; // Cursor for previous page
    hasMore: boolean;
    hasPrev: boolean;
    limit: number;
    total?: number; // Optional total count
  };
}

// ---------------------------------------------------------------------------
// Cursor encoding/decoding
// ---------------------------------------------------------------------------

/**
 * Encode a cursor value to an opaque base64 string.
 */
export function encodeCursor(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

/**
 * Decode an opaque cursor string back to the original value.
 */
export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, "base64url").toString("utf-8");
}

/**
 * Create a cursor from a database ID and timestamp.
 */
export function createCursor(id: string, timestamp: Date): string {
  return encodeCursor(`${timestamp.toISOString()}|${id}`);
}

/**
 * Parse a cursor into its components.
 */
export function parseCursor(cursor: string): {
  timestamp: string;
  id: string;
} {
  const decoded = decodeCursor(cursor);
  const idx = decoded.lastIndexOf("|");
  const timestamp = decoded.substring(0, idx);
  const id = decoded.substring(idx + 1);
  return { timestamp, id };
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate pagination parameters from query string.
 */
export function parsePaginationParams(searchParams: URLSearchParams): PaginationParams {
  const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
  const cursor = searchParams.get("cursor") ?? undefined;
  const direction = (searchParams.get("direction") as "forward" | "backward") ?? "forward";

  return { cursor, limit, direction };
}

/**
 * Build a paginated result from a list of items.
 */
export function buildPaginatedResult<T>(
  items: T[],
  opts: {
    limit: number;
    getCursor: (item: T) => string;
    total?: number;
    direction?: "forward" | "backward";
  },
): PaginatedResult<T> {
  const { limit, getCursor, total, direction = "forward" } = opts;

  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  const nextCursor = hasMore && data.length > 0
    ? getCursor(data[data.length - 1])
    : null;

  const prevCursor = direction === "backward" && data.length > 0
    ? getCursor(data[0])
    : null;

  return {
    data,
    pagination: {
      cursor: nextCursor,
      nextCursor,
      prevCursor,
      hasMore,
      hasPrev: direction === "backward",
      limit,
      total,
    },
  };
}
