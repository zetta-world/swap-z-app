"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { Copy, LogOut, ExternalLink, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { formatAmount } from "@/lib/format";
import { useT } from "@/lib/i18n";

/**
 * Compact Solana account pill in the topbar — sits beside the EVM AccountMenu
 * when both chains are connected. Mirrors the EVM menu's visual weight so
 * neither feels like a second-class citizen.
 */
export default function SolanaAccountChip() {
  const t = useT();
  const { publicKey, disconnect, wallet } = useWallet();
  const { connection } = useConnection();
  const [lamports, setLamports] = useState<bigint | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setLamports(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const bal = await connection.getBalance(publicKey, "confirmed");
        if (!cancelled) setLamports(BigInt(bal));
      } catch {
        if (!cancelled) setLamports(null);
      }
    })();
    return () => { cancelled = true; };
  }, [publicKey, connection]);

  if (!publicKey) return null;

  const addr  = publicKey.toBase58();
  const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  const solBalance = lamports !== null ? Number(lamports) / LAMPORTS_PER_SOL : null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(addr);
      toast.success(t("topbar.accountCopiedToast"));
    } catch {
      toast.error(t("toast.error"));
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
          style={{ borderColor: "#14F19533" }}>
          <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: "#14F195" }} />
          <span className="font-mono text-[11px] text-ink tabular-nums">{short}</span>
          <ChevronDown className="w-3 h-3 text-ink-3" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-[60] w-64 rounded-xl border border-white/8 bg-bg-1/95 backdrop-blur-xl p-2 shadow-card"
        >
          <div className="px-2.5 py-2 mb-1">
            <div className="font-mono text-[9px] tracking-widest uppercase mb-1" style={{ color: "#14F195" }}>
              Solana · {wallet?.adapter.name ?? t("common.connected").toLowerCase()}
            </div>
            <div className="font-mono text-[11px] text-ink tabular-nums break-all">
              {addr}
            </div>
            {solBalance !== null && (
              <div className="mt-2 font-mono text-[10px] text-ink-3">
                {t("topbar.accountBalance")}: <span className="text-ink-2 font-bold">{formatAmount(solBalance, 4)} SOL</span>
              </div>
            )}
          </div>

          <div className="h-px bg-white/5 my-1" />

          <DropdownMenu.Item asChild>
            <button
              onClick={onCopy}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left font-mono text-[11px] text-ink-2 hover:bg-white/5 outline-none"
            >
              <Copy className="w-3.5 h-3.5" />
              {t("topbar.accountCopy")}
            </button>
          </DropdownMenu.Item>

          <DropdownMenu.Item asChild>
            <a
              href={`https://solscan.io/account/${addr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg font-mono text-[11px] text-ink-2 hover:bg-white/5 outline-none"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t("topbar.accountExplorer")}
            </a>
          </DropdownMenu.Item>

          <div className="h-px bg-white/5 my-1" />

          <DropdownMenu.Item asChild>
            <button
              onClick={() => disconnect()}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg font-mono text-[11px] text-red/90 hover:bg-red/10 hover:text-red outline-none"
            >
              <LogOut className="w-3.5 h-3.5" />
              {t("topbar.accountDisconnect")}
            </button>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
