# M-Pesa Business Manager → Financial Infrastructure Platform

## Architecture Audit & Transformation Plan

**Date:** 2026-08-26
**Branch:** `feat/infrastructure-architecture`
**Baseline:** Existing `mpesa-business-manager` repository

---

## 1. Current Architecture Summary

### 1.1 Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Next.js 16 (App Router, React 19) | Server Actions as de facto API |
| Language | TypeScript (strict) | No emit, bundler resolution |
| Database | PostgreSQL 16 via Prisma 7 | `@prisma/adapter-pg` (PrismaPg) |
| Auth | Supabase Auth (`@supabase/ssr`) | Cookie-based sessions; demo mode bypass |
| UI | Tailwind 4, Radix UI, Recharts | Frontend attached later |
| Validation | Zod | All server-action inputs validated |
| Money | `Decimal(12,2)` columns | JS `number` at action boundaries |

### 1.2 Project Structure

```
src/
├── app/
│   ├── (auth)/              # Sign-in, sign-up, password reset
│   │   └── actions.ts       # Auth server actions
│   ├── (app)/               # Protected app routes
│   │   ├── dashboard/
│   │   ├── sales/
│   │   ├── mpesa/
│   │   ├── customers/
│   │   ├── inventory/
│   │   ├── expenses/
│   │   ├── reports/
│   │   └── settings/
│   ├── api/
│   │   └── mpesa/
│   │       ├── callback/route.ts   # Daraja STK callback (POST)
│   │       └── reconcile/route.ts  # Scheduled reconciliation (GET/POST)
│   └── actions/             # Server actions (M-Pesa, sales, products, etc.)
├── lib/
│   ├── mpesa/               # Core M-Pesa/Daraja integration (10 files)
│   │   ├── index.ts         # Public STK API, phone normalization
│   │   ├── daraja.ts        # STK Push, STK Query, OAuth
│   │   ├── callback.ts      # Callback parsing, idempotent application
│   │   ├── config.ts        # Credentials, encryption, callback URL validation
│   │   ├── reconcile.ts     # Stale transaction sweep
│   │   ├── rate-limit.ts    # In-process STK rate limiting
│   │   ├── crypto.ts        # AES-256-GCM envelope encryption
│   │   ├── errors.ts        # Typed Daraja errors
│   │   ├── log.ts           # Credential-safe logging
│   │   └── oauth.ts         # Token cache, single-flight, 401 retry
│   ├── supabase/            # Supabase client (server, client, middleware)
│   ├── auth.ts              # Session, org context, demo mode
│   ├── prisma.ts            # Prisma client singleton
│   ├── sales.ts             # Sale creation, M-Pesa completion
│   ├── stats.ts             # Dashboard aggregations
│   ├── validations.ts       # Zod schemas
│   ├── env.ts               # Typed env access
│   ├── format.ts            # KES formatting, date formatting
│   └── utils.ts             # General utilities
├── components/              # UI components (auth, dashboard, mpesa, etc.)
└── generated/prisma/        # Prisma client (gitignored)
```

### 1.3 Data Model (Current Prisma Schema)

**Infrastructure Core (New, partially in schema):**
| Model | Purpose | Status |
|-------|---------|--------|
| `Tenant` | Platform tenant (e.g., STOR1) | Schema exists, no code uses it |
| `TenantMember` | User membership in tenant | Schema exists, no code uses it |
| `Application` | Tenant's applications | Schema exists, no code uses it |
| `Permission` | Explicit permission grants | Schema exists, no code uses it |
| `Role` | Role with permissions | Schema exists, no code uses it |
| `ApiKey` | API keys (pk/sk/whsec) | Schema exists, no code uses it |
| `ProviderConnection` | Provider credentials per app+env | Schema exists, no code uses it |

**Legacy POS Layer (Working):**
| Model | Purpose | Notes |
|-------|---------|-------|
| `Organization` | Tenant root | `slug` unique, `tier FREE/PRO`, FK to `Tenant` |
| `OrganizationMember` | Membership | `role OWNER/ADMIN/STAFF`; Supabase auth user id |
| `Product` | Inventory | Decimal(12,2) prices, stock int |
| `Customer` | POS customers | org-scoped, phone index |
| `Sale` / `SaleItem` | POS receipts | `receiptNo` globally unique |
| `MpesaTransaction` | STK Push records | PENDING→SUCCESS/FAILED/CANCELLED/TIMEOUT; unique `checkoutRequestId` |
| `MpesaConfig` | Per-org Daraja creds | `consumerSecret`/`passkey` AES-256-GCM encrypted |
| `Expense` | Business expenses | STOR1-specific business logic |

---

## 2. Existing M-Pesa Flow (Working End-to-End)

### 2.1 STK Push Initiation

```
User → initiateStkPushAction (server action)
  → requireAppContext() → resolve org + role
  → validate input (Zod: stkPushSchema)
  → initiateStkPush() [src/lib/mpesa/index.ts]
    → normalizePhone() → validate amount
    → resolveMpesaConfig(orgId) → DB row → legacy env vars → null
    → isDemoMode() || !isLive(config)?
      → YES: create MpesaTransaction as PENDING, return demo mode
      → NO: 
        → checkStkPushRateLimit(orgId, phone)
        → sendDarajaStkPush(config, input)
          → checkCallbackUrl() → HTTPS + public host check
          → darajaTimestamp() → stkPassword() (base64)
          → getAccessToken(config) → cached, single-flight, 401 retry
          → POST /mpesa/stkpush/v1/processrequest
          → store merchantRequestId + checkoutRequestId
          → Transaction stays PENDING
```

### 2.2 Callback Processing

```
Safaricom POST → /api/mpesa/callback?token=...
  → validate MPESA_CALLBACK_TOKEN
  → parse JSON → parseStkCallback() (strict structural validation)
  → applyStkCallback()
    → find by checkoutRequestId
    → updateMany({ where: { status: "PENDING" } }) ← IDEMPOTENT
    → map ResultCode → MpesaStatus
    → SUCCESS: settleLinkedSale() → stock decrement
    → Always return HTTP 200 + {ResultCode: 0}
```

### 2.3 Reconciliation Sweep

```
Cron → /api/mpesa/reconcile (Bearer MPESA_CRON_SECRET)
  → find PENDING with checkoutRequestId, age > 2min
  → queryStkStatus() → Daraja STK Push Query
  → same idempotent write as callback
  → >1 hour rows → expire to TIMEOUT
```

### 2.4 Key Security Controls

| Control | Status | Implementation |
|---------|--------|----------------|
| Credential encryption at rest | ✅ | AES-256-GCM envelope (`enc:v1:iv:tag:ct`) |
| Callback authentication | ✅ | Shared secret token in URL |
| Callback URL validation | ✅ | HTTPS, public host, correct path |
| Rate limiting | ⚠️ | In-process only (30/min/org, 3/min/phone) |
| Idempotent callbacks | ✅ | `updateMany` with `status: PENDING` guard |
| Server-only modules | ✅ | `import "server-only"` on all secret modules |
| No secrets in client | ✅ | `SafeMpesaConfig` masked view |
| Secret redaction in logs | ✅ | `maskTail()`, phone masking |
| Demo mode guard | ✅ | Live transactions cannot be completed via UI |
| zod validation | ✅ | All server-action inputs |

---

## 3. Existing Security Gaps

| Gap | Severity | Impact |
|-----|----------|--------|
| No RBAC permission model | HIGH | Roles exist but are never checked; any member can do everything |
| No API key authentication | HIGH | No machine-to-machine auth; no `/v1` API |
| No idempotency keys for client requests | HIGH | Duplicate STK pushes possible |
| No audit logging | HIGH | No trace of who did what |
| No request/correlation IDs | MEDIUM | No request tracing |
| In-process rate limiting only | MEDIUM | Breaks under horizontal scale |
| No CSRF beyond Next.js defaults | MEDIUM | Server actions have origin checks |
| No dependency auditing | LOW | No automated vulnerability scanning |
| No test suite | HIGH | No safety net for refactoring |
| No middleware.ts file | MEDIUM | Auth session refresh relies on component-level calls |

---

## 4. KEEP / REFACTOR / REPLACE / NEW Map

### KEEP (Production-ready, aligns with target architecture)

| Component | File/Location | Why |
|-----------|--------------|-----|
| AES-256-GCM encryption | `src/lib/mpesa/crypto.ts` | Solid envelope encryption, backward compatible |
| OAuth token cache | `src/lib/mpesa/oauth.ts` | Single-flight, 401 retry, SHA-256 cache keys |
| Callback parsing | `src/lib/mpesa/callback.ts` (parseStkCallback) | Strict structural validation, EAT timestamp parsing |
| Idempotent callback write | `src/lib/mpesa/callback.ts` (applyStkCallback) | `updateMany` with `status: PENDING` guard |
| STK Push + STK Query | `src/lib/mpesa/daraja.ts` | Clean Daraja integration with retry logic |
| Credential resolution | `src/lib/mpesa/config.ts` | DB → env var fallback, safe/secret type split |
| Callback URL validation | `src/lib/mpesa/config.ts` (checkCallbackUrl) | HTTPS, private-range rejection |
| Error taxonomy | `src/lib/mpesa/errors.ts` | Typed codes + safe user messages |
| Safe logging | `src/lib/mpesa/log.ts` | Credential redaction |
| Callback route | `src/app/api/mpesa/callback/route.ts` | Correct Daraja contract (always 200) |
| Reconcile route | `src/app/api/mpesa/reconcile/route.ts` | Authenticated, safe sweep |
| Phone normalization | `src/lib/mpesa/index.ts` (normalizePhone) | Correct Kenyan MSISDN handling |
| Intent-before-network | `src/lib/mpesa/index.ts` | Create PENDING before Daraja call |
| Prisma client singleton | `src/lib/prisma.ts` | PG adapter, global singleton |
| Typed env access | `src/lib/env.ts` | No `NEXT_PUBLIC_` for secrets |
| Docker Compose Postgres | `docker-compose.yml` | Local dev database |
| Mock Daraja server | `scripts/mock-daraja.mjs` | Test double for offline testing |
| Verification harness | `scripts/verify-mpesa.mjs` | Database-backed integration checks |
| Doctor script | `scripts/mpesa-doctor.mjs` | Pre-flight config validation |

### REFACTOR (Works, needs architectural changes)

| Component | File | Required Changes |
|-----------|------|------------------|
| Rate limiter | `src/lib/mpesa/rate-limit.ts` | Swap to Redis/Upstash; keep interface |
| Auth context | `src/lib/auth.ts` | Migrate from Organization → Tenant/Application/Environment |
| Daraja adapter | `src/lib/mpesa/daraja.ts` | Implement `PaymentProvider` port |
| Config resolution | `src/lib/mpesa/config.ts` | Move to `ProviderConnection` + environment-scoped storage |
| Reconciliation engine | `src/lib/mpesa/reconcile.ts` | Generalize; provider query behind port |
| Callback route | `src/app/api/mpesa/callback/route.ts` | Add provider ingress path |
| STK push flow | `src/lib/mpesa/index.ts` | Wrap in payment state machine + idempotency |
| Server actions | `src/app/actions/*.ts` | Thin wrappers over application services |
| Sales library | `src/lib/sales.ts` | Decouple POS from financial payment domain |
| Stats library | `src/lib/stats.ts` | Separate business analytics from financial reporting |

### REPLACE (Fundamentally incompatible with target)

| Component | Replacement |
|-----------|-------------|
| Direct Daraja calls in payment flow | Provider Abstraction (`PaymentProvider` interface) |
| Ad-hoc status writes | Centralized payment state machine with transition records |
| `Sale`-linked settlement | Decouple: infrastructure emits events; POS consumes |
| `receiptNo` global unique | Scoped uniqueness in new models |
| `prisma db push` workflow | Proper `prisma migrate` baseline |
| `MpesaTransaction` model | Provider-agnostic `Payment` + `PaymentAttempt` + `PaymentProviderReference` |
| Demo mode in `initiateStkPush` | Explicit `SandboxProvider` implementation |
| `MpesaConfig` per-org credentials | `ProviderConnection` per Application |

### NEW (Does not exist, must be built)

| Domain | Models/Components |
|--------|-------------------|
| Tenancy hierarchy | `Tenant`, `TenantMember`, `Application`, `Environment` (schema exists, code doesn't) |
| RBAC | `Permission`, `Role` (schema exists, enforcement doesn't) |
| API Keys | `ApiKey` with `pk_*`/`sk_*`/`whsec_*` (schema exists, flow doesn't) |
| Financial Accounts | `Account` (chart of accounts) |
| Double-entry Ledger | `JournalTransaction`, `LedgerEntry` (append-only) |
| Payment Domain | `Payment`, `PaymentAttempt`, `PaymentProviderReference` |
| Payment State Machine | Centralized transition rules with audit trail |
| Idempotency | `IdempotencyRecord` (durable, DB-backed) |
| Allocation Engine | `AllocationRule`, `AllocationRuleVersion`, `Allocation` |
| Settlement | `Settlement`, eligibility engine |
| Payouts | `Payout` with state machine |
| Refunds | `Refund` with validation + ledger posting |
| Reconciliation | `ReconciliationRun`, `ReconciliationItem`, `ReconciliationException` |
| Events/Outbox | `Event`, `OutboxRecord` (transactional outbox) |
| Webhooks | `WebhookEndpoint`, `WebhookDelivery` + HMAC signing + retries |
| Audit | `AuditLog` (append-only) |
| Usage/Billing | `UsageRecord` |
| Provider Abstraction | `PaymentProvider` interface + capability detection |
| Sandbox | `SandboxProvider` implementing same interface |
| `/v1` REST API | Versioned, cursor-paginated, structured errors |
| Test Suite | Unit + integration + security tests (none exist) |
| Observability | Correlation IDs, health checks, structured logging |
| Documentation | ARCHITECTURE.md, SECURITY.md, API.md, LEDGER.md, etc. |

---

## 5. Proposed Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Layer (/v1 REST)                          │
│         Next.js Route Handlers + Provider Ingress               │
│    POST /v1/payments  GET /v1/payments/:id  POST /v1/payouts   │
│    POST /callbacks/daraja  POST /webhooks/outbound              │
├─────────────────────────────────────────────────────────────────┤
│              Middleware Pipeline                                 │
│  API-Key Auth │ Supabase JWT │ Tenant Resolution │ Rate Limit   │
│  Idempotency  │ Input Validation │ Audit Logger                 │
├─────────────────────────────────────────────────────────────────┤
│              TenantContext                                      │
│  { tenantId, applicationId, environment, actor, permissions[] } │
├─────────────────────────────────────────────────────────────────┤
│              Application Services                               │
│  CreatePayment │ ApplyCallback │ CreatePayout │ RefundPayment   │
│  Reconcile │ ManageWebhooks │ ManageApiKeys │ AuditLog          │
├─────────────────────────────────────────────────────────────────┤
│              Domain Services                                    │
│  Payment State Machine │ Allocation Engine │ Settlement Engine  │
│  Ledger Posting │ Reconciliation Engine │ Event Dispatcher      │
├─────────────────────────────────────────────────────────────────┤
│              Ports (Interfaces)                                 │
│  PaymentProvider │ SecretBox │ RateLimiter │ IdempotencyStore   │
├─────────────────────────────────────────────────────────────────┤
│              Adapters (Implementations)                         │
│  DarajaProvider │ SandboxProvider │ RedisRateLimiter            │
│  DatabaseIdempotencyStore │ DatabaseSecretBox                   │
├─────────────────────────────────────────────────────────────────┤
│              PostgreSQL (Prisma)                                 │
│  RLS policies + application-layer isolation                     │
│  Outbox table = event delivery source of truth                  │
├─────────────────────────────────────────────────────────────────┤
│              Workers (Background)                                │
│  Outbox Dispatcher │ Webhook Deliverer │ Reconciler             │
│  Pending Payment Poller │ Usage Aggregator                      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.1 Multi-Tenant Data Model (Target)

```
Tenant (STOR1)
  ├── TenantMember[] (users + roles)
  └── Application (STOR1 Web)
        ├── Environment: SANDBOX
        │     ├── ApiKey[] (pk_test_*, sk_test_*)
        │     ├── ProviderConnection (Daraja sandbox)
        │     ├── Payment[]
        │     ├── Account[]
        │     ├── JournalTransaction[] → LedgerEntry[]
        │     ├── AllocationRule[]
        │     ├── Payout[]
        │     ├── Refund[]
        │     ├── WebhookEndpoint[] → WebhookDelivery[]
        │     ├── Event[]
        │     └── AuditLog[]
        └── Environment: LIVE
              ├── ApiKey[] (pk_live_*, sk_live_*)
              ├── ProviderConnection (Daraja production)
              └── ... same resources, isolated data
```

---

## 6. Database Migration Strategy

### 6.1 Phase 0: Baseline (Immediate)

- Switch from `prisma db push` to `prisma migrate`
- Generate initial migration matching current schema
- Freeze `prisma/init.sql` (it's already behind the schema)

### 6.2 Phase 1: Tenancy + Auth

**Additive only — no destructive changes.**

New tables (schema exists, code doesn't):
- `Tenant` — one per existing Organization during backfill
- `TenantMember` — copy from `OrganizationMember`
- `Application` — default per tenant
- `ApiKey` — pk/sk/whsec
- `ProviderConnection` — replaces `MpesaConfig` per app

Modifications:
- `Organization` gains `tenantId` FK (already in schema)
- Backfill: 1 Tenant per Organization, 1 Application per Tenant

### 6.3 Phase 2: Financial Core

New tables:
- `Account` (chart of accounts)
- `JournalTransaction` + `LedgerEntry` (double-entry, append-only)
- `Payment` + `PaymentAttempt` + `PaymentProviderReference`
- `IdempotencyRecord`

### 6.4 Phase 3: Allocation + Payout + Refund

New tables:
- `AllocationRule` + `AllocationRuleVersion` + `Allocation`
- `Settlement`
- `Payout`
- `Refund`

### 6.5 Phase 4: Events + Webhooks + Audit

New tables:
- `Event` + `OutboxRecord`
- `WebhookEndpoint` + `WebhookDelivery`
- `AuditLog`
- `ReconciliationRun` + `ReconciliationItem` + `ReconciliationException`
- `UsageRecord`

### 6.6 Data Preservation Rules

1. **No drops** of financial tables in v1 migrations
2. `MpesaTransaction` rows are historical — referenced via legacy FK from new `Payment` model
3. Backfill runs in same migration as column addition
4. Every migration wrapped in explicit transactions
5. Rollback notes for every migration

---

## 7. Financial Invariants (Non-Negotiable)

| # | Invariant | Enforcement |
|---|-----------|-------------|
| 1 | Ledger entries must balance | Application + DB CHECK constraint |
| 2 | Historical ledger entries are immutable | DB trigger blocking UPDATE/DELETE on LedgerEntry |
| 3 | No duplicate financial postings | IdempotencyRecord + callback idempotency |
| 4 | Payout cannot execute twice | Idempotency + unique constraint |
| 5 | Refund cannot exceed refundable amount | Application validation |
| 6 | Allocation totals = original amount | Deterministic rounding + validation |
| 7 | Tenant data never crosses boundaries | RLS + application-layer checks |
| 8 | Sandbox never moves real money | Provider abstraction (SandboxProvider) |
| 9 | Provider secrets never reach clients | SafeMpesaConfig pattern + ApiKey hashing |
| 10 | API retries don't duplicate money movement | Idempotency-Key header |
| 11 | Every financial state transition traceable | State machine + AuditLog |
| 12 | Reconciliation never silently rewrites history | Exception-based approach |

---

## 8. Risks and Breaking Changes

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | No migrations history; `db push` could drift | HIGH | Baseline migration immediately |
| 2 | `requireAppContext` picks first membership | MEDIUM | New context requires explicit tenant selection |
| 3 | Roles never enforced today | MEDIUM | Map OWNER→all perms, ADMIN→most, STAFF→read+payments |
| 4 | `Sale.receiptNo` globally unique | LOW | Scope uniqueness in new models; don't touch existing |
| 5 | Secrets encrypted with optional key | LOW | Keep tolerance, add rotation support |
| 6 | In-memory rate limiter | MEDIUM | Port interface now; Redis behind feature flag |
| 7 | Callback route publicly known | LOW | Keep backward compat; add per-connection tokens |
| 8 | JS-number money at boundaries | MEDIUM | New core uses integer minor units; old actions shim |
| 9 | No tests exist | HIGH | Write characterization tests BEFORE Phase 5 refactor |
| 10 | Single Prisma schema growing large | LOW | Split into multi-file schema (Prisma 7 supports) |
| 11 | Regulatory boundary | HIGH | Document explicitly; no wallet semantics until legal review |
| 12 | Demo-mode coupling | MEDIUM | Replace with environment-aware provider resolution |

---

## 9. Recommended Implementation Sequence

| Phase | Focus | Key Deliverables |
|-------|-------|------------------|
| **0** | Repository audit | ✅ This document |
| **1** | Tenancy + Auth | Tenant/Application/Environment, TenantContext, baseline migration |
| **2** | Auth/RBAC/API Keys | Permissions, API key auth (pk/sk), TenantContext middleware |
| **2.5** | Characterization tests | Tests around existing mpesa flow BEFORE refactoring |
| **3** | Financial Accounts + Ledger | Account, JournalTransaction, LedgerEntry (append-only) |
| **4** | Payment Domain | Payment, state machine, idempotency |
| **5** | Provider Abstraction | PaymentProvider interface |
| **6** | Daraja Adapter | DarajaProvider implementing PaymentProvider |
| **7** | Callback + Verification + Reconciliation | Enhanced callback, provider verification, reconciliation engine |
| **8** | Allocation Engine | Versioned rules, deterministic rounding |
| **9** | Payouts | Payout model, state machine, provider dispatch |
| **10** | Refunds | Refund workflows, ledger posting |
| **11** | Events + Transactional Outbox | Event store, outbox pattern |
| **12** | Webhooks + Retries + Signatures | WebhookEndpoint, HMAC signing, SSRF protection |
| **13** | Sandbox | SandboxProvider (deterministic simulator) |
| **14** | Audit + Observability | AuditLog, correlation IDs, health checks |
| **15** | Usage/Billing Foundation | UsageRecord tracking |
| **16** | Public API Stabilization | `/v1` REST API with cursor pagination |

---

## 10. Immediate Next Steps

1. **Create `prisma/migrations` baseline** — switch from `db push` to `prisma migrate`
2. **Write characterization tests** for existing mpesa flow (mock-daraja enables this)
3. **Implement Phase 1** — Tenant/Application/Environment with backfill migration
4. **Build `/v1` API layer** — route handlers calling domain services
5. **Extract PaymentProvider interface** from existing `daraja.ts`
6. **Implement DarajaProvider** as first adapter

---

**End of Architecture Audit**
