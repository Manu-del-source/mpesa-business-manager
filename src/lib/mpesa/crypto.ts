import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Envelope encryption for Daraja secrets at rest (consumer secret + passkey).
 *
 * Format: `enc:v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>` (AES-256-GCM).
 *
 * When MPESA_CREDENTIALS_KEY is not set the value is stored verbatim so that
 * local/demo setups keep working; `encryptionEnabled()` lets the UI warn about
 * it. Decryption always tolerates plaintext, so enabling the key later does not
 * break existing rows (they are re-encrypted the next time they are saved).
 */

const PREFIX = "enc:v1:";

function loadKey(): Buffer | null {
  const raw = env.mpesaCredentialsKey.trim();
  if (!raw) return null;

  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    try {
      const decoded = Buffer.from(raw, "base64");
      if (decoded.length === 32) key = decoded;
    } catch {
      key = null;
    }
  }

  if (!key || key.length !== 32) {
    throw new Error(
      "MPESA_CREDENTIALS_KEY must be 32 bytes, supplied as base64 or 64 hex characters.",
    );
  }
  return key;
}

export function encryptionEnabled(): boolean {
  return Boolean(env.mpesaCredentialsKey.trim());
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext row

  const key = loadKey();
  if (!key) {
    throw new Error(
      "This organization's M-Pesa credentials are encrypted but MPESA_CREDENTIALS_KEY is not set.",
    );
  }

  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored M-Pesa credential is malformed.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** `••••••1234` — safe to render; never reveals a full secret. */
export function maskTail(value: string, visible = 4): string {
  if (!value) return "";
  const tail = value.slice(-visible);
  return `${"•".repeat(Math.max(6, Math.min(12, value.length - visible)))}${tail}`;
}
