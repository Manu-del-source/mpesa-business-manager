# M-Pesa Business Manager — Architecture

## Overview

This platform transforms an existing M-Pesa POS business manager into a multi-tenant financial infrastructure platform. It provides provider-agnostic payment processing, double-entry ledger, allocation engine, reconciliation, payouts, refunds, and webhook delivery — all behind a versioned REST API.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Next.js 16 (App Router, React 19) |
| Language | TypeScript (strict) |
| Database | PostgreSQL 16 via Prisma 7 |
| Auth | Supabase Auth (`@supabase/ssr`) |
| Validation | Zod |
| Money | `BigInt` minor units (cents) in core; `Decimal(12,2)` in legacy POS |

## Architecture Diagram

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

## Data Model (Multi-Tenant)

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
        │     ├── AuditLog[]
        │     └── UsageRecord[]
        └── Environment: LIVE
              ├── ApiKey[] (pk_live_*, sk_live_*)
              ├── ProviderConnection (Daraja production)
              └── ... same resources, isolated data
```

## Module Map

| Module | File | Purpose |
|--------|------|---------|
| Tenancy | `src/lib/tenant.ts` | Tenant resolution, context building, auto-provisioning |
| RBAC | `src/lib/rbac.ts` | Permission definitions, role mappings, DB resolution |
| API Keys | `src/lib/api-keys.ts` | Key generation, hashing, timing-safe verification |
| Middleware | `src/lib/middleware.ts` | Auth pipeline: API key → tenant → permissions |
| Ledger | `src/lib/ledger.ts` | Double-entry posting, void, balance, verify |
| Payments | `src/lib/payments.ts` | State machine, idempotency, create/transition |
| Providers | `src/lib/providers/` | PaymentProvider port + Daraja/Sandbox adapters |
| Reconciliation | `src/lib/reconciliation.ts` | Provider vs internal record comparison |
| Allocations | `src/lib/allocations.ts` | Percentage/fixed splits with rounding modes |
| Payouts | `src/lib/payouts.ts` | B2C payout state machine |
| Refunds | `src/lib/refunds.ts` | Refund validation + ledger posting |
| Events | `src/lib/events.ts` | Event store + transactional outbox |
| Webhooks | `src/lib/webhooks.ts` | HMAC signing, delivery, retries |
| Audit | `src/lib/audit.ts` | Append-only audit log |
| Usage | `src/lib/usage.ts` | API call metering |
| API Errors | `src/lib/api-errors.ts` | RFC 7807 Problem Details |
| Pagination | `src/lib/cursor-pagination.ts` | Opaque cursor-based pagination |

## Provider Architecture

```
PaymentProvider (interface)
  ├── DarajaProvider  (real Safaricom traffic)
  └── SandboxProvider (deterministic simulator)
```

## Financial Invariants

| # | Invariant | Enforcement |
|---|-----------|-------------|
| 1 | Ledger entries must balance | Application + DB CHECK |
| 2 | Historical entries are immutable | Append-only; void via reversal |
| 3 | No duplicate postings | IdempotencyRecord + unique constraints |
| 4 | Payout cannot execute twice | Idempotency + unique constraint |
| 5 | Refund ≤ refundable amount | Application validation |
| 6 | Allocation totals = original amount | Deterministic rounding |
| 7 | Tenant data isolation | Application-layer checks |
| 8 | Sandbox never moves real money | Provider abstraction |
| 9 | Provider secrets never reach clients | ApiKey hashing + SafeConfig |
| 10 | API retries don't duplicate money | Idempotency-Key header |
| 11 | State transitions traceable | State machine + AuditLog |
| 12 | Reconciliation never rewrites history | Exception-based approach |
