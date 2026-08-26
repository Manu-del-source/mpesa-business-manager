import { NextResponse } from "next/server";

/**
 * GET /v1/health
 *
 * Public health check endpoint. No authentication required.
 * Returns basic platform status info.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: "v1",
    timestamp: new Date().toISOString(),
  });
}
