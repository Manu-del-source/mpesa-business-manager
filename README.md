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
| `MPESA_CALLBACK_BASE_URL` | — | Public HTTPS base URL Safaricom posts callbacks to. Falls back to `NEXT_PUBLIC_APP_URL`. |
| `MPESA_CALLBACK_TOKEN` | — | Shared secret appended to the callback URL as `?token=…`. Recommended. |
| `MPESA_CREDENTIALS_KEY` | — | 32-byte key (base64/hex) encrypting Daraja secrets at rest. Recommended in production. |
| `DARAJA_TIMEOUT_MS` | — | Daraja HTTP timeout (default `20000`). |
| `MPESA_CRON_SECRET` | — | Shared secret for `/api/mpesa/reconcile`. Endpoint returns 503 until set. |
| `DARAJA_BASE_URL_OVERRIDE` | — | **Testing only.** Redirects sandbox traffic to a local mock; ignored for production. Must be unset for a real sandbox test. |
| `DARAJA_ENABLED` | — | Legacy single-tenant fallback: `true` to use the `DARAJA_*` vars below. |
| `DARAJA_CONSUMER_KEY` | — | Legacy fallback consumer key. |
| `DARAJA_CONSUMER_SECRET` | — | Legacy fallback consumer secret. |
| `DARAJA_PASSKEY` | — | Legacy fallback STK push passkey. |
| `DARAJA_SHORTCODE` | — | Legacy fallback paybill/till shortcode. |
| `DARAJA_ENVIRONMENT` | — | Legacy fallback: `sandbox` or `production`. |

> **None of the M-Pesa variables are `NEXT_PUBLIC_*`.** Consumer secrets and
> passkeys are read server-side only and must never be exposed to the browser.

Daraja credentials are normally configured **per business** in the app
(**Settings → M-Pesa settings**) and stored in the `MpesaConfig` table; the
`DARAJA_*` env vars are only a fallback for single-tenant deployments.

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
  migrate-mpesa.mjs  # additive, non-destructive M-Pesa schema migration
  mpesa-doctor.mjs   # pre-flight config check before a real sandbox test
  mock-daraja.mjs    # offline Daraja test double
  verify-mpesa.mjs   # M-Pesa integration smoke tests
src/
  app/               # App Router pages (landing, auth, dashboard, sales, …)
  components/        # UI primitives + feature components
  lib/mpesa/         # Daraja: config, oauth, stk push, callback, reconcile,
                     #         rate-limit, crypto, errors, logging
  lib/               # auth, prisma client, stats, validations
  generated/prisma/  # generated Prisma client (gitignored — run db:setup)
```

---

## Demo mode vs. production

- **Demo mode** (`DEMO_MODE=true`): auth is simulated with a cookie and M-Pesa
  STK push is simulated end-to-end — no Safaricom credentials required and no
  requests are sent to Daraja. Perfect for evaluation.
- **Production**: set `DEMO_MODE=false`, configure Supabase for auth, and add
  Daraja credentials per business. The rest of the app is identical.

---

## M-Pesa (Safaricom Daraja) integration

### Status

| Stage | State |
| --- | --- |
| Implemented locally | ✅ OAuth, STK Push, STK Query, callback, per-org config, UI |
| Verified against a local mock Daraja | ✅ `scripts/mock-daraja.mjs` + `scripts/verify-mpesa.mjs` |
| Tested against the real Safaricom sandbox | ❌ **Not yet** — requires your own Daraja credentials and a public callback URL |
| Production-ready | ❌ **Not yet** — see "Remaining production requirements" below |

> 📋 **Preparing a real sandbox test?** Follow
> [`docs/DARAJA_SANDBOX_TEST.md`](docs/DARAJA_SANDBOX_TEST.md) — required env
> vars, the exact callback URL, Daraja setup, test commands and a step-by-step
> checklist.

### Pre-flight check

```bash
node --import tsx --conditions=react-server scripts/mpesa-doctor.mjs
```

Validates env vars, callback URL reachability, secret handling and saved
credentials **without contacting Safaricom**. Exits non-zero on blocking
problems. Never prints secret values.

### Configure a business

1. Sign in as the business **owner or admin**.
2. Go to **Settings → M-Pesa settings** (`/settings/mpesa`).
3. Enter environment, shortcode, consumer key, consumer secret and passkey.
4. Press **Test connection** (performs a real Daraja OAuth call).
5. Toggle **Enable M-Pesa payments** and save.

Secrets are write-only: once saved they are never returned to the browser.
Leave a secret field blank when editing to keep the stored value.

### Testing STK Push in the Daraja sandbox

1. Get sandbox credentials from
   [developer.safaricom.co.ke](https://developer.safaricom.co.ke) — shortcode
   `174379` plus the M-Pesa Express passkey.
2. Expose your local server publicly (Safaricom cannot reach `localhost`):
   ```bash
   ngrok http 3000
   # then set MPESA_CALLBACK_BASE_URL="https://<subdomain>.ngrok-free.app"
   ```
3. Configure the business as above with **Sandbox** selected.
4. On **/mpesa** click **Request payment**, use test MSISDN `254708374149`,
   any amount ≥ 1, and submit.
5. The transaction appears as **Pending**; the callback settles it to
   **Successful** with the Safaricom receipt number. Use **Check** on the row
   to reconcile via STK Push Query if the callback is delayed.

### Offline verification

```bash
node scripts/mock-daraja.mjs &                       # fake Daraja
DARAJA_BASE_URL_OVERRIDE=http://127.0.0.1:4499 \
  node --import tsx --conditions=react-server scripts/verify-mpesa.mjs
```

`DARAJA_BASE_URL_OVERRIDE` is ignored for the `production` environment so it
can never redirect real payment traffic.

### Reconciliation (missed callbacks)

Callbacks do get lost — a deploy restarts mid-flight, or the callback URL is
briefly unreachable. `POST /api/mpesa/reconcile` sweeps stale `PENDING`
transactions and settles them from Safaricom's own STK Push Query result.

```bash
curl -X POST https://your-app/api/mpesa/reconcile \
  -H "Authorization: Bearer $MPESA_CRON_SECRET"
# {"ok":true,"scanned":4,"settled":2,"stillPending":1,"expired":1,"errors":0}
```

Schedule it every 5–15 minutes (Vercel Cron, GitHub Actions, systemd timer,
k8s CronJob). Transactions younger than 2 minutes are left alone; those older
than 1 hour with no answer are marked `TIMEOUT`. Every write is guarded by
`status: PENDING`, so concurrent runs and replays are safe.

### Rate limiting

STK push initiation is limited to **3 requests per phone per minute** and
**30 per organization per minute**, protecting the Daraja quota and preventing
customers from being spammed with PIN prompts. Demo mode is not limited.

> ⚠️ The limiter is **in-process**. It is effective on a single instance but
> does not coordinate across replicas — a horizontally scaled deployment needs
> a shared store (Redis/Upstash) to enforce these limits globally.

### Remaining production requirements

- **Test end-to-end against the real Safaricom sandbox**, then apply for
  Go-Live. This is the big one — see the status table above.
- Set `MPESA_CREDENTIALS_KEY` so secrets are encrypted at rest.
- Set `MPESA_CALLBACK_TOKEN` and serve the callback over HTTPS; ideally also
  restrict ingress to Safaricom's published IP ranges.
- Set `MPESA_CRON_SECRET` and schedule `/api/mpesa/reconcile`.
- Replace the in-process rate limiter with a shared store if running more than
  one instance.
- Add alerting on `[mpesa] callback.*` and `[mpesa] reconcile.failed` log
  events, and on any sustained rise in `PENDING` transactions.

---

## License

Private.
