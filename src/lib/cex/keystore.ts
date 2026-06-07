"use client";

/**
 * Client-side encrypted keystore for CEX API credentials.
 *
 * THREAT MODEL & DESIGN:
 *   • Z-SWAP NEVER stores user CEX keys on its servers. The keys live
 *     exclusively in the user's browser localStorage, encrypted with a
 *     passphrase the user provides at unlock time.
 *   • The encryption uses Web Crypto's AES-GCM (256-bit key, random 96-bit
 *     IV per write). The key is derived from the passphrase via PBKDF2
 *     (SHA-256, 600 000 iterations — OWASP 2024 floor — with a 16-byte
 *     random salt). Vaults created before the 600k bump are silently
 *     re-encrypted at 600k on first unlock (see unlockKeystore).
 *   • Decrypted credentials are held in memory only while the user is
 *     making a call — the API routes receive them in the request header
 *     of one specific call and discard them immediately.
 *   • Encrypted blobs are versioned (v1) so future migrations don't brick
 *     existing users.
 *
 * NON-GOALS:
 *   • This is not a substitute for the user's CEX 2FA.
 *   • A malicious browser extension with localStorage + DOM access can
 *     still exfiltrate. We mitigate by: passphrase never persisted, lock
 *     button to forget the in-memory passphrase, and a clear "read-only"
 *     toggle that surfaces in the UI when the user marked their keys as
 *     trade-only on the CEX side.
 */

import type { CexCredentials, CexId } from "./types";

const STORAGE_KEY = "zswap_cex_keystore_v1";
// OWASP 2024 floor for PBKDF2-HMAC-SHA256 is 600k. New vaults use this;
// existing vaults that predate the bump stored no `iter` field and are
// read back at the legacy 250k so they still decrypt. On first unlock such
// vaults are transparently re-encrypted at 600k (see unlockKeystore) so a
// user who only ever unlocks — never edits — still gets upgraded.
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_ITERATIONS_LEGACY = 250_000;
const MIN_PASSPHRASE_LEN = 12;

interface EncryptedRecord {
  v:      1;
  /** PBKDF2 iteration count used for THIS record. Absent on pre-600k
   *  vaults — readers default to the legacy 250k when missing. */
  iter?:  number;
  salt:   string;       // base64 16 bytes
  iv:     string;       // base64 12 bytes
  cipher: string;       // base64 ciphertext (creds JSON encrypted)
  /** Public metadata — does NOT contain secrets, used for UI hints. */
  meta: {
    exchanges:    CexId[];   // which exchanges are present
    fingerprint?: string;    // last 4 of api key per exchange, joined
  };
}

// ─── Codec helpers ──────────────────────────────────────────────────

function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── PBKDF2 → AES-GCM key ───────────────────────────────────────────

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  // Make a fresh ArrayBuffer copy so TS' BufferSource type accepts it
  // regardless of whether the input is backed by a SharedArrayBuffer.
  const saltCopy = new Uint8Array(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name:       "PBKDF2",
      salt:       saltCopy,
      iterations,
      hash:       "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ─── Storage ────────────────────────────────────────────────────────

function safeReadRecord(): EncryptedRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EncryptedRecord;
    if (parsed && parsed.v === 1 && parsed.salt && parsed.iv && parsed.cipher) return parsed;
    return null;
  } catch {
    return null;
  }
}

function safeWriteRecord(rec: EncryptedRecord) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec)); } catch { /* quota */ }
}

// ─── Public API ─────────────────────────────────────────────────────

export function hasKeystore(): boolean {
  return safeReadRecord() !== null;
}

export function listExchanges(): CexId[] {
  return safeReadRecord()?.meta.exchanges ?? [];
}

export function getFingerprint(): string | undefined {
  return safeReadRecord()?.meta.fingerprint;
}

/**
 * Unlock the existing vault and return all stored CEX credentials. Throws
 * if the passphrase is wrong or no vault exists.
 */
export async function unlockKeystore(passphrase: string): Promise<Partial<Record<CexId, CexCredentials>>> {
  const rec = safeReadRecord();
  if (!rec) throw new Error("No vault found. Add credentials first.");
  const salt    = base64ToBytes(rec.salt);
  const iv      = new Uint8Array(base64ToBytes(rec.iv));
  const cipher  = new Uint8Array(base64ToBytes(rec.cipher));
  const iterUsed = rec.iter ?? PBKDF2_ITERATIONS_LEGACY;
  const key     = await deriveKey(passphrase, salt, iterUsed);

  let creds: Partial<Record<CexId, CexCredentials>>;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    creds = JSON.parse(new TextDecoder().decode(plain)) as Partial<Record<CexId, CexCredentials>>;
  } catch {
    throw new Error("Wrong passphrase. Try again.");
  }

  // One-time silent migration: legacy vaults (iter < 600k) get transparently
  // re-encrypted at the OWASP floor on first unlock. This must NEVER block the
  // unlock — the user already holds valid creds; a failed migration just gets
  // retried on the next unlock.
  if (iterUsed < PBKDF2_ITERATIONS) {
    try {
      await persistVault(passphrase, creds);
      console.info(`[keystore-migration] re-encrypted vault ${iterUsed} → ${PBKDF2_ITERATIONS} PBKDF2 iterations`);
    } catch (err) {
      console.error("[keystore-migration] re-encrypt failed; will retry next unlock", err);
    }
  }

  return creds;
}

/**
 * Encrypt `creds` with `passphrase` at the current PBKDF2 iteration count and
 * overwrite the stored vault. Fresh random salt + IV every write. Shared by
 * saveCredentials and the first-unlock migration.
 */
async function persistVault(
  passphrase: string,
  creds: Partial<Record<CexId, CexCredentials>>,
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plain  = new Uint8Array(new TextEncoder().encode(JSON.stringify(creds)));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);

  const exchanges = Object.keys(creds) as CexId[];
  const fingerprint = exchanges
    .map((id) => `${id}:${creds[id]?.apiKey.slice(-4) ?? "----"}`)
    .join(", ");

  safeWriteRecord({
    v: 1,
    iter:   PBKDF2_ITERATIONS,
    salt:   bytesToBase64(salt),
    iv:     bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipher)),
    meta:   { exchanges, fingerprint },
  });
}

/**
 * Save (or update) credentials for one or more exchanges. The user provides
 * the passphrase — if a vault already exists, the same passphrase must
 * decrypt it; otherwise we initialize a fresh vault.
 */
export async function saveCredentials(
  passphrase: string,
  next: Partial<Record<CexId, CexCredentials>>,
): Promise<void> {
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LEN) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LEN} characters.`);
  }

  // Merge into any existing vault (so the user doesn't lose Binance keys
  // when adding Coinbase)
  let merged: Partial<Record<CexId, CexCredentials>> = {};
  const existing = safeReadRecord();
  if (existing) {
    try {
      merged = await unlockKeystore(passphrase);
    } catch {
      throw new Error(
        "A vault already exists with a different passphrase. Forget it first " +
        "(Settings → Forget all CEX keys) or unlock with the original passphrase.",
      );
    }
  }
  for (const [id, creds] of Object.entries(next)) {
    if (creds) merged[id as CexId] = creds;
  }

  await persistVault(passphrase, merged);
}

/**
 * Remove ONE exchange from the vault. The passphrase is required to keep
 * the operation symmetric with save.
 */
export async function removeExchange(passphrase: string, id: CexId): Promise<void> {
  const creds = await unlockKeystore(passphrase);
  delete creds[id];
  if (Object.keys(creds).length === 0) {
    forgetEverything();
    return;
  }
  await saveCredentials(passphrase, creds);
}

/**
 * Nuke the entire vault. Doesn't require a passphrase — useful when the
 * user lost it. Forgets locally only; the keys at the exchanges remain.
 */
export function forgetEverything() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
}
