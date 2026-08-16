/**
 * Additive, non-destructive M-Pesa schema migration.
 *
 * Adds the MpesaConfig table, the MpesaEnvironment enum and the Daraja
 * callback columns on MpesaTransaction. Every statement is idempotent
 * (IF NOT EXISTS), so this is safe to run against a populated production
 * database: it never drops, truncates or rewrites existing rows.
 *
 * Prefer `npx prisma db push` when the Prisma schema engine is available.
 * This script exists for environments that cannot download that binary.
 *
 * Usage: node scripts/migrate-mpesa.mjs
 */
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const STATEMENTS = [
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MpesaEnvironment') THEN
       CREATE TYPE "MpesaEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');
     END IF;
   END
   $$;`,

  `ALTER TABLE "MpesaTransaction"
     ADD COLUMN IF NOT EXISTS "merchantRequestId" TEXT,
     ADD COLUMN IF NOT EXISTS "checkoutRequestId" TEXT,
     ADD COLUMN IF NOT EXISTS "resultCode"        INTEGER,
     ADD COLUMN IF NOT EXISTS "resultDesc"        TEXT;`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "MpesaTransaction_checkoutRequestId_key"
     ON "MpesaTransaction"("checkoutRequestId");`,

  `CREATE INDEX IF NOT EXISTS "MpesaTransaction_checkoutRequestId_idx"
     ON "MpesaTransaction"("checkoutRequestId");`,

  `CREATE TABLE IF NOT EXISTS "MpesaConfig" (
     "id"             TEXT PRIMARY KEY,
     "organizationId" TEXT NOT NULL UNIQUE REFERENCES "Organization"("id") ON DELETE CASCADE,
     "environment"    "MpesaEnvironment" NOT NULL DEFAULT 'SANDBOX',
     "shortcode"      TEXT NOT NULL,
     "consumerKey"    TEXT NOT NULL,
     "consumerSecret" TEXT NOT NULL,
     "passkey"        TEXT NOT NULL,
     "enabled"        BOOLEAN NOT NULL DEFAULT false,
     "callbackUrl"    TEXT,
     "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
     "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
   );`,

  `CREATE INDEX IF NOT EXISTS "MpesaConfig_organizationId_idx"
     ON "MpesaConfig"("organizationId");`,
];

const client = new Client({ connectionString: url });
await client.connect();

try {
  // Report what already exists so the operator can see nothing was destroyed.
  const before = await client.query(
    `SELECT count(*)::int AS n FROM "MpesaTransaction"`,
  );
  console.log(`MpesaTransaction rows before: ${before.rows[0].n}`);

  for (const sql of STATEMENTS) {
    await client.query(sql);
  }

  const after = await client.query(
    `SELECT count(*)::int AS n FROM "MpesaTransaction"`,
  );
  console.log(`MpesaTransaction rows after:  ${after.rows[0].n}`);
  console.log("✅ M-Pesa schema objects are present. No data was modified.");
} finally {
  await client.end();
}
