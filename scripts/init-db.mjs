import { Client } from "pg";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/template1?sslmode=disable";
const sql = readFileSync(new URL("../prisma/init.sql", import.meta.url), "utf8");

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log("✅ Schema applied.");
} finally {
  await client.end();
}
