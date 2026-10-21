"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useWallet } from "@solana/wallet-adapter-react";
import { Copy, LogOut, ExternalLink, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { formatAmount } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { findToken } from "@/lib/tokens";

const SOL = findToken("solana", "SOL");

/**
 * Compact Solana account pill in the topbar — sits beside the EVM AccountMenu
 * when both chains are connected. Mirrors the EVM menu's visual weight so
 * neither feels like a second-class citizen.
 */
export default function SolanaAccountChip() {
  const t = useT();
  const { publicKey, disconnect, wallet } = useWallet();
  // W1: a MESMA leitura do Swap e do Portfólio (servidor, chave dono+mint) — antes este chip
  // chamava o RPC público direto do navegador, que responde 403.
  const sol = useTokenBalance(SOL, null);

  if (!publicKey) return null;

  const addr  = publicKey.toBase58();
  const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  const solBalance = sol.status === "READY_POSITIVE" || sol.status === "READY_ZERO" || sol.status === "STALE"
    ? Number(sol.formatted) : null;

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
        <button className="tier-pill inline-flex items-center gap-1.5 h-9 px-2 sm:px-2.5 rounded-lg border border-[#14F195]/20 bg-white/[0.03] hover:bg-white/[0.06] transition-colors">
          <span className="w-1.5 h-1.5 rounded-full pulse-dot flex-shrink-0" style={{ background: "var(--tier-dot, #14F195)" }} />
          <span className="font-mono text-[11px] text-ink tabular-nums hidden xs:inline">{short}</span>
          <span className="font-mono text-[11px] text-ink tabular-nums xs:hidden">{`${addr.slice(0, 2)}…${addr.slice(-2)}`}</span>
          <ChevronDown className="w-3 h-3 text-ink-3 flex-shrink-0" />
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
              {wallet?.adapter.name ?? t("common.connected")} · Solana
            </div>
            <div className="font-mono text-[11px] text-ink tabular-nums break-all">
              {addr}
            </div>
            <div className="mt-2 font-mono text-[10px] text-ink-3">
              {t("topbar.accountBalance")}:{" "}
              {solBalance !== null ? (
                <span className="text-ink-2 font-bold">
                  {formatAmount(solBalance, 4)} SOL{sol.status === "STALE" ? ` (${t("topbar.balanceStale")})` : ""}
                </span>
              ) : sol.status === "ERROR" ? (
                <>
                  <span className="text-red/80">{t("topbar.balanceUnavailable")}</span>{" "}
                  <button type="button" onClick={() => sol.refetch()} className="text-cyan/80 hover:text-cyan underline underline-offset-2">
                    {t("topbar.balanceRetry")}
                  </button>
                </>
              ) : (
                <span>…</span>
              )}
            </div>
            <div className="mt-2 font-sans text-[10px] leading-snug text-ink-4">{t("topbar.balanceSeparate")}</div>
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
