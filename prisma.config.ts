import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Required while the Prisma 7 config API is in Early Access.
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(__dirname, "prisma", "migrations"),
    seed: "npx tsx prisma/seed.ts",
  },
  // Resolved lazily so commands that don't need a database (`prisma generate`,
  // `prisma validate`, `prisma --version`) work without DATABASE_URL. Commands
  // that do need one (migrate, db push, studio) fail with a clear error when
  // the variable is unset.
  datasource: {
    url: process.env.DATABASE_URL,
  },
} as Parameters<typeof defineConfig>[0]);

