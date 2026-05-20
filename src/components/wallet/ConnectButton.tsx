"use client";

import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useState, useEffect } from "react";
import { Wallet } from "lucide-react";
import ConnectModal from "./ConnectModal";
import AccountMenu from "./AccountMenu";
import SolanaAccountChip from "./SolanaAccountChip";

/**
 * Renders one or two account chips based on what the user has connected:
 *   - EVM only: AccountMenu  (address + chain + dropdown)
 *   - Solana only: SolanaAccountChip
 *   - Both: both chips, side by side
 *   - Neither: "Connect Wallet" button opening the picker modal
 */
export default function ConnectButton() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const sol = useWallet();

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span className="h-9 w-[110px] rounded-lg bg-white/[0.03] border border-white/5" aria-hidden="true" />
    );
  }

  const evmOn = isConnected && !!address;
  const solOn = sol.connected && !!sol.publicKey;

  if (evmOn || solOn) {
    return (
      <div className="flex items-center gap-1.5">
        {evmOn && <AccountMenu />}
        {solOn && <SolanaAccountChip />}
        {(!evmOn || !solOn) && (
          <button
            onClick={() => setOpen(true)}
            className="hidden sm:inline-flex items-center justify-center gap-1.5 h-9 px-2.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-cyan/30 font-mono text-[10px] text-ink-3 hover:text-cyan tracking-widest uppercase"
            title={evmOn ? "Add Solana wallet" : "Add EVM wallet"}
          >
            +
          </button>
        )}
        <ConnectModal open={open} onOpenChange={setOpen} />
      </div>
    );
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
