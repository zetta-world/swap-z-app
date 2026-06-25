"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X, Loader2, AlertTriangle, Check } from "lucide-react";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import { useT } from "@/lib/i18n";
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
  const t = useT();
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
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/80 backdrop-blur-md animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed z-[70] flex flex-col outline-none overflow-hidden",
            // mobile: bottom sheet, fixed height so header never clips off-screen
            "bottom-0 left-0 right-0 h-[82vh] rounded-t-3xl",
            "border-t border-white/10 bg-gradient-to-b from-bg-1 to-bg shadow-2xl",
            // desktop: centered card
            "sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2",
            "sm:w-[440px] sm:h-[640px] sm:max-h-[88vh] sm:rounded-3xl sm:border",
          )}
          onOpenAutoFocus={(e) => { e.preventDefault(); searchRef.current?.focus(); }}
        >
          {/* Mobile drag handle */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
            <div className="w-9 h-1 rounded-full bg-white/20" />
          </div>

          {/* Header — title + prominent close button */}
          <div className="flex items-center justify-between px-5 pt-2 pb-3 flex-shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="font-display font-extrabold text-base text-ink leading-none">
                {t("cex.pairSelectTitle")}
              </Dialog.Title>
              <p className="font-mono text-[10px] text-ink-3 tracking-wider mt-1 uppercase">
                {markets.length > 0 ? t("cex.pairMarketsCount", { n: markets.length }) : "—"}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t("cex.pairClose")}
                className="w-9 h-9 rounded-full flex items-center justify-center text-ink-2 bg-white/[0.05] border border-white/10 hover:bg-white/[0.10] hover:text-ink active:scale-95 transition-all flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Search */}
          <div className="px-5 pb-3 flex-shrink-0">
            <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl bg-white/[0.05] border border-white/8 focus-within:border-cyan/40 focus-within:bg-white/[0.07] transition-all">
              <Search className="w-4 h-4 text-ink-3 flex-shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("cex.pairSearchPlaceholder")}
                className="flex-1 bg-transparent outline-none text-sm font-medium text-ink placeholder:text-ink-4"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="w-5 h-5 rounded-full flex items-center justify-center bg-white/10 text-ink-3 hover:text-ink flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Quote tabs — hidden while searching */}
          {!isSearching && quoteAssets.length > 0 && (
            <div className="flex gap-2 px-5 pb-3 overflow-x-auto scrollbar-hide flex-shrink-0">
              {quoteAssets.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuoteFilter(q)}
                  className={cn(
                    "flex-shrink-0 px-4 py-1.5 rounded-full font-display font-bold text-[11px] tracking-wide border transition-all",
                    quoteFilter === q
                      ? "bg-cyan/15 text-cyan border-cyan/40 shadow-[0_0_12px_-2px] shadow-cyan/30"
                      : "bg-white/[0.04] text-ink-3 border-white/8 hover:text-ink-2 hover:border-white/15",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Pair list */}
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-0 border-t border-white/5">

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-cyan" />
                <p className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("cex.pairLoading")}</p>
              </div>
            )}

            {!loading && error && (
              <div className="mx-5 mt-4 rounded-xl border border-red/20 bg-red/[0.05] p-3 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[11px] text-red leading-relaxed">{error}</p>
              </div>
            )}

            {!loading && !error && displayed.length === 0 && (
              <p className="text-center font-mono text-[11px] text-ink-3 py-16">{t("cex.pairEmpty")}</p>
            )}

            {!loading && !error && displayed.map((m) => {
              const isCurrent = currentSymbol === m.symbol;
              return (
                <button
                  key={m.symbol}
                  type="button"
                  onClick={() => handleSelect(m.symbol)}
                  className={cn(
                    "w-full flex items-center gap-3 px-5 py-3 transition-colors",
                    isCurrent ? "bg-cyan/[0.07]" : "hover:bg-white/[0.04] active:bg-white/[0.06]",
                  )}
                >
                  <TokenLogo base={m.base} />

                  <div className="flex-1 text-left min-w-0">
                    <div className="font-display font-bold text-sm leading-tight flex items-baseline gap-0.5">
                      <span className={isCurrent ? "text-cyan" : "text-ink"}>{m.base}</span>
                      <span className="text-ink-3 font-normal text-xs">/{m.quote}</span>
                    </div>
                  </div>

                  {isCurrent && (
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-cyan/15 flex-shrink-0">
                      <Check className="w-3 h-3 text-cyan" />
                    </span>
                  )}
                </button>
              );
            })}

            {isSearching && displayed.length > 0 && (
              <p className="text-center font-mono text-[9px] text-ink-4 py-4">
                {displayed.length === 1
                  ? t("cex.pairResultCount", { n: displayed.length })
                  : t("cex.pairResultCountPlural", { n: displayed.length })}
              </p>
            )}

            <div className="h-4" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
