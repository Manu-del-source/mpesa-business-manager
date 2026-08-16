/**
 * Local verification harness for the M-Pesa integration.
 *
 * Exercises the callback parser/applier, idempotency, encryption round-trip
 * and phone normalization against a REAL database — but only ever creates its
 * own throwaway rows and deletes exactly those at the end. It never touches
 * pre-existing organizations, sales or transactions.
 *
 * Usage:
 *   DATABASE_URL=... node --import tsx --conditions=react-server \
 *     scripts/verify-mpesa.mjs
 *
 * (`--conditions=react-server` satisfies the `server-only` import guard that
 * protects the credential modules; `--import tsx` allows importing .ts files.)
 *
 * NOTE: this is a developer smoke test, not a substitute for testing against
 * the real Safaricom Daraja sandbox.
 */
const { PrismaClient } = await import("../src/generated/prisma/client.ts");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { parseStkCallback, applyStkCallback, statusForResultCode } = await import(
  "../src/lib/mpesa/callback.ts"
);
const { normalizePhone } = await import("../src/lib/mpesa/index.ts");
const { encryptSecret, decryptSecret } = await import("../src/lib/mpesa/crypto.ts");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

let pass = 0;
let fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${extra}`);
  }
};

const createdTxnIds = [];
let createdOrgId = null;

try {
  // -------------------------------------------------------------------------
  console.log("\n1. Phone normalization");
  check("0712345678 -> 254712345678", normalizePhone("0712345678") === "254712345678");
  check("+254712345678 -> 254712345678", normalizePhone("+254712345678") === "254712345678");
  check("0110000000 (Airtel-range 01x) accepted", normalizePhone("0110000000") === "254110000000");
  check("spaces tolerated", normalizePhone("0712 345 678") === "254712345678");
  check("garbage rejected", normalizePhone("12345") === null);

  // -------------------------------------------------------------------------
  console.log("\n2. Secret encryption round-trip");
  const originalKey = process.env.MPESA_CREDENTIALS_KEY;
  // crypto.ts reads env lazily via lib/env, which snapshots at import time,
  // so only assert the pass-through behaviour actually configured here.
  const secret = "super-secret-passkey-value";
  const stored = encryptSecret(secret);
  check("decrypt(encrypt(x)) === x", decryptSecret(stored) === secret);
  check(
    originalKey ? "value is ciphertext when key set" : "value stored verbatim without key",
    originalKey ? stored.startsWith("enc:v1:") : stored === secret,
  );
  check("plaintext legacy value still readable", decryptSecret("legacy-plain") === "legacy-plain");

  // -------------------------------------------------------------------------
  console.log("\n3. Callback structural validation");
  check("rejects non-object", parseStkCallback("nope").ok === false);
  check("rejects missing Body", parseStkCallback({}).ok === false);
  check("rejects missing stkCallback", parseStkCallback({ Body: {} }).ok === false);
  check(
    "rejects missing CheckoutRequestID",
    parseStkCallback({ Body: { stkCallback: { ResultCode: 0 } } }).ok === false,
  );
  check(
    "rejects missing ResultCode",
    parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "ws_CO_1" } } }).ok === false,
  );

  const successBody = {
    Body: {
      stkCallback: {
        MerchantRequestID: "29115-34620561-1",
        CheckoutRequestID: "ws_CO_VERIFY_SUCCESS_1",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 1500 },
            { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
            { Name: "TransactionDate", Value: 20191219102115 },
            { Name: "PhoneNumber", Value: 254708374149 },
          ],
        },
      },
    },
  };
  const parsedSuccess = parseStkCallback(successBody);
  check("parses a valid success callback", parsedSuccess.ok === true);
  check("extracts receipt", parsedSuccess.ok && parsedSuccess.data.receiptNumber === "NLJ7RT61SV");
  check("extracts amount", parsedSuccess.ok && parsedSuccess.data.amount === 1500);
  check(
    "parses EAT timestamp to UTC",
    parsedSuccess.ok &&
      parsedSuccess.data.transactionDate?.toISOString() === "2019-12-19T07:21:15.000Z",
    parsedSuccess.ok ? parsedSuccess.data.transactionDate?.toISOString() : "",
  );

  console.log("\n4. Result-code mapping");
  check("0 -> SUCCESS", statusForResultCode(0) === "SUCCESS");
  check("1032 -> CANCELLED", statusForResultCode(1032) === "CANCELLED");
  check("1037 -> TIMEOUT", statusForResultCode(1037) === "TIMEOUT");
  check("1 (insufficient funds) -> FAILED", statusForResultCode(1) === "FAILED");

  // -------------------------------------------------------------------------
  console.log("\n5. Callback application against the database");

  const org = await prisma.organization.create({
    data: {
      name: "__verify_mpesa_temp__",
      slug: `verify-mpesa-${Date.now()}`,
      businessType: "Retail",
    },
  });
  createdOrgId = org.id;

  const mkTxn = async (checkoutRequestId) => {
    const t = await prisma.mpesaTransaction.create({
      data: {
        organizationId: org.id,
        phone: "254708374149",
        amount: "1500.00",
        status: "PENDING",
        transactionType: "STK_PUSH",
        checkoutRequestId,
      },
    });
    createdTxnIds.push(t.id);
    return t;
  };

  // 5a. Successful callback.
  const txnOk = await mkTxn("ws_CO_VERIFY_SUCCESS_1");
  const applied = await applyStkCallback(parsedSuccess.data);
  check("success callback applied", applied.outcome === "applied", JSON.stringify(applied));
  const afterOk = await prisma.mpesaTransaction.findUnique({ where: { id: txnOk.id } });
  check("status is SUCCESS", afterOk.status === "SUCCESS");
  check("receipt stored", afterOk.receiptNo === "NLJ7RT61SV");
  check("resultCode stored", afterOk.resultCode === 0);
  check("resultDesc stored", Boolean(afterOk.resultDesc));
  check("completedAt set", afterOk.completedAt instanceof Date);

  // 5b. Duplicate callback must not re-process.
  const replay = await applyStkCallback(parsedSuccess.data);
  check("duplicate callback ignored", replay.outcome === "duplicate", JSON.stringify(replay));

  // 5c. Cancelled by user (1032).
  const txnCancel = await mkTxn("ws_CO_VERIFY_CANCEL_1");
  const cancelParsed = parseStkCallback({
    Body: {
      stkCallback: {
        MerchantRequestID: "29115-34620561-2",
        CheckoutRequestID: "ws_CO_VERIFY_CANCEL_1",
        ResultCode: 1032,
        ResultDesc: "Request cancelled by user",
      },
    },
  });
  await applyStkCallback(cancelParsed.data);
  const afterCancel = await prisma.mpesaTransaction.findUnique({ where: { id: txnCancel.id } });
  check("cancelled callback -> CANCELLED", afterCancel.status === "CANCELLED");
  check("no receipt on cancellation", afterCancel.receiptNo === null);
  check("resultCode 1032 stored", afterCancel.resultCode === 1032);

  // 5d. Timeout (1037).
  const txnTimeout = await mkTxn("ws_CO_VERIFY_TIMEOUT_1");
  const timeoutParsed = parseStkCallback({
    Body: {
      stkCallback: {
        CheckoutRequestID: "ws_CO_VERIFY_TIMEOUT_1",
        ResultCode: 1037,
        ResultDesc: "DS timeout user cannot be reached",
      },
    },
  });
  await applyStkCallback(timeoutParsed.data);
  const afterTimeout = await prisma.mpesaTransaction.findUnique({ where: { id: txnTimeout.id } });
  check("timeout callback -> TIMEOUT", afterTimeout.status === "TIMEOUT");

  // 5e. Unknown checkout id.
  const unknown = await applyStkCallback({
    merchantRequestId: "x",
    checkoutRequestId: "ws_CO_DOES_NOT_EXIST",
    resultCode: 0,
    resultDesc: "ok",
    amount: 1,
    receiptNumber: "X1",
    phone: "254708374149",
    transactionDate: new Date(),
  });
  check("unknown transaction reported", unknown.outcome === "unknown_transaction");

  // -------------------------------------------------------------------------
  console.log("\n6. Existing data preserved");
  const demoOrg = await prisma.organization.findUnique({
    where: { slug: "kijani-fresh-foods" },
  });
  if (demoOrg) {
    const count = await prisma.mpesaTransaction.count({
      where: { organizationId: demoOrg.id },
    });
    check(`seeded demo transactions still present (${count})`, count > 0);
    const legacy = await prisma.mpesaTransaction.findFirst({
      where: { organizationId: demoOrg.id, status: "SUCCESS" },
    });
    check("legacy rows readable with new columns", legacy !== null && legacy.resultCode === null);
  } else {
    console.log("  (no seeded demo org in this database — skipped)");
  }
} finally {
  // Clean up ONLY what this script created.
  if (createdTxnIds.length) {
    await prisma.mpesaTransaction.deleteMany({ where: { id: { in: createdTxnIds } } });
  }
  if (createdOrgId) {
    await prisma.mpesaConfig.deleteMany({ where: { organizationId: createdOrgId } });
    await prisma.organization.delete({ where: { id: createdOrgId } }).catch(() => {});
  }
  await prisma.$disconnect();
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
