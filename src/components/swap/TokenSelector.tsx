"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, useMemo } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { DEFAULT_TOKENS, type Token } from "@/lib/tokens";
import { CHAINS, type ChainId } from "@/lib/chains";
import { formatUsd } from "@/lib/format";
import { riskFromScore } from "@/lib/store/swap";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useTokenPrices, tokenPriceKey } from "@/lib/hooks/useTokenPrices";
import TokenLogo from "@/components/ui/TokenLogo";

interface Props {
  value: Token | undefined;
  onChange: (t: Token) => void;
  chainFilter?: ChainId;
  side: "from" | "to";
}

export default function TokenSelector({ value, onChange, chainFilter, side }: Props) {
  const t = useT();
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState<ChainId | "all">(chainFilter ?? "all");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DEFAULT_TOKENS.filter((t) => {
      if (chain !== "all" && t.chain !== chain) return false;
      if (!q) return true;
      return (
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
      );
    });
  }, [query, chain]);

  // Live prices for all visible tokens. Falls back to token.priceUsd while loading.
  const { prices } = useTokenPrices(open ? list : []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5 sm:py-2 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/10 transition-colors flex-shrink-0 max-w-[140px]",
            !value && "border-cyan/30 bg-cyan/5 hover:bg-cyan/10",
          )}
        >
          {value ? (
            <>
              <TokenLogo symbol={value.symbol} logo={value.logo} color={value.color} size={24} />
              <div className="text-left min-w-0">
                <div className="font-display font-bold text-sm text-ink leading-none truncate">{value.symbol}</div>
                <div className="font-mono text-[9px] text-ink-3 uppercase tracking-wider mt-1 truncate">{value.chain}</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
            </>
          ) : (
            <>
              <span className="font-display font-bold text-sm text-cyan whitespace-nowrap">{t("swap.tokenSelectorSelect")}</span>
              <ChevronDown className="w-3.5 h-3.5 text-cyan flex-shrink-0" />
            </>
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/85 backdrop-blur-md animate-fade-in" />

        {/*
         * Mobile (< sm): bottom-sheet — full width minus tiny margins,
         *   slides up from below, fills most of the screen height.
         * Desktop (sm+): centered modal — top-anchored, bounded width.
         */}
        <Dialog.Content
          className={cn(
            "fixed z-50 outline-none flex flex-col",
            // Mobile bottom sheet
            "inset-x-2 bottom-2 top-14",
            // Desktop centered modal
            "sm:inset-x-auto sm:bottom-auto sm:top-[8%]",
            "sm:left-1/2 sm:-translate-x-1/2",
            "sm:w-[95%] sm:max-w-lg sm:max-h-[85vh]",
            "animate-scale-in",
          )}
        >
          <div className="flex flex-col flex-1 min-h-0 rounded-2xl border border-white/10 glass-strong shadow-card overflow-hidden">
            {/* ─── Header ──────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-white/5 flex-shrink-0">
              <Dialog.Title className="font-display font-bold text-sm sm:text-base text-ink flex items-center gap-2 min-w-0">
                <span className="truncate">{t("swap.tokenSelectorHeader")}</span>
                <span className="font-mono text-[9px] sm:text-[10px] text-ink-3 uppercase tracking-widest border border-white/10 bg-white/[0.03] px-1.5 py-0.5 rounded flex-shrink-0">
                  {side}
                </span>
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={t("common.close")}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5 flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* ─── Search + chain pills ────────────────────────────── */}
            <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-white/5 space-y-3 flex-shrink-0">
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5 focus-within:border-cyan/30">
                <Search className="w-4 h-4 text-ink-3 flex-shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("swap.tokenSelectorPlaceholder")}
                  className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none font-sans"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="flex-shrink-0 text-ink-3 hover:text-ink"
                    aria-label={t("common.clear")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Chain pills — horizontal scroll with edge fade */}
              <div className="relative -mx-1">
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar px-1 py-0.5">
                  <ChainPill
                    active={chain === "all"}
                    onClick={() => setChain("all")}
                    label={t("explorer.chainAll")}
                  />
                  {CHAINS.map((c) => (
                    <ChainPill
                      key={c.id}
                      active={chain === c.id}
                      onClick={() => setChain(c.id)}
                      label={c.short}
                      color={c.color}
                    />
                  ))}
                </div>
                {/* Edge fades */}
                <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-bg-2 to-transparent" />
                <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-bg-2 to-transparent" />
              </div>
            </div>

            {/* ─── Token list (scroll) ─────────────────────────────── */}
            <div className="flex-1 overflow-y-auto py-1">
              {list.length === 0 ? (
                <div className="px-5 py-12 text-center font-sans text-sm text-ink-3">{t("swap.tokenSelectorNoMatch")}</div>
              ) : (
                list.map((tk) => {
                  const r = riskFromScore(tk.riskScore);
                  return (
                    <button
                      key={`${tk.chain}-${tk.address}`}
                      type="button"
                      onClick={() => { onChange(tk); setOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 sm:px-5 py-2.5 sm:py-3 hover:bg-white/[0.04] transition-colors text-left"
                    >
                      <TokenLogo symbol={tk.symbol} logo={tk.logo} color={tk.color} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-display font-bold text-sm text-ink truncate">{tk.symbol}</span>
                          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-wider flex-shrink-0">{tk.chain}</span>
                          <span
                            className={cn(
                              "ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0",
                              r === "safe"    && "bg-green",
                              r === "caution" && "bg-gold",
                              r === "danger"  && "bg-red",
                            )}
                            title={t("swap.riskTooltip", { level: r })}
                          />
                        </div>
                        <div className="font-sans text-xs text-ink-3 truncate">{tk.name}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-mono text-sm text-ink whitespace-nowrap">
                          {formatUsd(prices[tokenPriceKey(tk)] ?? tk.priceUsd)}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* ─── Footer disclaimer ───────────────────────────────── */}
            <div className="px-4 sm:px-5 py-2.5 border-t border-white/5 flex-shrink-0">
              <p className="font-mono text-[9px] sm:text-[10px] text-ink-4 text-center tracking-wide">
                {t("swap.tokenSelectorFooter", { n: list.length })}
              </p>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ChainPill({
  active, onClick, label, color,
}: {
  active: boolean; onClick: () => void; label: string; color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider border transition-all whitespace-nowrap",
        active
          ? "bg-white/[0.08] border-white/20 text-ink"
          : "border-white/5 bg-white/[0.02] text-ink-3 hover:text-ink-2 hover:border-white/10",
      )}
    >
      {color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
      {label}
    </button>
  );
}
