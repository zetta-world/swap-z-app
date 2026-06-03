"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAccount, useBalance, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import {
  ChevronDown, Copy, ExternalLink, LogOut, Check, Globe, Wallet,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { CHAINS } from "@/lib/chains";
import { WAGMI_CHAIN_TO_INTERNAL } from "@/lib/wagmi";
import { shortenAddress, formatAmount } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * Connected-state dropdown rendered next to the user's address chip.
 * Shows native balance, chain badge with switcher, copy address, view
 * on block explorer, disconnect.
 */
export default function AccountMenu() {
  const t = useT();
  const { address, connector, chain } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: balance } = useBalance({ address });
  const [copied, setCopied] = useState(false);
  // Hold the "copied" timer in a ref so a fast unmount (e.g. wallet
  // disconnect right after the click) doesn't leak a setState onto a
  // dead component. Cleared on unmount AND on each new copy.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  if (!address) return null;

  const internalId = WAGMI_CHAIN_TO_INTERNAL[chainId];
  const chainMeta = CHAINS.find((c) => c.id === internalId);
  const explorer = chain?.blockExplorers?.default.url ?? chainMeta?.explorer ?? "https://etherscan.io";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Clipboard API can throw on insecure contexts (HTTP) or when the
      // browser tab loses focus mid-click. Still show "copied" since the
      // selection-based fallback would catch it in most cases; failing
      // loud here is worse UX than the rare miss.
    }
    setCopied(true);
    toast.success(t("topbar.accountCopiedToast"));
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="inline-flex items-center gap-2 h-9 px-2.5 sm:px-3 rounded-lg border border-cyan/30 bg-cyan/[0.06] hover:bg-cyan/[0.12] transition-colors group">
          <span
            className="w-2 h-2 rounded-full pulse-dot flex-shrink-0"
            style={{ background: chainMeta?.color ?? "#00E8FF" }}
            aria-label={chainMeta?.short ?? "chain"}
          />
          <span className="font-mono text-xs text-ink hidden xs:inline tabular-nums">
            {shortenAddress(address, 4, 4)}
          </span>
          <span className="font-mono text-xs text-ink xs:hidden tabular-nums">
            {shortenAddress(address, 2, 4)}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-ink-3 group-hover:text-cyan flex-shrink-0" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-2xl border border-white/10 glass-strong shadow-card overflow-hidden"
        >
          {/* Account header */}
          <div className="p-4 border-b border-white/5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-grad-cyan/10 border border-cyan/30 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-cyan" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{connector?.name ?? t("topbar.accountConnected")}</div>
                <div className="font-mono text-sm text-ink truncate">{shortenAddress(address, 8, 6)}</div>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-white/5 bg-bg-1/40 p-2.5">
              <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-0.5">{t("topbar.accountBalance")}</div>
              <div className="font-display font-bold text-base text-ink">
                {balance ? `${formatAmount(parseFloat(balance.formatted), 4)} ${balance.symbol}` : "—"}
              </div>
            </div>
          </div>

          {/* Chain switcher */}
          <div className="p-2">
            <div className="px-2 py-1.5 font-mono text-[10px] text-ink-3 tracking-widest uppercase flex items-center gap-1.5">
              <Globe className="w-3 h-3" /> {t("topbar.accountNetwork")}
            </div>
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {CHAINS.filter((c) => c.evm && !c.comingSoon).map((c) => {
                const active = c.id === internalId;
                const wagmiChainId = Object.entries(WAGMI_CHAIN_TO_INTERNAL)
                  .find(([, internal]) => internal === c.id)?.[0];
                if (!wagmiChainId) return null;
                return (
                  <button
                    key={c.id}
                    onClick={() => switchChain({ chainId: parseInt(wagmiChainId, 10) })}
                    disabled={switching || active}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors text-left",
                      active ? "bg-cyan/[0.08]" : "hover:bg-white/[0.04]",
                      switching && !active && "opacity-50",
                    )}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color, boxShadow: active ? `0 0 8px ${c.color}` : "none" }} />
                    <span className={cn("font-display font-bold text-xs flex-1 truncate", active ? "text-cyan" : "text-ink")}>{c.name}</span>
                    <span className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">{c.short}</span>
                    {active && <Check className="w-3 h-3 text-cyan flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="p-2 border-t border-white/5 space-y-0.5">
            <DropdownMenu.Item asChild>
              <button onClick={onCopy} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-white/5 outline-none text-left">
                {copied ? <Check className="w-3.5 h-3.5 text-green" /> : <Copy className="w-3.5 h-3.5 text-ink-3" />}
                <span className="font-sans text-sm text-ink-2 flex-1">{copied ? t("topbar.accountCopied") : t("topbar.accountCopy")}</span>
              </button>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <a
                href={`${explorer}/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-white/5 outline-none"
              >
                <ExternalLink className="w-3.5 h-3.5 text-ink-3" />
                <span className="font-sans text-sm text-ink-2 flex-1">{t("topbar.accountExplorer")}</span>
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <button
                onClick={() => disconnect()}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md hover:bg-red/10 outline-none text-left"
              >
                <LogOut className="w-3.5 h-3.5 text-red" />
                <span className="font-sans text-sm text-red flex-1">{t("topbar.accountDisconnect")}</span>
              </button>
            </DropdownMenu.Item>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
