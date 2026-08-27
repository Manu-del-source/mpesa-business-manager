import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertDatabaseConfigured, env } from "@/lib/env";

/**
 * Prisma client (Prisma 7 + pg adapter).
 *
 * The client is created LAZILY on first use, not at module load. Modules all
 * over the app import `prisma`; instantiating the adapter at import time
 * would require a live DATABASE_URL even for build-time work (Next.js
 * page-data collection during `next build`) that never touches the database.
 *
 * The first actual query still fails fast with a clear error when
 * DATABASE_URL is unset — see assertDatabaseConfigured().
 */

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  assertDatabaseConfigured();
  const adapter = new PrismaPg({ connectionString: env.databaseUrl });
  return new PrismaClient({ adapter });
}

/**
 * Lazy proxy: forwards property access to the real client, creating it on
 * first use. Methods are bound to the real client so `this` is correct, and
 * `$connect`/`$disconnect` on a never-initialized proxy are no-ops.
 */
function createLazyClient(): PrismaClient {
  let client: PrismaClient | null = null;

  const resolve = (): PrismaClient => (client ??= createClient());

  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (
        (prop === "$connect" || prop === "$disconnect") &&
        client === null
      ) {
        return async () => {};
      }
      const value = Reflect.get(resolve(), prop) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(resolve())
        : value;
    },
    has(_target, prop) {
      return Reflect.has(resolve(), prop);
    },
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createLazyClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
