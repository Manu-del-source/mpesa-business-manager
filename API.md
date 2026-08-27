# M-Pesa Business Manager — /v1 REST API

## Authentication

All `/v1` endpoints require authentication via API key in the `Authorization` header:

```
Authorization: Bearer sk_test_xxxxx
```

**Key types:**
- `pk_*` — Public key (safe to expose, read-only)
- `sk_*` — Secret key (server-side only, full access)
- `whsec_*` — Webhook signing secret (for verifying webhook payloads)

## Environment Scoping

All resources are scoped to an environment (`SANDBOX` or `LIVE`). Pass the environment via header or query parameter:

```
X-Environment: SANDBOX
```

Default: `SANDBOX`.

## Error Responses

All errors follow [RFC 7807 Problem Details](https://datatracker.ietf.org/doc/html/rfc7807):

```json
{
  "type": "https://api.mpesa-business-manager.com/errors/bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Invalid phone number format",
  "instance": "/v1/payments",
  "errors": {
    "phone": ["Must be a valid Kenyan phone number"]
  }
}
```

**Error types:**
- `bad-request` (400) — Invalid input
- `unauthorized` (401) — Missing or invalid API key
- `forbidden` (403) — Insufficient permissions
- `not-found` (404) — Resource not found
- `conflict` (409) — Duplicate resource
- `rate-limit-exceeded` (429) — Too many requests
- `internal-error` (500) — Server error

## Pagination

All list endpoints use cursor-based pagination:

```
GET /v1/payments?limit=20&cursor=opaque_cursor
```

**Parameters:**
- `limit` — Items per page (1–100, default: 20)
- `cursor` — Opaque cursor from previous response
- `direction` — `forward` (default) or `backward`

**Response format:**
```json
{
  "data": [...],
  "meta": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

## Request/Response Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `x-request-id` | Both | Correlation ID for distributed tracing |
| `x-environment` | Request | `SANDBOX` or `LIVE` |
| `Retry-After` | Response (429) | Seconds to wait before retrying |

---

## Endpoints

### Health Check

```
GET /v1/health
```

**Auth:** None (public)

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-08-27T10:30:00.000Z",
  "checks": {
    "database": "ok"
  }
}
```

---

### Payments

#### Create Payment

```
POST /v1/payments
```

**Permission:** `payments:create`

**Request:**
```json
{
  "phone": "+254712345678",
  "amountMinor": 100000,
  "currency": "KES",
  "description": "Payment for order #123",
  "idempotencyKey": "order_123_stk",
  "reference": "order_123"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "pay_xxxxx",
    "status": "PENDING",
    "amountMinor": 100000,
    "currency": "KES",
    "phone": "+254712345678",
    "idempotencyKey": "order_123_stk",
    "createdAt": "2026-08-27T10:30:00.000Z"
  }
}
```

#### List Payments

```
GET /v1/payments
```

**Permission:** `payments:read`

**Query Parameters:**
- `status` — Filter by status (`PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `REFUNDED`)
- `since` — ISO 8601 date (inclusive)
- `until` — ISO 8601 date (inclusive)
- `limit` — Items per page (1–100)
- `cursor` — Opaque pagination cursor

#### Get Payment

```
GET /v1/payments/:id
```

**Permission:** `payments:read`

---

### Accounts

#### List Accounts

```
GET /v1/accounts
```

**Permission:** `accounts:read`

**Query Parameters:**
- `type` — Filter by account type (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`)
- `active` — Filter by active status (`true`/`false`)
- `includeBalance` — Include computed balance (`true`/`false`)

#### Create Account

```
POST /v1/accounts
```

**Permission:** `accounts:create`

**Request:**
```json
{
  "code": "1000",
  "name": "Cash on Hand",
  "type": "ASSET",
  "currency": "KES",
  "description": "Physical cash and mobile money"
}
```

---

### Journal Entries

#### Create Journal Entry

```
POST /v1/journal
```

**Permission:** `journal:create`

**Request:**
```json
{
  "description": "Payment from customer",
  "reference": "pay_xxxxx",
  "entries": [
    { "accountId": "acc_1000", "type": "DEBIT", "amountMinor": 50000 },
    { "accountId": "acc_4000", "type": "CREDIT", "amountMinor": 50000 }
  ]
}
```

**Invariant:** Sum of debits must equal sum of credits.

---

### API Keys

#### List Keys

```
GET /v1/keys
```

**Permission:** `api_keys:read`

#### Create Key

```
POST /v1/keys
```

**Permission:** `api_keys:create`

**Request:**
```json
{
  "name": "Production API Key",
  "keyType": "SECRET",
  "environment": "LIVE",
  "scopes": ["payments:create", "payments:read"]
}
```

**Response (201):**
```json
{
  "data": {
    "id": "key_xxxxx",
    "name": "Production API Key",
    "keyType": "SECRET",
    "key": "sk_live_xxxxx",  // Only shown once!
    "prefix": "sk_live",
    "keyPreview": "...abcd",
    "scopes": ["payments:create", "payments:read"],
    "createdAt": "2026-08-27T10:30:00.000Z"
  }
}
```

---

### Tenant

#### Get Current Tenant

```
GET /v1/tenant
```

**Permission:** None (any authenticated user)

**Response:**
```json
{
  "data": {
    "tenantId": "tenant_xxxxx",
    "applicationId": "app_xxxxx",
    "environment": "SANDBOX",
    "role": "OWNER",
    "permissions": ["payments:create", "payments:read", "..."]
  }
}
```

---

## State Machines

### Payment

```
PENDING → PROCESSING → SUCCEEDED → REFUNDED
           ↘ FAILED
PENDING → CANCELLED
```

### Payout

```
PENDING → PROCESSING → SUCCEEDED
           ↘ FAILED
PENDING → CANCELLED
```

### Refund

```
PENDING → PROCESSING → SUCCEEDED
           ↘ FAILED
PENDING → CANCELLED
```

## Rate Limits

| Limit | Scope |
|-------|-------|
| 100 req/min | Per API key |
| 1000 req/min | Per application |
