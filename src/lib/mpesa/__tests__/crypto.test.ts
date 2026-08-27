/**
 * Secret-at-rest encryption tests — importing the PRODUCTION
 * encryptSecret/decryptSecret from src/lib/mpesa/crypto.ts (also re-exported
 * as the generic facade src/lib/secrets.ts).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  encryptSecret,
  decryptSecret,
  encryptionEnabled,
} from "@/lib/mpesa/crypto";

const HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.MPESA_CREDENTIALS_KEY = HEX_KEY;
});
afterEach(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) process.env[k] = v;
  delete process.env.MPESA_CREDENTIALS_KEY;
});

describe("encryptSecret/decryptSecret (production AES-256-GCM envelope)", () => {
  it("round-trips a secret", () => {
    const stored = encryptSecret("consumer-secret-value");
    assert.match(stored, /^enc:v1:/);
    assert.notEqual(stored, "consumer-secret-value");
    assert.equal(decryptSecret(stored), "consumer-secret-value");
  });

  it("produces a different ciphertext every time (random IV)", () => {
    assert.notEqual(encryptSecret("same"), encryptSecret("same"));
  });

  it("fails to decrypt with the WRONG key (GCM auth)", () => {
    const stored = encryptSecret("secret");
    process.env.MPESA_CREDENTIALS_KEY = OTHER_KEY;
    assert.throws(() => decryptSecret(stored));
  });

  it("tolerates legacy plaintext rows (non-breaking key enablement)", () => {
    assert.equal(decryptSecret("plain-legacy-value"), "plain-legacy-value");
  });

  it("rejects malformed encrypted values", () => {
    assert.throws(() => decryptSecret("enc:v1:garbage"));
    assert.throws(() => decryptSecret("enc:v1:::"));
  });

  it("without a key configured, stores verbatim and reports disabled", () => {
    delete process.env.MPESA_CREDENTIALS_KEY;
    assert.equal(encryptionEnabled(), false);
    assert.equal(encryptSecret("plain"), "plain");
    assert.equal(decryptSecret("plain"), "plain");
  });

  it("encryptionEnabled() reflects key presence", () => {
    assert.equal(encryptionEnabled(), true);
    delete process.env.MPESA_CREDENTIALS_KEY;
    assert.equal(encryptionEnabled(), false);
  });

  it("accepts a base64-encoded 32-byte key too", () => {
    process.env.MPESA_CREDENTIALS_KEY = Buffer.from(HEX_KEY, "hex").toString("base64");
    const stored = encryptSecret("base64-key-secret");
    assert.equal(decryptSecret(stored), "base64-key-secret");
  });
});
