# M-Pesa Business Manager

An all-in-one dashboard for Kenyan SMEs — run sales, M-Pesa transactions,
expenses, inventory and customers from a single place.

Built with **Next.js 16 (App Router)**, **Prisma 7** (query-compiler client +
`pg` driver adapter), **PostgreSQL**, **Tailwind CSS v4**, **Radix UI**,
**Recharts** and **Supabase Auth** (optional).

---

## Features

- **Point of sale** — ring up sales with M-Pesa STK push, cash, card, bank or credit.
- **M-Pesa** — incoming/outgoing transaction ledger with simulated Daraja STK push in demo mode.
- **Inventory** — cost/selling prices, margins, stock levels and low-stock alerts.
- **Customers** — contact book with loyalty points and purchase history.
- **Expenses** — categorised cost tracking (rent, salaries, stock, utilities…).
- **Reports** — profit & loss, cash flow, top products and top customers.
- **Dashboard** — live KPIs, revenue chart, payment-method breakdown and activity feeds.
- **Demo mode** — zero-config sign-in and a seeded Nairobi grocery ("Kijani Fresh Foods").

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Start a database

**Option A — Docker (recommended):**

```bash
docker compose up -d
```

**Option B — Prisma Postgres dev server (no Docker, WASM-based):**

```bash
npx prisma dev --db-port 5433
```

### 3. Configure environment

```bash
cp .env.example .env
```

The default `DATABASE_URL` targets the local database from either option above.

### 4. Create the schema & seed demo data

```bash
npm run db:setup
```

This runs `prisma db push` followed by the seed script, creating the
"Kijani Fresh Foods" demo business with ~90 days of realistic sales, M-Pesa
transactions, expenses, products and customers.

> **No Prisma engine download available?** If the sandbox/CI can't reach
> `binaries.prisma.sh`, bootstrap the schema manually instead:
>
> ```bash
> node scripts/init-db.mjs   # applies prisma/init.sql (mirrors schema.prisma)
> npx tsx prisma/seed.ts     # seeds demo data
> ```
>
> The generated client is produced with:
> ```bash
> PRISMA_SCHEMA_ENGINE_BINARY=/tmp/dummy npx prisma generate
> ```

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). In **demo mode**
(no Supabase env vars), click **Sign in** and use any email/password — you'll
land on the seeded demo dashboard.

---

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string. |
| `NEXT_PUBLIC_APP_URL` | — | Public app URL (defaults to `http://localhost:3000`). |
| `NEXT_PUBLIC_SUPABASE_URL` | — | Supabase project URL. Leave blank for demo mode. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | Supabase anon key. Leave blank for demo mode. |
| `DARAJA_ENABLED` | — | `true` to enable real M-Pesa Daraja API (default `false` = simulated). |
| `DARAJA_CONSUMER_KEY` | — | Daraja consumer key. |
| `DARAJA_CONSUMER_SECRET` | — | Daraja consumer secret. |
| `DARAJA_PASSKEY` | — | Daraja STK push passkey. |
| `DARAJA_SHORTCODE` | — | Paybill/till shortcode. |
| `DARAJA_ENVIRONMENT` | — | `sandbox` or `production`. |

---

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` | Production build. |
| `npm run start` | Start the production server. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript check. |
| `npm run db:push` | Push the Prisma schema to the database. |
| `npm run db:seed` | Seed the demo data. |
| `npm run db:setup` | `db:push` + `db:seed`. |
| `npm run db:studio` | Open Prisma Studio. |

---

## Project structure

```
prisma/
  schema.prisma      # data model (Organization → Products, Customers, Sales…)
  seed.ts            # demo data seeder
  init.sql           # manual schema bootstrap (offline fallback)
scripts/
  init-db.mjs        # applies prisma/init.sql via the pg driver
src/
  app/               # App Router pages (landing, auth, dashboard, sales, …)
  components/        # UI primitives + feature components
  lib/               # auth, prisma client, stats, M-Pesa Daraja, validations
  generated/prisma/  # generated Prisma client (gitignored — run db:setup)
```

---

## Demo mode vs. production

- **Demo mode** (no Supabase vars): auth is simulated with a cookie and M-Pesa
  STK push is simulated end-to-end. Perfect for evaluation.
- **Production**: set Supabase for auth and Daraja for real M-Pesa. The rest of
  the app is identical.

---

## License

Private.
