"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X, Loader2, AlertTriangle, ChevronRight } from "lucide-react";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import { cn } from "@/lib/cn";

interface Market {
  symbol: string;
  base:   string;
  quote:  string;
}

interface Props {
  open:          boolean;
  onClose:       () => void;
  exchangeId:    CexId;
  credentials:   CexCredentials;
  currentSymbol: string;
  onSelect:      (symbol: string) => void;
}

/**
 * Bottom-sheet pair selector — fetches all spot markets from the selected
 * exchange, lets the user filter by quote asset or free-text search, and
 * calls onSelect with the chosen symbol.
 */
export default function CexPairSelector({
  open, onClose, exchangeId, credentials, currentSymbol, onSelect,
}: Props) {
  const [markets,     setMarkets]     = useState<Market[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [search,      setSearch]      = useState("");
  const [quoteFilter, setQuoteFilter] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch markets when modal opens (only once per open — the API caches for 5 min)
  useEffect(() => {
    if (!open) { setSearch(""); return; }
    if (markets.length > 0) return; // already loaded for this exchange

    setLoading(true);
    setError(null);
    fetch("/api/cex/markets", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        exchange:   exchangeId,
        apiKey:     credentials.apiKey,
        apiSecret:  credentials.apiSecret,
        passphrase: credentials.passphrase,
      }),
    })
      .then((r) => r.json() as Promise<{ ok: boolean; markets?: Market[]; error?: string }>)
      .then((body) => {
        if (!body.ok || !body.markets) throw new Error(body.error ?? "failed");
        setMarkets(body.markets);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, exchangeId, credentials, markets.length]);

  // Invalidate cached markets when exchange changes
  useEffect(() => { setMarkets([]); setSearch(""); setQuoteFilter(""); }, [exchangeId]);

  // Derive top quote assets from loaded markets
  const quoteAssets = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of markets) {
      counts[m.quote] = (counts[m.quote] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([q]) => q);
  }, [markets]);

  // Pick a sensible default quote filter after markets load
  useEffect(() => {
    if (quoteAssets.length > 0 && !quoteFilter) {
      const preferred = ["USDT", "USD", "BUSD", "USDC"];
      setQuoteFilter(preferred.find((q) => quoteAssets.includes(q)) ?? quoteAssets[0]);
    }
  }, [quoteAssets, quoteFilter]);

  // Filtered list — when searching, ignore the quote tab
  const filtered = useMemo(() => {
    const q = search.toUpperCase().trim();
    return markets
      .filter((m) => {
        if (q) return m.symbol.includes(q) || m.base.startsWith(q);
        return m.quote === quoteFilter;
      })
      .slice(0, 300);
  }, [markets, search, quoteFilter]);

  const handleSelect = (symbol: string) => {
    onSelect(symbol);
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/70 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content
          className="fixed bottom-0 left-0 right-0 z-[70] flex flex-col rounded-t-2xl bg-bg border-t border-white/10 outline-none sm:left-1/2 sm:-translate-x-1/2 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:w-[420px] sm:max-h-[600px] sm:rounded-2xl sm:border"
          style={{ maxHeight: "88vh" }}
          onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus(); }}
        >
          {/* Handle bar (mobile) */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-white/15" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-2 pb-3 border-b border-white/5">
            <Dialog.Title className="font-display font-extrabold text-sm text-ink">
              Selecionar Par
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Search input */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 focus-within:border-cyan/30 transition-colors">
              <Search className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar símbolo... ex: SOL, BNB"
                className="flex-1 bg-transparent outline-none text-sm font-mono text-ink placeholder:text-ink-4"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-ink-3 hover:text-ink"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Quote filter tabs */}
          {!search && quoteAssets.length > 0 && (
            <div className="flex gap-1 px-4 pb-2 overflow-x-auto scrollbar-hide">
              {quoteAssets.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuoteFilter(q)}
                  className={cn(
                    "flex-shrink-0 px-3 py-1.5 rounded-full font-mono text-[10px] tracking-widest uppercase transition-all border",
                    quoteFilter === q
                      ? "bg-cyan/15 text-cyan border-cyan/30"
                      : "bg-white/[0.03] text-ink-3 border-white/8 hover:text-ink-2 hover:border-white/15",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-white/5" />

          {/* Pair list */}
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-cyan" />
                <p className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
                  Carregando mercados…
                </p>
              </div>
            )}

            {!loading && error && (
              <div className="mx-4 mt-4 rounded-lg border border-red/20 bg-red/[0.05] p-3 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[11px] text-red">{error}</p>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <p className="text-center font-mono text-[11px] text-ink-3 py-12">
                Nenhum par encontrado
              </p>
            )}

            {!loading && !error && filtered.map((m) => {
              const isCurrent = currentSymbol === m.symbol;
              return (
                <button
                  key={m.symbol}
                  type="button"
                  onClick={() => handleSelect(m.symbol)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors",
                    isCurrent && "bg-cyan/[0.04]",
                  )}
                >
                  {/* Base asset avatar */}
                  <div className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center font-display font-extrabold text-[11px] text-ink flex-shrink-0">
                    {m.base.slice(0, 2)}
                  </div>

                  {/* Symbol */}
                  <div className="flex-1 text-left min-w-0">
                    <div className="font-display font-bold text-sm leading-tight">
                      <span className={isCurrent ? "text-cyan" : "text-ink"}>{m.base}</span>
                      <span className="text-ink-3 font-normal text-xs">/{m.quote}</span>
                    </div>
                  </div>

                  {isCurrent
                    ? <div className="w-2 h-2 rounded-full bg-cyan flex-shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-ink-4 flex-shrink-0" />}
                </button>
              );
            })}

            {/* Bottom padding for safe area */}
            <div className="h-safe-b sm:h-4" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
