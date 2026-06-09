import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { buildSignMessage } from "./challenge";

/**
 * SIWS (Sign-In with Solana) — verifies an ed25519 signature over the
 * canonical challenge message. Solana wallets (Phantom, Solflare) expose
 * `signMessage(bytes)` which returns a raw 64-byte ed25519 signature; the
 * public key IS the wallet address (base58-encoded). We verify with tweetnacl.
 */

/** Validates + returns the base58 address, or null if it isn't a real pubkey. */
export function normalizeSolanaAddress(address: string): string | null {
  try {
    // Constructing a PublicKey throws on malformed input; toBase58 re-canonicalizes.
    return new PublicKey(address).toBase58();
  } catch {
    return null;
  }
}

export function verifySolanaSignature(args: {
  address:   string;
  /** base58-encoded 64-byte ed25519 signature (as Phantom returns it). */
  signature: string;
  nonce:     string;
  issuedAt:  string;
}): boolean {
  const address = normalizeSolanaAddress(args.address);
  if (!address) return false;

  let signatureBytes: Uint8Array;
  let publicKeyBytes: Uint8Array;
  try {
    signatureBytes = bs58.decode(args.signature);
    publicKeyBytes = new PublicKey(address).toBytes();
  } catch {
    return false;
  }
  if (signatureBytes.length !== 64) return false;

  const message = buildSignMessage(address, args.nonce, args.issuedAt);
  const messageBytes = new TextEncoder().encode(message);

  try {
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
}
