"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, useMemo } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { DEFAULT_TOKENS, type Token } from "@/lib/tokens";
import { CHAINS, type ChainId } from "@/lib/chains";
import { formatUsd } from "@/lib/format";
import { riskFromScore } from "@/lib/store/swap";
import { cn } from "@/lib/cn";

interface Props {
  value: Token | undefined;
  onChange: (t: Token) => void;
  chainFilter?: ChainId;
  side: "from" | "to";
}

export default function TokenSelector({ value, onChange, chainFilter, side }: Props) {
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

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          className={cn(
            "flex items-center gap-2 px-2.5 py-2 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/10 transition-colors flex-shrink-0",
            !value && "border-cyan/30 bg-cyan/5 hover:bg-cyan/10",
          )}
        >
          {value ? (
            <>
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-bold flex-shrink-0"
                style={{ background: `${value.color}22`, color: value.color, border: `1px solid ${value.color}55` }}
              >
                {value.symbol.slice(0, 2)}
              </span>
              <div className="text-left min-w-0">
                <div className="font-display font-bold text-sm text-ink leading-none">{value.symbol}</div>
                <div className="font-mono text-[9px] text-ink-3 uppercase tracking-wider mt-1">{value.chain}</div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-ink-3 ml-1" />
            </>
          ) : (
            <>
              <span className="font-display font-bold text-sm text-cyan">Select token</span>
              <ChevronDown className="w-3.5 h-3.5 text-cyan ml-1" />
            </>
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[10%] z-50 w-[95%] max-w-lg -translate-x-1/2 outline-none animate-scale-in">
          <div className="rounded-2xl border border-white/10 glass-strong shadow-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <Dialog.Title className="font-display font-bold text-base text-ink">
                Select a token <span className="font-mono text-[10px] text-ink-3 ml-2 uppercase tracking-widest">{side}</span>
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* Search */}
            <div className="px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/5 focus-within:border-cyan/30">
                <Search className="w-4 h-4 text-ink-3 flex-shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Symbol, name, or address"
                  className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 outline-none font-sans"
                />
              </div>

              {/* Chain pills */}
              <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar -mx-1 px-1">
                <button
                  onClick={() => setChain("all")}
                  className={cn(
                    "flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider border transition-all",
                    chain === "all"
                      ? "bg-white/[0.06] border-white/15 text-ink"
                      : "border-white/5 text-ink-3 hover:text-ink-2",
                  )}
                >
                  All
                </button>
                {CHAINS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setChain(c.id)}
                    className={cn(
                      "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider border transition-all",
                      chain === c.id
                        ? "bg-white/[0.06] border-white/15 text-ink"
                        : "border-white/5 text-ink-3 hover:text-ink-2",
                    )}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                    {c.short}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {list.length === 0 && (
                <div className="px-5 py-12 text-center font-sans text-sm text-ink-3">No tokens match.</div>
              )}
              {list.map((t) => {
                const r = riskFromScore(t.riskScore);
                return (
                  <button
                    key={`${t.chain}-${t.address}`}
                    onClick={() => { onChange(t); setOpen(false); }}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors text-left"
                  >
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center font-mono text-xs font-bold flex-shrink-0"
                      style={{ background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}55` }}
                    >
                      {t.symbol.slice(0, 2)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold text-sm text-ink">{t.symbol}</span>
                        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-wider">{t.chain}</span>
                        <span className={cn(
                          "ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0",
                          r === "safe" && "bg-green",
                          r === "caution" && "bg-gold",
                          r === "danger" && "bg-red",
                        )} title={`Risk: ${r}`} />
                      </div>
                      <div className="font-sans text-xs text-ink-3 truncate">{t.name}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-mono text-sm text-ink">{formatUsd(t.priceUsd)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
