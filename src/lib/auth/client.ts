"use client";

import { useCallback, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { useTier } from "@/lib/tier/client";
import { armCeremony } from "@/lib/tier/ceremony";

/**
 * Wallet-first sign-in flow, shared by every entry point (SignInButton,
 * TierGate prompt, etc). Prefers Solana/Phantom when connected — Z-SWAP is
 * Solana-first — and falls back to the connected EVM wallet otherwise.
 *
 * Flow: GET /api/auth/nonce → wallet signs the returned message →
 * POST /api/auth/verify → session cookie set → refresh the tier query.
 */

type AuthChain = "evm" | "solana";

export type SignInError =
  | "no_wallet"
  | "unconfigured"
  | "rejected"
  | "failed";

export interface WalletAuth {
  signIn: (forceChain?: AuthChain) => Promise<boolean>;
  signOut: () => Promise<void>;
  pending: boolean;
  error: SignInError | null;
  /** Which wallet the next signIn() would use when called without args. */
  activeChain: AuthChain | null;
  /** Whether each chain currently has a connected wallet available to sign. */
  evmAvailable:    boolean;
  solanaAvailable: boolean;
}

export function useWalletAuth(): WalletAuth {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const sol = useWallet();
  const { refresh } = useTier();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);

  const solConnected = sol.connected && !!sol.publicKey;
  const evmAvailable    = evmConnected && !!evmAddress;
  const solanaAvailable = solConnected;
  const activeChain: AuthChain | null = solConnected ? "solana" : evmAvailable ? "evm" : null;

  const signIn = useCallback(async (forceChain?: AuthChain): Promise<boolean> => {
    setError(null);

    // Use forceChain when provided (user explicitly chose a wallet), otherwise
    // prefer Solana → EVM by default (Solana-first platform).
    const chain: AuthChain | null =
      forceChain === "evm"    && evmAvailable    ? "evm"    :
      forceChain === "solana" && solanaAvailable ? "solana" :
      forceChain ? null // requested chain not available
      : solConnected ? "solana" : evmAvailable ? "evm" : null;
    const address = chain === "solana" ? sol.publicKey?.toBase58() : evmAddress;
    if (!chain || !address) {
      setError("no_wallet");
      return false;
    }

    setPending(true);
    try {
      // 1. Nonce / challenge
      const nonceRes = await fetch(`/api/auth/nonce?address=${encodeURIComponent(address)}&chain=${chain}`);
      if (nonceRes.status === 503) { setError("unconfigured"); return false; }
      if (!nonceRes.ok) { setError("failed"); return false; }
      const { message } = await nonceRes.json();
      if (typeof message !== "string") { setError("failed"); return false; }

      // 2. Sign with the active wallet
      let signature: string;
      try {
        if (chain === "solana") {
          if (!sol.signMessage) { setError("failed"); return false; }
          const sig = await sol.signMessage(new TextEncoder().encode(message));
          signature = bs58.encode(sig);
        } else {
          signature = await signMessageAsync({ message, account: evmAddress as `0x${string}` });
        }
      } catch {
        setError("rejected");
        return false;
      }

      // 3. Verify → session cookie
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chain, signature }),
      });
      if (verifyRes.status === 503) { setError("unconfigured"); return false; }
      if (!verifyRes.ok) { setError("failed"); return false; }

      armCeremony();
      await refresh();
      return true;
    } catch {
      setError("failed");
      return false;
    } finally {
      setPending(false);
    }
  }, [solConnected, evmAvailable, solanaAvailable, evmAddress, sol, signMessageAsync, refresh]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { signIn, signOut, pending, error, activeChain, evmAvailable, solanaAvailable };
}
