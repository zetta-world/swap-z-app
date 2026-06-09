import { verifyMessage, isAddress, getAddress } from "viem";
import { buildSignMessage } from "./challenge";

/**
 * SIWE (Sign-In with Ethereum) — verifies that `signature` over the canonical
 * challenge message was produced by the private key behind `address`. Uses
 * viem's EIP-191 personal_sign recovery (the same scheme wagmi's
 * `signMessage` produces in the browser).
 */

/** Normalizes to an EIP-55 checksummed address, or null if not a valid EVM address. */
export function normalizeEvmAddress(address: string): string | null {
  if (!isAddress(address)) return null;
  return getAddress(address);
}

export async function verifyEvmSignature(args: {
  address:   string;
  signature: string;
  nonce:     string;
  issuedAt:  string;
}): Promise<boolean> {
  const checksummed = normalizeEvmAddress(args.address);
  if (!checksummed) return false;
  const message = buildSignMessage(checksummed, args.nonce, args.issuedAt);
  try {
    return await verifyMessage({
      address: checksummed as `0x${string}`,
      message,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
