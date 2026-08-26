import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function loadKey(hexOrBase64) {
  const raw = hexOrBase64.trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return null;
}

function encryptSecret(plaintext, keyHex) {
  const key = loadKey(keyHex);
  if (!key) throw new Error("Invalid key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

function decryptSecret(stored, keyHex) {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = loadKey(keyHex);
  if (!key) throw new Error("Invalid key");
  const body = stored.slice(PREFIX.length);
  const colonIdx = body.indexOf(":");
  const colonIdx2 = body.indexOf(":", colonIdx + 1);
  if (colonIdx === -1 || colonIdx2 === -1) throw new Error("Stored credential is malformed.");
  const ivB64 = body.slice(0, colonIdx);
  const tagB64 = body.slice(colonIdx + 1, colonIdx2);
  const dataB64 = body.slice(colonIdx2 + 1);
  if (!ivB64 || !tagB64) throw new Error("Stored credential is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const chunks = [];
  if (dataB64) chunks.push(decipher.update(Buffer.from(dataB64, "base64")));
  chunks.push(decipher.final());
  return Buffer.concat(chunks).toString("utf8");
}

function maskTail(value, visible = 4) {
  if (!value) return "";
  const tail = value.slice(-visible);
  return `${"•".repeat(Math.max(6, Math.min(12, value.length - visible)))}${tail}`;
}

describe("loadKey", () => {
  it("loads a 64-char hex key", () => {
    assert.ok(loadKey(TEST_KEY));
    assert.equal(loadKey(TEST_KEY).length, 32);
  });
  it("loads a base64-encoded 32-byte key", () => {
    const b64 = Buffer.from(TEST_KEY, "hex").toString("base64");
    assert.ok(loadKey(b64));
  });
  it("returns null for empty string", () => assert.equal(loadKey(""), null));
  it("returns null for wrong-length hex", () => assert.equal(loadKey("abcd"), null));
});

describe("encrypt/decrypt round-trip", () => {
  it("encrypts and decrypts back to original", () => {
    const plaintext = "my-super-secret-consumer-key-12345";
    assert.equal(decryptSecret(encryptSecret(plaintext, TEST_KEY), TEST_KEY), plaintext);
  });
  it("encrypted output starts with enc:v1:", () => {
    assert.ok(encryptSecret("test", TEST_KEY).startsWith("enc:v1:"));
  });
  it("produces different ciphertext each time (random IV)", () => {
    const e1 = encryptSecret("same", TEST_KEY);
    const e2 = encryptSecret("same", TEST_KEY);
    assert.notEqual(e1, e2);
  });
  it("round-trips empty string", () => {
    const encrypted = encryptSecret("", TEST_KEY);
    const decrypted = decryptSecret(encrypted, TEST_KEY);
    assert.equal(decrypted, "");
  });
  it("round-trips long strings", () => {
    const long = "x".repeat(10000);
    assert.equal(decryptSecret(encryptSecret(long, TEST_KEY), TEST_KEY), long);
  });
  it("round-trips special characters", () => {
    const special = "!@#$%^&*()_+{}|:\"<>?`~";
    assert.equal(decryptSecret(encryptSecret(special, TEST_KEY), TEST_KEY), special);
  });
});

describe("decryptSecret with legacy plaintext", () => {
  it("passes through plaintext that doesn't start with enc:v1:", () => {
    assert.equal(decryptSecret("plain-secret", TEST_KEY), "plain-secret");
  });
  it("passes through empty string", () => assert.equal(decryptSecret("", TEST_KEY), ""));
});

describe("decryptSecret error handling", () => {
  it("throws on wrong key", () => {
    const encrypted = encryptSecret("secret", TEST_KEY);
    const wrongKey = "0000000000000000000000000000000000000000000000000000000000000000";
    assert.throws(() => decryptSecret(encrypted, wrongKey));
  });
  it("throws on malformed encrypted value", () => {
    assert.throws(() => decryptSecret("enc:v1:bad", TEST_KEY), /malformed/);
  });
});

describe("maskTail", () => {
  it("masks a long string showing last 4 chars", () => {
    const masked = maskTail("consumer-secret-12345678");
    // String ends with "5678"
    assert.ok(masked.endsWith("5678"));
    assert.ok(!masked.includes("consumer"));
  });
  it("masks short string with at least 6 bullets", () => {
    assert.ok(maskTail("abc").match(/•{6}abc$/));
  });
  it("returns empty for empty input", () => assert.equal(maskTail(""), ""));
  it("caps bullet count at 12", () => {
    const masked = maskTail("a".repeat(100));
    const bullets = (masked.match(/•/g) || []).length;
    assert.ok(bullets <= 12);
  });
});
