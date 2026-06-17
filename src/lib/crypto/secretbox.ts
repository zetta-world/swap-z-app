import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated symmetric encryption for at-rest secrets (CEX API
 * credentials stored in Supabase for the background autopilot).
 *
 * AES-256-GCM. The 256-bit key comes from AUTOPILOT_ENC_KEY (Vercel env var,
 * never in the database). Output format is three base64url parts joined by
 * dots: `iv.tag.ciphertext`. GCM's auth tag means tampering is detected on
 * decrypt — a flipped byte throws rather than yielding garbage plaintext.
 *
 * Server-only. The require-time guard turns an accidental client import into
 * an obvious crash instead of shipping the key resolution into a browser
 * bundle (the key itself is never NEXT_PUBLIC_, so it'd be undefined there,
 * but we fail loud regardless).
 */
if (typeof window !== "undefined") {
  throw new Error("crypto/secretbox.ts must never be imported in the browser.");
}

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

/**
 * Resolve the 32-byte key from AUTOPILOT_ENC_KEY. Accepts either base64 (44
 * chars) or hex (64 chars). Returns null when unset so callers can degrade
 * gracefully (background autopilot disabled) instead of crashing.
 */
function getKey(): Buffer | null {
  const raw = process.env.AUTOPILOT_ENC_KEY;
  if (!raw) return null;
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      return null;
    }
  }
  return key.length === 32 ? key : null;
}

/** True when AUTOPILOT_ENC_KEY is present and well-formed (32 bytes). */
export function isEncryptionConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypt a UTF-8 string. Throws if the key is missing/malformed. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) throw new Error("AUTOPILOT_ENC_KEY is not configured (need 32 bytes, base64 or hex).");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

/** Decrypt a value produced by encryptSecret. Throws on tamper / bad key. */
export function decryptSecret(packed: string): string {
  const key = getKey();
  if (!key) throw new Error("AUTOPILOT_ENC_KEY is not configured.");
  const parts = packed.split(".");
  if (parts.length !== 3) throw new Error("Malformed ciphertext.");
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/** Convenience: encrypt a JSON-serializable value. */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

/** Convenience: decrypt + JSON.parse. Throws on tamper or invalid JSON. */
export function decryptJson<T>(packed: string): T {
  return JSON.parse(decryptSecret(packed)) as T;
}
