/**
 * Minimal mock of the Safaricom Daraja API for offline testing.
 *
 * Implements the three endpoints this app talks to, with the same response
 * shapes and error envelopes Safaricom uses:
 *   GET  /oauth/v1/generate?grant_type=client_credentials
 *   POST /mpesa/stkpush/v1/processrequest
 *   POST /mpesa/stkpushquery/v1/query
 *
 * It is a TEST DOUBLE, not a substitute for the real sandbox: it cannot prove
 * that credentials, shortcodes, passkeys or callback reachability are correct.
 *
 * Usage: node scripts/mock-daraja.mjs [port]
 */
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 4499);

const VALID_KEY = "test-consumer-key";
const VALID_SECRET = "test-consumer-secret";
const VALID_TOKEN = "mock_access_token_abc123";

/** Requests we've accepted, so the query endpoint can answer about them. */
const checkouts = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- OAuth ---------------------------------------------------------------
  if (url.pathname === "/oauth/v1/generate") {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Basic ")) {
      return json(res, 401, {
        requestId: "mock-1",
        errorCode: "401.002.01",
        errorMessage: "Invalid Authentication passed",
      });
    }
    const [key, secret] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
    if (key !== VALID_KEY || secret !== VALID_SECRET) {
      // Real Daraja answers 400 for bad client credentials.
      return json(res, 400, {
        requestId: "mock-2",
        errorCode: "400.008.01",
        errorMessage: "Invalid Authentication passed",
      });
    }
    return json(res, 200, { access_token: VALID_TOKEN, expires_in: "3599" });
  }

  const bearer = (req.headers.authorization ?? "").replace("Bearer ", "");

  // --- STK Push ------------------------------------------------------------
  if (url.pathname === "/mpesa/stkpush/v1/processrequest") {
    if (bearer !== VALID_TOKEN) {
      return json(res, 401, { errorCode: "404.001.03", errorMessage: "Invalid Access Token" });
    }
    const body = await readBody(req);
    if (!body) return json(res, 400, { errorMessage: "Bad Request - Invalid JSON" });

    for (const field of ["BusinessShortCode", "Password", "Timestamp", "Amount", "PhoneNumber", "CallBackURL"]) {
      if (body[field] === undefined || body[field] === "") {
        return json(res, 400, {
          errorCode: "400.002.02",
          errorMessage: `Bad Request - Invalid ${field}`,
        });
      }
    }
    if (!/^2547\d{8}$|^2541\d{8}$/.test(String(body.PhoneNumber))) {
      return json(res, 400, {
        errorCode: "400.002.02",
        errorMessage: "Bad Request - Invalid PhoneNumber",
      });
    }
    if (!Number.isInteger(body.Amount) || body.Amount < 1) {
      return json(res, 400, { errorCode: "400.002.02", errorMessage: "Bad Request - Invalid Amount" });
    }

    const checkoutRequestId = `ws_CO_MOCK_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
    const merchantRequestId = `29115-${Math.floor(Math.random() * 1e8)}-1`;
    checkouts.set(checkoutRequestId, { resultCode: null });

    return json(res, 200, {
      MerchantRequestID: merchantRequestId,
      CheckoutRequestID: checkoutRequestId,
      ResponseCode: "0",
      ResponseDescription: "Success. Request accepted for processing",
      CustomerMessage: "Success. Request accepted for processing",
    });
  }

  // --- STK Push Query ------------------------------------------------------
  if (url.pathname === "/mpesa/stkpushquery/v1/query") {
    if (bearer !== VALID_TOKEN) {
      return json(res, 401, { errorCode: "404.001.03", errorMessage: "Invalid Access Token" });
    }
    const body = await readBody(req);
    const entry = checkouts.get(body?.CheckoutRequestID);
    if (!entry) {
      return json(res, 500, {
        requestId: "mock-3",
        errorCode: "500.001.1001",
        errorMessage: "The transaction is being processed",
      });
    }
    if (entry.resultCode === null) {
      return json(res, 500, {
        requestId: "mock-4",
        errorCode: "500.001.1001",
        errorMessage: "The transaction is being processed",
      });
    }
    return json(res, 200, {
      ResponseCode: "0",
      ResponseDescription: "The service request has been accepted successfully",
      MerchantRequestID: "29115-1",
      CheckoutRequestID: body.CheckoutRequestID,
      ResultCode: String(entry.resultCode),
      ResultDesc: entry.resultCode === 0 ? "The service request is processed successfully." : "Request cancelled by user",
    });
  }

  // --- Test helper: settle a checkout so the query endpoint reports it ------
  if (url.pathname === "/__settle") {
    const id = url.searchParams.get("id");
    const code = Number(url.searchParams.get("code") ?? 0);
    if (checkouts.has(id)) checkouts.set(id, { resultCode: code });
    return json(res, 200, { ok: true });
  }

  json(res, 404, { errorMessage: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock Daraja listening on http://127.0.0.1:${PORT}`);
});
