"use client";

import { useAccount } from "wagmi";
import { useState, useEffect } from "react";
import { Wallet } from "lucide-react";
import ConnectModal from "./ConnectModal";
import AccountMenu from "./AccountMenu";

/**
 * Renders one of two states:
 *   - Disconnected: "Connect Wallet" / "Connect" / icon-only by viewport.
 *     Click opens ConnectModal (wallet picker).
 *   - Connected: AccountMenu (address + chain + dropdown).
 *
 * Uses a `mounted` gate to avoid SSR/hydration flash where the button
 * briefly shows "Connect" before wagmi hydrates the connected state.
 */
export default function ConnectButton() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const { address, isConnected } = useAccount();

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // SSR-safe skeleton — matches the button footprint
    return (
      <span className="h-9 w-[110px] rounded-lg bg-white/[0.03] border border-white/5" aria-hidden="true" />
    );
  }

  if (isConnected && address) {
    return <AccountMenu />;
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3.5 rounded-lg bg-grad-cyan text-bg font-display font-bold text-xs sm:text-[13px] tracking-wide whitespace-nowrap hover:opacity-90 transition-opacity"
      >
        <Wallet className="w-3.5 h-3.5 sm:hidden" />
        <span className="hidden sm:inline">Connect Wallet</span>
        <span className="hidden xs:inline sm:hidden">Connect</span>
      </button>
      <ConnectModal open={open} onOpenChange={setOpen} />
    </>
  );
}
