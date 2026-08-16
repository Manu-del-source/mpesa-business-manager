# Safaricom Daraja Sandbox — Test Guide

Everything needed for the **first real Safaricom sandbox test** of the M-Pesa
integration.

> **Status:** the integration is implemented and verified against a local mock
> of the Daraja API. It has **not** been tested against the real Safaricom
> sandbox, and it is **not** production-ready. This document is the procedure
> for performing that first real test.

---

## 1. Required environment variables

Per-business Daraja credentials (consumer key/secret, passkey, shortcode) are
**not** environment variables — they are entered in the app at
**Settings → M-Pesa settings** and stored per organization in `MpesaConfig`.

| Variable | Needed for sandbox test | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ Required | PostgreSQL connection string. |
| `NEXT_PUBLIC_APP_URL` | ✅ Required | App URL; callback base fallback. |
| `DEMO_MODE` | ✅ Must be `"false"` | `"true"` simulates and never contacts Safaricom. |
| `MPESA_CALLBACK_BASE_URL` | ✅ Required locally | Public **HTTPS** base Safaricom posts to. |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Required¹ | Auth once `DEMO_MODE=false`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Required¹ | Auth once `DEMO_MODE=false`. |
| `MPESA_CALLBACK_TOKEN` | ⬜ Recommended | Rejects spoofed callbacks. |
| `MPESA_CREDENTIALS_KEY` | ⬜ Recommended | Encrypts secrets at rest. **Required for production.** |
| `MPESA_CRON_SECRET` | ⬜ Optional | Enables `/api/mpesa/reconcile` (503 without it). |
| `DARAJA_TIMEOUT_MS` | ⬜ Optional | Daraja HTTP timeout, default `20000`. |
| `DARAJA_BASE_URL_OVERRIDE` | ⛔ **Must be unset** | Redirects sandbox traffic to a local mock. |
| `DARAJA_*` (legacy) | ⬜ Optional | Single-tenant fallback; prefer the UI. |

¹ Turning off demo mode switches auth to Supabase. Configure Supabase, or keep
a separate environment for the M-Pesa test.

**None of these are `NEXT_PUBLIC_*` secrets.** Consumer secrets and passkeys
are read server-side only. Verified by building with canary values in every
server-only variable and confirming none appear in `.next/static` or any
prerendered HTML/RSC payload.

---

## 2. The exact callback URL Safaricom must reach

The app derives it as:

```
<MPESA_CALLBACK_BASE_URL or NEXT_PUBLIC_APP_URL>/api/mpesa/callback[?token=<MPESA_CALLBACK_TOKEN>]
```

| Configuration | Resulting `CallBackURL` | Usable? |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL=http://localhost:3000` | `http://localhost:3000/api/mpesa/callback` | ❌ Safaricom cannot reach it |
| `MPESA_CALLBACK_BASE_URL=https://abc123.ngrok-free.app` | `https://abc123.ngrok-free.app/api/mpesa/callback` | ✅ |
| …plus `MPESA_CALLBACK_TOKEN=s3cr3t` | `https://abc123.ngrok-free.app/api/mpesa/callback?token=s3cr3t` | ✅ |
| `MPESA_CALLBACK_BASE_URL=https://pay.example.com/` | `https://pay.example.com/api/mpesa/callback` | ✅ (trailing slash normalised) |

Requirements enforced **before** the request reaches Daraja: HTTPS only, no
`localhost`/private/link-local host, path must be `/api/mpesa/callback`. A
violation fails fast with an actionable message rather than an opaque Daraja
rejection or a payment that never settles.

Confirm your tunnel is live:

```bash
curl https://<your-subdomain>.ngrok-free.app/api/mpesa/callback
# {"ok":true,"endpoint":"mpesa-stk-callback","method":"POST"}
```

If that doesn't return JSON from the public internet, **stop** — the STK prompt
will appear on the phone but the payment will never be confirmed.

---

## 3. Daraja sandbox setup

At [developer.safaricom.co.ke](https://developer.safaricom.co.ke):

1. Create an account and log in.
2. **My Apps → Add a new App**, tick **Lipa Na M-Pesa Sandbox** (and M-Pesa
   Sandbox), then create.
3. Open the app and copy:
   - **Consumer Key**
   - **Consumer Secret**
4. **APIs → M-Pesa Express → Simulate**, and note:
   - **Business Shortcode** — `174379` for sandbox
   - **Passkey** — the sandbox Lipa Na M-Pesa Online passkey shown there
   - **Test MSISDN** — e.g. `254708374149`

Values to enter in the app (**Settings → M-Pesa settings**):

| Field | Sandbox value |
| --- | --- |
| Environment | **Sandbox** |
| Business shortcode | `174379` |
| Consumer key | from your Daraja app |
| Consumer secret | from your Daraja app |
| Passkey | sandbox Lipa Na M-Pesa passkey |
| Callback URL | leave blank to use the derived URL, or paste your tunnel URL |
| Enable M-Pesa payments | **on** |

Then press **Test connection** — this performs a real Daraja OAuth call.

Sandbox notes: amounts are whole shillings (minimum 1); only Safaricom test
MSISDNs work; tokens last ~1 hour and are cached and refreshed automatically.

---

## 4. Pre-flight check

```bash
node --import tsx --conditions=react-server scripts/mpesa-doctor.mjs
# limit to one business:
node --import tsx --conditions=react-server scripts/mpesa-doctor.mjs --org <slug>
```

Exits non-zero on blocking problems. It never prints secret values and never
contacts Safaricom — it validates configuration only.

---

## 5. Test commands

Replace placeholders with your own values. **Never paste real credentials into
a shared terminal, a ticket, or version control.**

```bash
export CK='<your consumer key>'
export CS='<your consumer secret>'
export SHORTCODE='174379'
export PASSKEY='<your sandbox passkey>'
export PHONE='254708374149'
export CALLBACK='https://<your-subdomain>.ngrok-free.app/api/mpesa/callback'
```

### 5.1 OAuth

```bash
curl -sS -X GET \
  'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials' \
  -H "Authorization: Basic $(printf '%s:%s' "$CK" "$CS" | base64 | tr -d '\n')"
```

Expected: `{"access_token":"...","expires_in":"3599"}`
`400 / "Invalid Authentication passed"` means the key/secret is wrong or belongs
to the other environment.

```bash
export TOKEN='<access_token from above>'
```

### 5.2 STK Push

```bash
TS=$(TZ=Africa/Nairobi date +%Y%m%d%H%M%S)
PASSWORD=$(printf '%s%s%s' "$SHORTCODE" "$PASSKEY" "$TS" | base64 | tr -d '\n')

curl -sS -X POST 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{
    \"BusinessShortCode\": \"$SHORTCODE\",
    \"Password\": \"$PASSWORD\",
    \"Timestamp\": \"$TS\",
    \"TransactionType\": \"CustomerPayBillOnline\",
    \"Amount\": 1,
    \"PartyA\": \"$PHONE\",
    \"PartyB\": \"$SHORTCODE\",
    \"PhoneNumber\": \"$PHONE\",
    \"CallBackURL\": \"$CALLBACK\",
    \"AccountReference\": \"MBM-TEST\",
    \"TransactionDesc\": \"Test\"
  }"
```

Expected: `ResponseCode: "0"` plus a `CheckoutRequestID`.

> This is the raw-API equivalent of what the app sends. **The real test is
> doing it through the UI** (§6) so the whole pipeline is exercised.

### 5.3 Successful callback

Safaricom POSTs this to your `CallBackURL` after the PIN is entered. To verify
your endpoint independently of Safaricom, replay the exact shape — use a
`CheckoutRequestID` that exists in your database:

```bash
curl -sS -X POST "$CALLBACK" -H 'Content-Type: application/json' -d '{
  "Body": { "stkCallback": {
    "MerchantRequestID": "29115-34620561-1",
    "CheckoutRequestID": "<CheckoutRequestID from your DB>",
    "ResultCode": 0,
    "ResultDesc": "The service request is processed successfully.",
    "CallbackMetadata": { "Item": [
      { "Name": "Amount", "Value": 1 },
      { "Name": "MpesaReceiptNumber", "Value": "NLJ7RT61SV" },
      { "Name": "TransactionDate", "Value": 20260816143000 },
      { "Name": "PhoneNumber", "Value": 254708374149 }
    ]}}}}'
```

Expected: `{"ResultCode":0,"ResultDesc":"Processed"}`, transaction becomes
**Successful** with the receipt stored. Sending it twice returns
`"Already processed"` and changes nothing.

### 5.4 Cancelled callback

```bash
curl -sS -X POST "$CALLBACK" -H 'Content-Type: application/json' -d '{
  "Body": { "stkCallback": {
    "MerchantRequestID": "29115-34620561-2",
    "CheckoutRequestID": "<another pending CheckoutRequestID>",
    "ResultCode": 1032,
    "ResultDesc": "Request cancelled by user"
  }}}'
```

Expected: transaction becomes **Cancelled**, no receipt, and a linked POS sale
is cancelled without deducting stock.

Result codes: `0` success · `1` insufficient funds · `1032` cancelled by user ·
`1037` timeout/unreachable · `2001` wrong PIN.

### 5.5 Reconciliation

For pushes whose callback never arrived:

```bash
curl -sS -X POST 'http://localhost:3000/api/mpesa/reconcile' \
  -H "Authorization: Bearer $MPESA_CRON_SECRET"
# {"ok":true,"scanned":1,"settled":1,"stillPending":0,"expired":0,"errors":0}
```

Only touches transactions older than 2 minutes; those unanswered after 1 hour
become `TIMEOUT`. `503` means `MPESA_CRON_SECRET` is unset; `401` means the
token is wrong. In the UI, the **Check** button on a pending row does the same
for a single transaction.

---

## 6. REAL SANDBOX TEST CHECKLIST

Follow with the business owner's Daraja account.

**Prepare**
- [ ] Daraja account created; app has **Lipa Na M-Pesa Sandbox** enabled
- [ ] Consumer Key, Consumer Secret and sandbox Passkey to hand (never shared in chat/tickets)
- [ ] Shortcode `174379`; test MSISDN e.g. `254708374149`

**Configure**
- [ ] `DEMO_MODE="false"`
- [ ] `DARAJA_BASE_URL_OVERRIDE` unset
- [ ] Supabase auth configured (demo cookie auth is off now)
- [ ] Tunnel running: `ngrok http 3000`
- [ ] `MPESA_CALLBACK_BASE_URL="https://<subdomain>.ngrok-free.app"`
- [ ] *(recommended)* `MPESA_CALLBACK_TOKEN`, `MPESA_CREDENTIALS_KEY`, `MPESA_CRON_SECRET` set
- [ ] Restart the app so new env vars load

**Verify before touching Daraja**
- [ ] `scripts/mpesa-doctor.mjs` exits 0 with no ❌
- [ ] `curl https://<subdomain>.ngrok-free.app/api/mpesa/callback` returns JSON **from outside your network**

**Configure the business**
- [ ] Sign in as owner/admin → **Settings → M-Pesa settings**
- [ ] Environment **Sandbox**, shortcode `174379`, key/secret/passkey entered
- [ ] **Enable M-Pesa payments** on → **Save**
- [ ] **Test connection** succeeds (real Daraja OAuth)
- [ ] Re-open the page: secrets show as masked/blank, never in plain text

**Happy path**
- [ ] **/mpesa → Request payment**, phone `254708374149`, amount `1`
- [ ] Dialog shows *Waiting for the customer…*; row is **Pending**
- [ ] Tunnel log shows `POST /api/mpesa/callback` `200`
- [ ] Row flips to **Successful** with a Safaricom receipt
- [ ] Server log shows `[mpesa] callback.applied` — no credentials in logs

**Cancellation**
- [ ] Send another push and let it expire / decline it
- [ ] Row becomes **Cancelled** or **Timeout** with the Safaricom reason shown

**POS**
- [ ] **/sales** → new sale, payment **M-Pesa** → sale is **Pending**, stock unchanged
- [ ] Complete the payment → sale **Completed**, stock decremented once

**Resilience**
- [ ] Stop the tunnel, push again, restart the tunnel, run the reconcile call → transaction settles
- [ ] Replay a callback (§5.3) → `"Already processed"`, nothing double-counted

**Back to demo**
- [ ] Set `DEMO_MODE="true"`, restart → app works with no credentials; STK push simulated
- [ ] Seeded demo transactions still present

**Record**
- [ ] Note anything Safaricom rejected, plus `resultCode`/`resultDesc` values seen

---

## 7. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `400 Invalid Authentication passed` on OAuth | Wrong key/secret, or sandbox credentials used against production. |
| STK push rejected mentioning HTTPS | Callback URL is `http://` or localhost — set `MPESA_CALLBACK_BASE_URL`. |
| Prompt appears but stays **Pending** | Safaricom can't reach the callback. Check the tunnel; run reconcile. |
| `Invalid PhoneNumber` | Must be `2547XXXXXXXX`; only sandbox test MSISDNs work. |
| Everything stays **Simulated** | `DEMO_MODE` is still `"true"`, or M-Pesa is disabled for the business. |
| Callback returns `401` | `MPESA_CALLBACK_TOKEN` set but the URL registered with Daraja lacks `?token=`. |
| Reconcile returns `503` | `MPESA_CRON_SECRET` not set. |

---

## 8. After a successful sandbox test

Still required before production:

- [ ] Apply for **Go-Live** with Safaricom; obtain production credentials and shortcode
- [ ] `MPESA_CREDENTIALS_KEY` set so secrets are encrypted at rest
- [ ] `MPESA_CALLBACK_TOKEN` set, callback served over real HTTPS (not a tunnel), ideally restricted to Safaricom's published IP ranges
- [ ] `/api/mpesa/reconcile` scheduled every 5–15 minutes
- [ ] Replace the in-process rate limiter with a shared store (Redis) if running more than one instance
- [ ] Alerting on `[mpesa] callback.*` / `reconcile.failed` and on rising `PENDING` counts
