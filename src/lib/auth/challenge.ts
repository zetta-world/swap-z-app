import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Challenge layer — issues a single-use nonce per wallet and bakes it into a
 * human-readable message the wallet signs. Shared by both the EVM (SIWE) and
 * Solana (SIWS) flows so the message format and anti-replay rules stay
 * identical across chains.
 */

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes to sign

/** 16 random bytes, hex-encoded → 32 chars of unguessable nonce. */
export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

/**
 * The exact string the wallet signs. Keep this STABLE — the verify path
 * reconstructs it byte-for-byte, so any change here must ship to both sides at
 * once or every signature will fail to verify.
 */
export function buildSignMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    "z-swap.app wants you to sign in with your wallet:",
    address,
    "",
    "Prove ownership to unlock tier-gated features.",
    "This request will NOT trigger a transaction or cost any gas.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export interface IssuedChallenge {
  nonce:    string;
  issuedAt: string;
  message:  string;
}

/**
 * Stores a fresh nonce for `address` (overwriting any prior pending one) and
 * returns the message to sign. Returns null when Supabase is unconfigured so
 * the caller can answer 503 instead of crashing.
 */
export async function issueChallenge(address: string): Promise<IssuedChallenge | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  const nonce = generateNonce();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();

  const { error } = await db
    .from("auth_nonces")
    .upsert(
      { wallet_address: address, nonce, issued_at: issuedAt, expires_at: expiresAt },
      { onConflict: "wallet_address" },
    );
  if (error) {
    console.warn("[auth] issueChallenge upsert failed:", error.message);
    return null;
  }

  return { nonce, issuedAt, message: buildSignMessage(address, nonce, issuedAt) };
}
