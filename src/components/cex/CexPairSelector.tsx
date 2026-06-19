"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X, Loader2, AlertTriangle, Check } from "lucide-react";
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

// Coins that appear first in the list, in order of popularity
const POPULAR = [
  "BTC","ETH","SOL","BNB","XRP","DOGE","ADA","AVAX","TRX","TON",
  "DOT","MATIC","LINK","ARB","OP","NEAR","APT","SUI","INJ","ATOM",
  "LTC","BCH","ETC","ALGO","VET","FIL","ICP","HBAR","AAVE","UNI",
];
const POPULAR_RANK: Record<string, number> = Object.fromEntries(POPULAR.map((s, i) => [s, i]));

function sortMarkets(markets: Market[]): Market[] {
  return [...markets].sort((a, b) => {
    const ra = POPULAR_RANK[a.base] ?? 999;
    const rb = POPULAR_RANK[b.base] ?? 999;
    if (ra !== rb) return ra - rb;
    return a.symbol.localeCompare(b.symbol);
  });
}

// ─── Token logo with fallback ──────────────────────────────────────────────
function TokenLogo({ base }: { base: string }) {
  const [failed, setFailed] = useState(false);
  const src = `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/icon/${base.toLowerCase()}.png`;

  if (failed) {
    // Colored initials circle — deterministic color based on symbol
    const hue = [...base].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
    return (
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center font-display font-extrabold text-[11px] flex-shrink-0"
        style={{ background: `hsl(${hue},55%,22%)`, color: `hsl(${hue},70%,65%)`, border: `1px solid hsl(${hue},55%,32%)` }}
      >
        {base.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={base}
      width={36}
      height={36}
      className="w-9 h-9 rounded-full flex-shrink-0 bg-white/5"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Bottom-sheet pair selector.
 *
 * Default view: top 30 pairs for the active quote tab (popular coins first).
 * Search mode: shows all matching pairs across all quote assets.
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

  // Fetch once per exchange
  useEffect(() => {
    if (!open) { setSearch(""); return; }
    if (markets.length > 0) return;
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
        setMarkets(sortMarkets(body.markets));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [open, exchangeId, credentials, markets.length]);

  // Reset when exchange changes
  useEffect(() => { setMarkets([]); setSearch(""); setQuoteFilter(""); }, [exchangeId]);

  // Top quote assets by frequency
  const quoteAssets = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of markets) counts[m.quote] = (counts[m.quote] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([q]) => q);
  }, [markets]);

  // Pick default quote tab
  useEffect(() => {
    if (!quoteFilter && quoteAssets.length > 0) {
      const preferred = ["USDT","USD","BUSD","USDC"];
      setQuoteFilter(preferred.find((q) => quoteAssets.includes(q)) ?? quoteAssets[0]);
    }
  }, [quoteAssets, quoteFilter]);

  const isSearching = search.trim().length > 0;

  const displayed = useMemo(() => {
    const q = search.toUpperCase().trim();
    if (q) {
      return markets
        .filter((m) => m.base.startsWith(q) || m.symbol.includes(q))
        .slice(0, 200);
    }
    // Default: top 30 for the active quote tab
    return markets.filter((m) => m.quote === quoteFilter).slice(0, 30);
  }, [markets, search, quoteFilter]);

  const handleSelect = (symbol: string) => { onSelect(symbol); onClose(); };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/70 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content
          className="fixed bottom-0 left-0 right-0 z-[70] flex flex-col bg-bg border-t border-white/10 rounded-t-2xl outline-none sm:left-1/2 sm:-translate-x-1/2 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:w-[440px] sm:rounded-2xl sm:border"
          style={{ maxHeight: "90vh" }}
          onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus(); }}
        >
          {/* Mobile drag handle */}
          <div className="flex justify-center pt-2.5 pb-1 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-white/15" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-2 pb-3 border-b border-white/5">
            <Dialog.Title className="font-display font-extrabold text-sm text-ink">
              Selecionar Par
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Search */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 focus-within:border-cyan/30 transition-colors">
              <Search className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar… BTC, ETH, SOL"
                className="flex-1 bg-transparent outline-none text-sm font-mono text-ink placeholder:text-ink-4"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="text-ink-3 hover:text-ink">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Quote tabs — hidden while searching */}
          {!isSearching && quoteAssets.length > 0 && (
            <div className="flex gap-1 px-4 pb-2 overflow-x-auto scrollbar-hide">
              {quoteAssets.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuoteFilter(q)}
                  className={cn(
                    "flex-shrink-0 px-3 py-1.5 rounded-full font-mono text-[10px] tracking-widest uppercase border transition-all",
                    quoteFilter === q
                      ? "bg-cyan/15 text-cyan border-cyan/30"
                      : "bg-white/[0.03] text-ink-3 border-white/8 hover:text-ink-2",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-white/5" />

          {/* Pair list */}
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">

            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-cyan" />
                <p className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Carregando mercados…</p>
              </div>
            )}

            {!loading && error && (
              <div className="mx-4 mt-4 rounded-xl border border-red/20 bg-red/[0.05] p-3 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[11px] text-red leading-relaxed">{error}</p>
              </div>
            )}

            {!loading && !error && displayed.length === 0 && (
              <p className="text-center font-mono text-[11px] text-ink-3 py-12">Nenhum par encontrado</p>
            )}

            {/* Column headers */}
            {!loading && !error && displayed.length > 0 && (
              <div className="flex items-center px-4 py-1.5 sticky top-0 bg-bg/95 backdrop-blur-sm">
                <span className="flex-1 font-mono text-[9px] text-ink-4 tracking-widest uppercase">Par</span>
                {isSearching && (
                  <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">Quote</span>
                )}
              </div>
            )}

            {!loading && !error && displayed.map((m) => {
              const isCurrent = currentSymbol === m.symbol;
              return (
                <button
                  key={m.symbol}
                  type="button"
                  onClick={() => handleSelect(m.symbol)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors",
                    isCurrent && "bg-cyan/[0.05]",
                  )}
                >
                  <TokenLogo base={m.base} />

                  <div className="flex-1 text-left min-w-0">
                    <div className="font-display font-bold text-[13px] leading-tight">
                      <span className={isCurrent ? "text-cyan" : "text-ink"}>{m.base}</span>
                      <span className="text-ink-3 font-normal text-[11px]">/{m.quote}</span>
                    </div>
                    <div className="font-mono text-[10px] text-ink-4 mt-0.5 truncate">{m.symbol}</div>
                  </div>

                  {isCurrent
                    ? <Check className="w-4 h-4 text-cyan flex-shrink-0" />
                    : <span className="w-4 flex-shrink-0" />}
                </button>
              );
            })}

            {/* Show count when in search mode */}
            {isSearching && displayed.length > 0 && (
              <p className="text-center font-mono text-[9px] text-ink-4 py-3">
                {displayed.length} resultado{displayed.length !== 1 ? "s" : ""}
              </p>
            )}

            <div className="h-6" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
