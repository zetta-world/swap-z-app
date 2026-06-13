"use client";

import { useState } from "react";
import { Wallet, Loader2, ShieldCheck, LogOut } from "lucide-react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletAuth } from "@/lib/auth/client";
import { useTier } from "@/lib/tier/client";
import ConnectModal from "@/components/wallet/ConnectModal";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * Wallet-first sign-in control. Three states:
 *   1. No wallet connected → "Connect wallet" (opens the picker modal)
 *   2. Wallet connected, no session → "Sign in" (triggers the SIWE/SIWS flow)
 *   3. Signed in → green chip + sign-out
 *
 * Phantom/Solana is preferred when both chains are connected (Solana-first).
 */
export default function SignInButton({ className }: { className?: string }) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { isConnected: evmConnected } = useAccount();
  const sol = useWallet();
  const { signIn, signOut, pending, error, activeChain, evmAvailable, solanaAvailable } = useWalletAuth();
  const { authenticated, isLoading } = useTier();

  const anyWallet = (sol.connected && !!sol.publicKey) || evmConnected;

  if (isLoading) {
    return <span className={cn("inline-flex h-9 w-28 rounded-lg bg-white/[0.03] border border-white/5 animate-pulse", className)} aria-hidden="true" />;
  }

  // ── 3. Signed in ──────────────────────────────────────────────────────────
  if (authenticated) {
    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
        <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-green/30 bg-green/[0.06] font-mono text-[10px] tracking-widest uppercase text-green">
          <ShieldCheck className="w-3.5 h-3.5" />
          {t("auth.signedIn")}
        </span>
        <button
          onClick={() => signOut()}
          className="inline-flex items-center justify-center h-9 px-2.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-ink-3 hover:text-ink"
          title={t("auth.signOut")}
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // ── 1. No wallet connected ────────────────────────────────────────────────
  if (!anyWallet) {
    return (
      <>
        <button
          onClick={() => setPickerOpen(true)}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-grad-cyan text-bg font-display font-bold text-[13px] tracking-wide hover:opacity-90 transition-opacity",
            className,
          )}
        >
          <Wallet className="w-3.5 h-3.5" />
          {t("auth.connectToSignIn")}
        </button>
        <ConnectModal open={pickerOpen} onOpenChange={setPickerOpen} />
      </>
    );
  }

  // ── 2. Wallet connected, needs to sign ────────────────────────────────────
  // When both chains are connected, expose a button for each so the user can
  // choose which wallet to authenticate with (e.g. Phantom OR MetaMask/BSC).
  const bothConnected = solanaAvailable && evmAvailable;

  return (
    <div className={cn("inline-flex flex-col items-start gap-1", className)}>
      <div className="inline-flex items-center gap-1.5">
        {/* Solana / Phantom button — shown when Phantom is connected */}
        {solanaAvailable && (
          <button
            onClick={() => signIn("solana")}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-cyan/40 bg-cyan/15 text-cyan font-mono text-[11px] tracking-widest uppercase hover:bg-cyan/25 disabled:opacity-60"
          >
            {pending && activeChain === "solana"
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <ShieldCheck className="w-3.5 h-3.5" />}
            {bothConnected ? "Phantom" : pending ? t("auth.signing") : t("auth.signIn")}
            {!bothConnected && !pending && (
              <span className="font-mono text-[9px] text-cyan/60">· Phantom</span>
            )}
          </button>
        )}

        {/* EVM button — shown when an EVM wallet (MetaMask / BSC) is connected */}
        {evmAvailable && (
          <button
            onClick={() => signIn("evm")}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border border-violet/40 bg-violet/15 text-violet font-mono text-[11px] tracking-widest uppercase hover:bg-violet/25 disabled:opacity-60"
          >
            {pending && activeChain === "evm"
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <ShieldCheck className="w-3.5 h-3.5" />}
            {bothConnected ? "EVM" : pending ? t("auth.signing") : t("auth.signIn")}
            {!bothConnected && !pending && (
              <span className="font-mono text-[9px] text-violet/60">· EVM</span>
            )}
          </button>
        )}
      </div>
      {error && (
        <span className="font-mono text-[10px] text-red leading-tight">
          {t(error === "rejected" ? "auth.errRejected" : error === "unconfigured" ? "auth.errUnconfigured" : "auth.errFailed")}
        </span>
      )}
    </div>
  );
}
