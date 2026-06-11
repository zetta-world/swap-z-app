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
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  pending: boolean;
  error: SignInError | null;
  /** Which wallet the next signIn() would use, or null if none connected. */
  activeChain: AuthChain | null;
}

export function useWalletAuth(): WalletAuth {
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const sol = useWallet();
  const { refresh } = useTier();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);

  const solConnected = sol.connected && !!sol.publicKey;
  const activeChain: AuthChain | null = solConnected ? "solana" : evmConnected && evmAddress ? "evm" : null;

  const signIn = useCallback(async (): Promise<boolean> => {
    setError(null);

    const chain: AuthChain | null = solConnected ? "solana" : evmConnected && evmAddress ? "evm" : null;
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
  }, [solConnected, evmConnected, evmAddress, sol, signMessageAsync, refresh]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      await refresh();
    }
  }, [refresh]);

  return { signIn, signOut, pending, error, activeChain };
}
