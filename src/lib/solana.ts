"use client";

import { clusterApiUrl, Connection, PublicKey, type Commitment } from "@solana/web3.js";
import { PhantomWalletAdapter }  from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

/**
 * Solana runtime config. We use a single mainnet-beta connection across the
 * app; users can override with NEXT_PUBLIC_SOLANA_RPC for paid endpoints.
 */
export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC ??
  clusterApiUrl("mainnet-beta");

export const SOLANA_COMMITMENT: Commitment = "confirmed";

/**
 * Wallet adapters in display order. Phantom is the default ~70% of Solana
 * users have; Solflare is the second-most-used hardware-friendly option.
 * Keep this list small — every adapter ships its own bundle.
 */
export const SOLANA_WALLETS = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
];

/** Native SOL is represented as the system program's "wrapped SOL" mint. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export function isSolanaAddress(s: string): boolean {
  if (!s || s.length < 32 || s.length > 44) return false;
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

let _conn: Connection | null = null;
export function getSolanaConnection(): Connection {
  if (!_conn) {
    _conn = new Connection(SOLANA_RPC, SOLANA_COMMITMENT);
  }
  return _conn;
}
