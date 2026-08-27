/**
 * Generic secret-at-rest facade.
 *
 * Re-exports the AES-256-GCM envelope encryption used for Daraja credentials
 * (src/lib/mpesa/crypto.ts) under a provider-neutral name, so any subsystem
 * (webhook signing secrets, provider credentials, …) encrypts the same way:
 *
 *   format:  enc:v1:<iv>:<authTag>:<ciphertext>
 *   key:     APP_CREDENTIALS_KEY / MPESA_CREDENTIALS_KEY (32 bytes, base64 or hex)
 *
 * When no key is configured the value is stored verbatim (local/demo mode);
 * `encryptionEnabled()` lets callers warn about it. Decryption always
 * tolerates plaintext rows, so enabling the key later is non-breaking.
 */
export {
  encryptSecret,
  decryptSecret,
  encryptionEnabled,
} from "@/lib/mpesa/crypto";
