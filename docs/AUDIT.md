# Phase 0 — Repository Architecture Audit

> Baseline assessment of `mpesa-business-manager` at commit `2a79a28`
> (branch `master`), taken before any infrastructure work begins.
>
> Verdict: the existing app is a **single-tenant Next.js POS/business manager**
> with a genuinely solid Daraja STK Push core (idempotent callbacks, OAuth
> caching, encrypted credentials, reconciliation sweep). The financial
> primitives are good enough to KEEP and refactor into a provider adapter.
> Everything tenant/application/ledger/API related must be NEW.

---

## 1. Current architecture summary

- **Stack**: Next.js 16 (App Router, React 19, server actions), TypeScript,
  Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), PostgreSQL
  (Supabase-compatible; local dev via docker-compose Postgres 16), Tailwind 4 +
  Radix UI, zod for validation. Supabase used **only** for Auth (`@supabase/ssr`
  cookies-based session); no Supabase Data API usage detected.
- **Shape**: a classic monolithic full-stack app. All business logic lives in
  `src/lib/*` (server-only modules), invoked from:
  - React Server Components / pages under `src/app/(app)/*`
  - Server actions under `src/app/actions/*` (the de-facto "API")
  - Exactly two HTTP API routes: `/api/mpesa/callback` and `/api/mpesa/reconcile`.
- **Tenancy**: `Organization` is the only tenant boundary. It is resolved per
  request in `requireAppContext()` (`src/lib/auth.ts`) — but it picks the
  *first* membership found (`findFirst`) rather than an explicit active-org
  selection, and auto-provisions a personal org on first sign-in.
- **No domain layering**: payments, config, rate limiting, etc. are flat
  modules under `src/lib/mpesa/`. No provider abstraction, no ledger, no
  events/webhooks/idempotency/API keys.
- **Schema management**: `prisma db push` (no `prisma/migrations/` directory).
  A hand-maintained `prisma/init.sql` bootstrap mirrors the schema for offline
  environments. This is a migration-strategy risk (see §9).

## 2. Existing database model summary (`prisma/schema.prisma`, 7 models)

| Model | Purpose | Notes |
|---|---|---|
| `Organization` | Tenant root | `slug` unique, `tier FREE/PRO`, `businessType` |
| `OrganizationMember` | Membership | `role OWNER/ADMIN/STAFF`; `userId` = Supabase auth user id; unique `(organizationId, userId)` |
| `Product` | Inventory | Decimal(12,2) prices, stock int |
| `Customer` | POS customers | org-scoped, phone index |
| `Sale` / `SaleItem` | POS receipts | receiptNo unique globally; links to M-Pesa via `mpesaReference` |
| `MpesaTransaction` | STK Push record | PENDING→SUCCESS/FAILED/CANCELLED/TIMEOUT; unique `checkoutRequestId`; Daraja result codes stored |
| `MpesaConfig` | Per-org Daraja creds | `consumerSecret`/`passkey` AES-256-GCM encrypted at rest (`enc:v1:` envelope) |
| `Expense` | Business expense tracking | STOR1-style business logic |

Key observations:
- Money uses `Decimal(12,2)` columns (good) but flows through JS `number` with
  `toFixed(2)` conversions at boundaries (acceptable today, must become integer
  minor units in the new platform core).
- `checkoutRequestId @unique` is a real DB-level idempotency anchor for pushes.
- No foreign keys to a users table (Supabase auth id as plain string) — fine,
  keep as-is.
- **No Row Level Security anywhere** despite Supabase being present. Isolation
  relies entirely on application-level `organizationId` scoping.
- No soft-delete, no audit log, no event store, no idempotency table, no API
  key table, no environment column on transactions.

## 3. Existing M-Pesa flow

**STK Push collection flow (works end-to-end, sandbox-tested):**

1. `initiateStkPush()` (`src/lib/mpesa/index.ts`): validates phone
   (Kenyan MSISDN normalization) and amount (KES 1–150,000), resolves org
   config, decides demo vs live, creates `MpesaTransaction` as **PENDING
   first** (intent-before-network pattern — good), rate-limits *live* traffic
   only, then calls Daraja.
2. `sendDarajaStkPush()` (`daraja.ts`): builds timestamp/password, OAuth token
   with in-process cache + single-flight + 401 retry, preflight-validates the
   callback URL (HTTPS, public host, correct path), stores
   `merchantRequestId`/`checkoutRequestId`. Transaction stays PENDING.
3. Callback: Safaricom POSTs `/api/mpesa/callback?token=...` → shared-secret
   check → JSON parse → strict structural validation (`parseStkCallback`,
   EAT timestamp parsing, metadata extraction) → `applyStkCallback`.
4. `applyStkCallback()` idempotency: `updateMany({ where: { id, status: PENDING }})`
   so replays match zero rows and are reported as duplicates. Always ACKs 200
   with `{ResultCode:0}` once accepted; returns 500 only on genuine internal
   errors so Daraja retries.
5. Sale settlement: linked PENDING MPESA sale → COMPLETED + stock decrement in
   one Prisma transaction; failures never fail the callback (logged instead).
6. Reconciliation sweep (`reconcile.ts` + `/api/mpesa/reconcile` cron route):
   stale PENDING rows (>2 min, <1 h) queried via STK Push Query; results applied
   through the same guarded write; >1 h rows expired to TIMEOUT. Cron secret
   required or endpoint refuses to run (503).
7. Demo mode: explicit `DEMO_MODE=true`; simulated completion is hard-blocked
   for any transaction carrying a real `checkoutRequestId`.

**Not present**: B2C/payouts, reversals/refunds, C2B validation/confirmation
URLs, transaction verification beyond STK query, provider polling workers,
webhooks, events.

## 4. Existing security controls

Present and worth preserving:
- ✅ Credential encryption at rest (AES-256-GCM envelope, `enc:v1:iv:tag:ct`,
  key outside DB via `MPESA_CREDENTIALS_KEY`, plaintext-tolerant decryption for
  legacy rows). `src/lib/mpesa/crypto.ts`
- ✅ Strict server/client secret boundary: `ResolvedMpesaConfig` (secrets,
  server-only) vs `SafeMpesaConfig` (masked view); `maskTail()` rendering;
  consumer-secret cache keys are SHA-256 digests, never raw secrets.
- ✅ Server-only module enforcement (`import "server-only"`).
- ✅ Env vars centralized, none of the secrets are `NEXT_PUBLIC_*`.
- ✅ Callback URL validation (HTTPS-only, private-range rejection) reused later
  as a base for webhook SSRF checks.
- ✅ Callback shared-secret token; cron endpoint refuses unconfigured secret.
- ✅ In-process rate limiting (per-org 30/min, per-phone 3/min) with honest
  docs that it doesn't coordinate across replicas.
- ✅ Safe error taxonomy (`DarajaError` code + userMessage vs detail).
- ✅ Production base-url override guard (`DARAJA_BASE_URL_OVERRIDE` ignored for
  production env).
- ✅ zod validation on all server-action inputs.

Gaps (must be built):
- ❌ No RBAC permission model (roles exist but are never checked — any member
  can do everything; several actions don't even check role).
- ❌ No RLS policies; isolation purely app-layer `findFirst` scoping.
- ❌ No audit log, no request/correlation IDs, no structured logging contract.
- ❌ No durable idempotency keys for client-initiated money operations.
- ❌ No API keys/auth for machine access; no CSRF strategy beyond Next's
  server-action origin checks; no secure-header hardening; no request size
  limits; no dependency auditing setup.

## 5. Existing API routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/mpesa/callback[?token=]` | POST | URL token (optional) | Daraja STK callback, idempotent apply |
| `/api/mpesa/reconcile` | GET/POST | Bearer cron secret | Stale-pending sweep |

Everything else is **server actions** (not a public API): `initiateStkPush`,
`getTransactionStatus`, `reconcileTransaction`, `simulateCallback`,
`failTransaction`, `saveMpesaConfig`, products/customers/expenses/sales/
settings CRUD. These are tightly coupled to the Next.js frontend and will not
be exposed externally; they get refactored to call the new domain services.

## 6. Existing tests

- **None.** No test runner in `package.json`, no test files, no CI config.
- Closest assets: `scripts/mock-daraja.mjs` (offline Daraja test double),
  `scripts/mpesa-doctor.mjs`, `scripts/verify-mpesa.mjs`,
  `scripts/migrate-mpesa.mjs`, `docs/DARAJA_SANDBOX_TEST.md` (manual test runbook).

## 7. KEEP / REFACTOR / REPLACE / NEW map

### KEEP (working, preserve behavior)
- `src/lib/mpesa/crypto.ts` — envelope encryption (generalize key env name)
- `src/lib/mpesa/oauth.ts` — token cache/single-flight/401-retry
- `src/lib/mpesa/callback.ts` parse layer (`parseStkCallback`, EAT parsing,
  result-code map) — becomes Daraja adapter internals
- Idempotent callback write pattern (`updateMany … status=PENDING`)
- Intent-before-network push creation; callback-always-ACKs contract
- `checkCallbackUrl` validation logic (seed for SSRF guard util)
- Phone normalization, amount bounds, error taxonomy shape
- Docker-compose Postgres, mock-daraja script, demo-mode discipline

### REFACTOR (keep behavior, change shape/boundary)
- `src/lib/mpesa/daraja.ts` → **DarajaProvider** implementing the new
  `PaymentProvider` port; response mapping stays inside the adapter
- `src/lib/mpesa/config.ts` → credential resolution moves under
  `ProviderConnection` + environment-scoped storage; safe-view concept kept
- `src/lib/mpesa/rate-limit.ts` → interface kept; backend swaps to
  Redis/Upstash with in-memory fallback
- `src/lib/mpesa/reconcile.ts` → generalized reconciliation engine (provider
  query behind port); sweep semantics preserved
- `src/app/api/mpesa/*` routes → versioned public endpoints + provider
  ingress paths; handler bodies call domain services
- `src/lib/auth.ts` `requireAppContext` → TenantContext resolution
  (explicit active tenant, permission checks); auto-provision kept for UX but
  made transactional
- `Organization`/`MemberRole` → Tenant/TenantMember + Role/Permission tables
  (data preserved, roles migrated)
- `src/app/actions/*` → thin wrappers over application services (frontend
  keeps working during transition)

### REPLACE
- Ad-hoc status writes (`completeStkPush`, `failStkPush` direct updates) →
  centralized payment state machine with transition records
- `Sale`-linked settlement inside the payment path → decouple: infrastructure
  emits events; POS/inventory consumes them (STOR1 concern)
- `receiptNo` global unique on `Sale` → scoped uniqueness in new models
- `prisma db push` workflow → proper `prisma migrate` baseline

### NEW (does not exist at all)
Tenant/Application/Environment hierarchy · RBAC permissions · API keys
(pk/sk/whsec) · IdempotencyRecord · Payment domain + state machine +
PaymentAttempt · double-entry Ledger (Account/JournalTransaction/LedgerEntry,
append-only) · Allocation engine (versioned rules, deterministic rounding) ·
Settlement · Payouts · Refunds · ReconciliationRun/Item/Exception · Event store
+ transactional outbox · WebhookEndpoint/Delivery + HMAC signing + retries +
SSRF guard · AuditLog · UsageRecord · `/v1` REST API with cursor pagination +
structured errors · background workers · sandbox simulation provider · test
suite (none exists) · observability (correlation IDs, health checks) ·
documentation set (ARCHITECTURE.md, SECURITY.md, API.md, LEDGER.md, PAYMENTS.md,
RECONCILIATION.md, WEBHOOKS.md, DEVELOPMENT.md)

## 8. Proposed target architecture

```
API Layer            /v1 REST (Next.js route handlers) + provider ingress
                     (/callbacks/daraja, /webhooks outbound)
    ↓
AuthN/AuthZ          API-key auth (machine) · Supabase JWT session (human)
                     → TenantContext {tenantId, applicationId, environment,
                       actor, permissions[]}
    ↓
Application Services use-cases: CreatePayment, ApplyCallback, CreatePayout…
                     enforce idempotency + authorization + rate limits
    ↓
Domain Services      payments (state machine) · ledger · allocations ·
                     settlements · refunds · reconciliation · events/outbox
    ↓
Ports                PaymentProvider · SecretBox · RateLimiter · Clock
    ↓
Adapters             DarajaProvider (refactored daraja.ts/oauth.ts)
                     SandboxProvider (deterministic simulator)
                     RedisRateLimiter (in-memory fallback)
    ↓
PostgreSQL (Prisma)  authoritative store; outbox table = delivery source of truth
Workers              outbox dispatcher · webhook deliverer (backoff) ·
                     reconciler · pending-payment poller · usage aggregator
```

Key decisions already implied by this repo:
- Keep Next.js as the runtime (route handlers + `instrumentation`/cron routes);
  workers start as scheduled endpoints + a node script entrypoint, extractable
  later without touching domain code.
- Environment is a first-class column on every financial row
  (`environment: SANDBOX | LIVE`); sandbox resolves to `SandboxProvider` by
  construction — a sandbox payment can never reach Daraja live URLs.
- Money = **integer minor units** (`amountMinor BigInt`) in the new core;
  KES only initially, currency string everywhere. Existing Decimal tables stay
  untouched (POS data), converted at the boundary when/if imported.
- Ledger: append-only journal; DB trigger blocking UPDATE/DELETE on
  `LedgerEntry`; balances always derived (materialized view / sum query).
- Events: written in the same DB transaction as state changes (outbox);
  webhooks are consumers of events, never the same mechanism.

## 9. Proposed database migration strategy

1. **Baseline first**: switch from `db push` to `prisma migrate` with
   `migrate diff --from-schema-datasource --to-schema-datamodel` to generate an
   initial migration matching the current DB (no destructive DDL), committed as
   `migrations/0_init` + `baseline` resolution for existing databases.
2. **Additive phases only** (each its own migration + commit):
   - P1: `Tenant`, `Application`, `Environment`, `Role/Permission`,
     `TenantMember`; backfill one Tenant per existing Organization (STOR1 =
     chosen org), `Application` default per tenant, copy memberships/roles.
     `Organization` retained (FK'd to `Tenant` 1:1) so POS features keep
     working unchanged during transition.
   - P2+: ApiKey, IdempotencyRecord, Account/Ledger*, AllocationRule*,
     Payment/PaymentAttempt/PaymentProviderReference, Payout, Refund,
     ReconciliationRun/Item, Event(outbox), WebhookEndpoint/Delivery,
     AuditLog, UsageRecord, ProviderConnection (migrating `MpesaConfig`
     values into it; `MpesaConfig` kept read-compat until cutover).
3. **Data preservation rules**: no drops of financial tables in v1 migrations;
  `MpesaTransaction` rows are historical financial records — they will be
  referenced (optional FK) from the new Payment model via a legacy-reference
  field rather than rewritten. Any backfill runs in the same migration as the
  column addition, wrapped in explicit transactions, with rollback notes.
4. Every migration reviewed for: lock impact, index creation method
   (`CREATE INDEX CONCURRENTLY` where relevant), and reversible down-path.

## 10. Risks and breaking changes

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | No migrations history; `db push` could drift from `init.sql` | Baseline migration immediately; freeze `init.sql` |
| 2 | `requireAppContext` picks *first* membership — ambiguous multi-tenancy | New context requires explicit tenant selection w/ cookie/header; document break |
| 3 | Roles never enforced today; introducing checks may block existing UI flows | Map OWNER→all perms, ADMIN→most, STAFF→read+payments:create so current behavior ≈ preserved |
| 4 | `Sale.receiptNo` globally unique collides across tenants long-term | Scope uniqueness in new models; don't touch existing table |
| 5 | Secrets encrypted with optional key; plaintext tolerated | Keep tolerance, surface encryptionEnabled warnings; add rotation support in new SecretBox |
| 6 | In-memory rate limiter breaks under horizontal scale silently | Port interface now; Redis adapter behind feature flag; 429 contract defined |
| 7 | Callback route is publicly known path; token optional | Keep backward compat; add per-connection tokens in ProviderConnection |
| 8 | JS-number money at action boundaries | New core accepts integer minor units only; adapters convert; old actions shim |
| 9 | No tests exist → refactor safety net missing | Write characterization tests around mpesa lib BEFORE Phase 5 refactor (mock-daraja enables integration harness early) |
| 10 | Single Prisma schema growing large | Split into multi-file schema (Prisma 7 supports `schema_folder`) by domain |
| 11 | Regulatory boundary: ledger accounts ≠ custody | Document explicitly in LEDGER.md; no wallet-withdrawal semantics until legal review |
| 12 | Demo-mode coupling in business logic (`isDemoMode()` scattered) | Replace with environment-aware provider resolution; DEMO_MODE maps to SANDBOX env |

---

## Recommended implementation order (matches spec §59, adjusted for findings)

- **Phase 1** Tenancy: Tenant/Application/Environment + TenantContext + baseline migration ← *next*
- **Phase 2** AuthN/Z: permissions, API keys, TenantContext middleware for /v1
- **Phase 2.5** *(added)* Characterization tests around existing mpesa flow
- **Phases 3–16** as specified (ledger → payments → provider port → daraja →
  callbacks/recon → allocations → payouts → refunds → events/outbox → webhooks
  → sandbox → audit/observability → usage → API stabilization)
