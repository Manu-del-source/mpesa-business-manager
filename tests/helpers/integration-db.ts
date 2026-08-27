/**
 * Integration-test database harness.
 *
 * Each test FILE gets its own fresh PostgreSQL database with the REAL
 * production migrations applied (prisma/migrations/*) — so every integration
 * run re-verifies the migration chain end-to-end.
 *
 * Configuration:
 *   TEST_DATABASE_ADMIN_URL — admin connection used to create/drop the test
 *                             databases (default: the sandbox PostgreSQL at
 *                             postgres://postgres@127.0.0.1:5434/postgres).
 *                             If unset AND DATABASE_URL is unset, integration
 *                             tests SKIP (no silent failures, no accidental
 *                             writes to a real database).
 *
 * The harness sets process.env.DATABASE_URL to the fresh database BEFORE the
 * lazy Prisma client is first used (src/lib/prisma.ts creates the client
 * lazily for exactly this reason).
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

export const DEFAULT_ADMIN_URL =
  "postgres://postgres@127.0.0.1:5434/postgres";

export function adminUrl(): string {
  return process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL;
}

export function integrationTestsAvailable(): boolean {
  return Boolean(process.env.TEST_DATABASE_ADMIN_URL ?? (process.env.DATABASE_URL ?? "").length);
}

export type IntegrationDb = {
  databaseName: string;
  url: string;
};

export async function createIntegrationDb(
  fileLabel: string,
): Promise<IntegrationDb> {
  const admin = adminUrl();
  const suffix = `${fileLabel}_${process.pid}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 50);
  const databaseName = `mbm_it_${suffix}`;

  const adminClient = new Client({ connectionString: admin });
  await adminClient.connect();
  await adminClient
    .query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`)
    .catch(() => {}); // WITH (FORCE) needs PG13+; tolerate older
  await adminClient.query(`CREATE DATABASE ${databaseName}`);
  await adminClient.end();

  // Apply the real production migrations in order.
  const migrationsDir = path.join(REPO_ROOT, "prisma", "migrations");
  const migrationDirs = fs
    .readdirSync(migrationsDir)
    .filter((entry) =>
      fs.existsSync(path.join(migrationsDir, entry, "migration.sql")),
    )
    .sort();

  const dbUrl = admin.replace(/\/[^/]+$/, `/${databaseName}`);
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  try {
    for (const dir of migrationDirs) {
      const sql = fs.readFileSync(
        path.join(migrationsDir, dir, "migration.sql"),
        "utf8",
      );
      await db.query(sql);
    }
  } finally {
    await db.end();
  }

  process.env.DATABASE_URL = dbUrl;
  return { databaseName, url: dbUrl };
}

export async function dropIntegrationDb(db: IntegrationDb): Promise<void> {
  const adminClient = new Client({ connectionString: adminUrl() });
  await adminClient.connect();
  await adminClient.query(`DROP DATABASE IF EXISTS ${db.databaseName} WITH (FORCE)`);
  await adminClient.end();
}
