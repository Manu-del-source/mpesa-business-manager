/**
 * GET /v1/health — Public health check endpoint.
 *
 * Returns platform health status including database connectivity.
 *
 * @module app/api/v1/health/route
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const checks: Record<string, string> = {};

  // Database check
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  const status = Object.values(checks).every((s) => s === "ok")
    ? "healthy"
    : "degraded";

  return NextResponse.json(
    {
      status,
      version: process.env.npm_package_version ?? "unknown",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: status === "healthy" ? 200 : 503 },
  );
}
