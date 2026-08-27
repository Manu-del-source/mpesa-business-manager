# M-Pesa Business Manager — Security

## Authentication

### API Key Authentication

All `/v1` endpoints require authentication via API key:

```
Authorization: Bearer sk_test_xxxxx
```

**Key types:**
| Type | Prefix | Access | Use Case |
|------|--------|--------|----------|
| Public | `pk_*` | Read-only | Client-side (safe to expose) |
| Secret | `sk_*` | Full access | Server-side only |
| Webhook Secret | `whsec_*` | Webhook verification | Verifying webhook payloads |

### Key Storage

- Keys are **hashed** (SHA-256) before storage — the raw key is only shown once on creation
- The `keyPreview` field stores the last 4 chars for identification
- Keys can be scoped to specific permissions (e.g., `payments:create`, `payments:read`)
- Keys can be revoked (soft delete via `revokedAt` timestamp)
- Keys can have expiration dates (`expiresAt`)

### Supabase Auth (Legacy)

Existing users authenticate via Supabase Auth (cookie-based sessions). The `TenantContext` bridges Supabase auth to the infrastructure layer.

## Authorization

### RBAC (Role-Based Access Control)

Every user has a role within a Tenant:

| Role | Permissions |
|------|-------------|
| `OWNER` | All permissions |
| `ADMIN` | Most permissions (not tenant management) |
| `DEVELOPER` | Read + create payments, manage API keys |
| `FINANCE` | Read + create payments, view reports |
| `VIEWER` | Read-only access |

### Permission Resolution

1. User authenticates (API key or Supabase session)
2. `TenantContext` resolves: tenant → application → environment → role
3. Permissions are resolved from role + explicit permission grants
4. Each endpoint checks required permissions

## Data Isolation

### Tenant Isolation

- Every record belongs to an `Application` which belongs to a `Tenant`
- All queries filter by `applicationId` + `environment`
- No cross-tenant data access possible at the application layer

### Environment Isolation

- `SANDBOX` and `LIVE` environments are completely isolated
- API keys, payments, accounts, etc. are scoped to an environment
- Sandbox data can never interact with live provider traffic

## Cryptography

### Secret Encryption at Rest

Provider credentials (consumer secrets, passkeys) are encrypted using AES-256-GCM envelope encryption:

```
enc:v1:{iv}:{authTag}:{ciphertext}
```

- Each secret uses a random 12-byte IV
- Auth tag ensures integrity
- Encryption key derived from `MPESA_ENCRYPTION_KEY` env var

### HMAC Webhook Signing

Webhook payloads are signed with HMAC-SHA256:

```
X-Webhook-Signature: sha256={hex-encoded-signature}
```

- Signature computed over the raw request body
- Recipients verify by recomputing the signature
- Timing-safe comparison to prevent timing attacks

### API Key Hashing

API keys are stored as SHA-256 hashes. The raw key is never stored.

## Rate Limiting

| Limit | Scope | Implementation |
|-------|-------|----------------|
| 100 req/min | Per API key | In-process (upgrade to Redis) |
| 1000 req/min | Per application | In-process |
| 30 STK/min | Per organization | In-process |
| 3 STK/min | Per phone number | In-process |

**Note:** Current rate limiting is in-process only. For production with horizontal scaling, upgrade to Redis/Upstash.

## Input Validation

- All inputs validated with Zod schemas before processing
- Phone numbers normalized to Kenyan MSISDN format (254XXXXXXXXX)
- Amounts validated as positive integers (minor units)
- Idempotency keys prevent duplicate financial operations

## Audit Logging

Every significant action is recorded in the append-only `AuditLog`:

- Financial state changes (payment created, succeeded, failed)
- Permission grants/revocations
- API key creation/revocation
- Configuration changes

Audit logs are never updated or deleted.

## Correlation IDs

Every request gets a unique `x-request-id` header for distributed tracing:

- Client can provide one (for end-to-end tracing)
- Server generates one if not provided
- Included in all responses and audit log entries

## Callback Security

M-Pesa callbacks from Safaricom are secured:

- Shared secret token in callback URL
- HTTPS required (private IP ranges rejected)
- Always return HTTP 200 (even on errors) per Daraja contract
- Idempotent processing (safe to receive duplicates)

## Sensitive Data Handling

| Data | Storage | Transmission |
|------|---------|-------------|
| API secret keys | SHA-256 hash | Shown once on creation |
| Provider credentials | AES-256-GCM encrypted | Server-only modules |
| Phone numbers | Plain text (needed for Daraja) | Masked in logs |
| Amounts | BigInt minor units | Plain text |

## Known Limitations

1. **In-process rate limiting** — breaks under horizontal scale
2. **No CSRF beyond Next.js defaults** — server actions have origin checks
3. **No dependency auditing** — no automated vulnerability scanning
4. **Demo mode bypass** — exists in legacy code, disabled in new architecture
