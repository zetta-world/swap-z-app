"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Search, Filter, RefreshCw, ChevronLeft, ChevronRight, AlertCircle, Globe,
  TrendingUp, TrendingDown, Layers, X,
} from "lucide-react";
import { CHAIN_BY_ID, type ChainId } from "@/lib/chains";
import { compactNumber } from "@/lib/format";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface Pool {
  id:          string;
  dex:         string;
  name:        string;
  network:     string;
  tvlUsd:      number;
  volume24h:   number;
  change24h:   number;
  priceUsd:    number;
  baseSymbol:  string;
  quoteSymbol: string;
  address:     string;
  createdAt?:  string;
  createdAtMs?: number;
}

interface ApiResponse {
  ok:          boolean;
  pools:       Pool[];
  page:        number;
  hasMore:     boolean;
  generatedAt: number;
}

type SortKey  = "tvl" | "volume" | "change";
type SortDir  = "desc" | "asc";

const PAGE_CHAINS: { id: ChainId; labelKey: MessageKey }[] = [
  { id: "ethereum",  labelKey: "explorer.chainEth"  },
  { id: "bsc",       labelKey: "explorer.chainBsc"  },
  { id: "base",      labelKey: "explorer.chainBase" },
  { id: "arbitrum",  labelKey: "explorer.chainArb"  },
  { id: "polygon",   labelKey: "explorer.chainPol"  },
  { id: "optimism",  labelKey: "explorer.chainOp"   },
  { id: "avalanche", labelKey: "explorer.chainAvax" },
  { id: "solana",    labelKey: "explorer.chainSol"  },
];

/**
 * Full catalog of every pool on a chain (or a cross-chain symbol search).
 * Paginated through GeckoTerminal's /networks/<n>/pools endpoint, 20 per
 * page; search hits /search/pools which is cross-chain.
 *
 * UX:
 *  • Type 2+ chars to switch into search mode (cross-chain)
 *  • Otherwise paginate within the selected chain
 *  • Sort header lets the user re-rank visible rows by TVL/Vol/Δ
 *  • Each row deep-links to /pair/[chain]/[address] for the deep dive
 */
export default function PoolsCatalog() {
  const [chain,   setChain]   = useState<ChainId>("ethereum");
  const [page,    setPage]    = useState(1);
  const [query,   setQuery]   = useState("");
  const [pools,   setPools]   = useState<Pool[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("tvl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const inSearchMode = query.trim().length >= 2;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (inSearchMode)  params.set("q",     query.trim());
      if (!inSearchMode) params.set("chain", chain);
      if (!inSearchMode) params.set("page",  String(page));

      const res  = await fetch(`/api/pools-catalog?${params.toString()}`, { cache: "no-store" });
      const body = (await res.json()) as ApiResponse & { error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPools(body.pools);
      setHasMore(body.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [chain, page, query, inSearchMode]);

  useEffect(() => { void load(); }, [load]);

  // Reset to page 1 whenever the user changes chain or types a query
  useEffect(() => { setPage(1); }, [chain, query]);

  const sortedPools = useMemo(() => {
    const factor = sortDir === "desc" ? -1 : 1;
    const cmp = (a: Pool, b: Pool) => {
      const av = sortKey === "tvl" ? a.tvlUsd : sortKey === "volume" ? a.volume24h : a.change24h;
      const bv = sortKey === "tvl" ? b.tvlUsd : sortKey === "volume" ? b.volume24h : b.change24h;
      return (av - bv) * factor;
    };
    return [...pools].sort(cmp);
  }, [pools, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  const t = useT();
  return (
    <div className="space-y-4 min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-4 h-4 text-cyan" />
            <span className="section-label">{t("explorer.catalogEyebrow")}</span>
            <span className="tag tag-cyan inline-flex items-center gap-1.5">
              <Globe className="w-2.5 h-2.5" />
              {t("explorer.catalog30Chains")}
            </span>
          </div>
          <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink leading-tight">
            {t("explorer.catalogTitle")}
          </h1>
          <p className="font-sans text-xs sm:text-sm text-ink-3 leading-relaxed mt-1 max-w-2xl">
            {t("explorer.catalogBody")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border font-mono text-[10px] tracking-widest uppercase border-cyan/20 bg-cyan/[0.05] text-cyan hover:bg-cyan/[0.10] disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          {loading ? t("explorer.loading") : t("explorer.refresh")}
        </button>
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3 space-y-3">
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/8 focus-within:border-cyan/30 min-w-0">
          <Search className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("explorer.catalogSearchPlaceholder")}
            maxLength={120}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm font-mono text-ink placeholder:text-ink-4"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-ink-3 hover:text-ink-2"
              aria-label={t("common.clear")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Chain selector — disabled in search mode */}
        <div className={cn("flex items-center gap-2", inSearchMode && "opacity-40")}>
          <Filter className="w-3 h-3 text-ink-3 flex-shrink-0" />
          <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase flex-shrink-0">{t("explorer.filterChain")}</span>
          <div className="flex gap-1 flex-wrap min-w-0">
            {PAGE_CHAINS.map((c) => {
              const active = chain === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => !inSearchMode && setChain(c.id)}
                  disabled={inSearchMode}
                  className={cn(
                    "px-2 py-0.5 rounded-md font-mono text-[10px] tracking-wider transition-colors disabled:cursor-not-allowed",
                    active && !inSearchMode
                      ? "bg-cyan/15 text-cyan border border-cyan/30"
                      : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2",
                  )}
                >
                  {t(c.labelKey)}
                </button>
              );
            })}
          </div>
          {inSearchMode && (
            <span className="font-mono text-[9px] text-cyan tracking-widest uppercase ml-auto">
              {t("explorer.catalogSearchMode")}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red/30 bg-red/[0.05] p-3 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-display font-bold text-xs text-red">{t("explorer.catalogOffline")}</div>
            <p className="font-mono text-[11px] text-ink-2 mt-0.5 truncate">{error}</p>
          </div>
        </div>
      )}

      {/* Sort header */}
      {!error && pools.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-bg-1/30 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-3 sm:px-4 py-2 border-b border-white/5 font-mono text-[9px] text-ink-3 tracking-widest uppercase">
            <div className="col-span-5">{t("explorer.catalogSortPair")}</div>
            <SortHeader label={t("common.tvl")}                onClick={() => toggleSort("tvl")}    active={sortKey === "tvl"}    dir={sortDir} />
            <SortHeader label={t("explorer.catalogSortVol")}   onClick={() => toggleSort("volume")} active={sortKey === "volume"} dir={sortDir} />
            <SortHeader label={t("explorer.catalogSortChg")} onClick={() => toggleSort("change")} active={sortKey === "change"} dir={sortDir} />
            <div className="col-span-1 text-right">{t("common.price")}</div>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {sortedPools.map((p) => <CatalogRow key={`${p.network}-${p.address}-${p.id}`} pool={p} />)}
          </div>
        </div>
      )}

      {!error && !loading && pools.length === 0 && (
        <div className="rounded-xl border border-white/5 bg-bg-1/30 p-6 text-center">
          <Search className="w-5 h-5 text-ink-3 mx-auto mb-2" />
          <p className="font-mono text-xs text-ink-3">
            {inSearchMode
              ? t("explorer.catalogEmpty")
              : t("explorer.catalogEmptyChain")}
          </p>
        </div>
      )}

      {/* Skeleton */}
      {loading && pools.length === 0 && <CatalogSkeleton />}

      {/* Pagination */}
      {!inSearchMode && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/10 bg-bg-1/40 text-ink-3 hover:text-ink hover:border-cyan/20 font-mono text-[10px] tracking-widest uppercase disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3 h-3" />
            {t("explorer.prev")}
          </button>
          <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
            {t("explorer.pageInfo", { n: page })}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || loading}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-white/10 bg-bg-1/40 text-ink-3 hover:text-ink hover:border-cyan/20 font-mono text-[10px] tracking-widest uppercase disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t("explorer.next")}
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────

function CatalogRow({ pool }: { pool: Pool }) {
  const internalChain = networkToChain(pool.network);
  const chainMeta = internalChain ? CHAIN_BY_ID[internalChain] : null;
  const up = pool.change24h >= 0;
  const dsSlug = internalChainToDsSlug(internalChain);
  const href = dsSlug && pool.address
    ? `/pair/${encodeURIComponent(dsSlug)}/${encodeURIComponent(pool.address)}`
    : null;

  const Row = href ? motion.a : motion.div;
  return (
    <Row
      // @ts-expect-error — framer's dynamic element typing
      href={href}
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        "grid grid-cols-12 gap-2 px-3 sm:px-4 py-2.5 min-w-0",
        href && "hover:bg-white/[0.03] transition-colors cursor-pointer",
      )}
    >
      <div className="col-span-5 min-w-0 flex items-center gap-2">
        {chainMeta && (
          <span
            className="font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded border flex-shrink-0"
            style={{ borderColor: `${chainMeta.color}40`, background: `${chainMeta.color}10`, color: chainMeta.color }}
          >
            {chainMeta.short}
          </span>
        )}
        <div className="min-w-0">
          <div className="font-display font-bold text-xs text-ink truncate">
            {pool.baseSymbol}<span className="text-ink-4"> / </span><span className="text-ink-2">{pool.quoteSymbol}</span>
          </div>
          <div className="font-mono text-[10px] text-ink-3 truncate">via {pool.dex}</div>
        </div>
      </div>
      <div className="col-span-2 text-right font-mono text-[11px] text-ink tabular-nums truncate">
        ${compactNumber(pool.tvlUsd)}
      </div>
      <div className="col-span-2 text-right font-mono text-[11px] text-ink-2 tabular-nums truncate">
        ${compactNumber(pool.volume24h)}
      </div>
      <div className="col-span-2 text-right">
        {pool.change24h !== 0 ? (
          <div className={cn(
            "inline-flex items-center gap-0.5 font-mono text-[11px] tabular-nums",
            up ? "text-green" : "text-red",
          )}>
            {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {up ? "+" : ""}{pool.change24h.toFixed(2)}%
          </div>
        ) : <span className="font-mono text-[11px] text-ink-4">—</span>}
      </div>
      <div className="col-span-1 text-right font-mono text-[10px] text-ink-3 truncate">
        {pool.priceUsd > 0
          ? pool.priceUsd < 0.0001 ? pool.priceUsd.toExponential(1) : `$${pool.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 4 })}`
          : "—"}
      </div>
    </Row>
  );
}

function SortHeader({ label, onClick, active, dir }: {
  label:   string;
  onClick: () => void;
  active:  boolean;
  dir:     SortDir;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "col-span-2 text-right inline-flex items-center justify-end gap-1 hover:text-cyan transition-colors",
        active && "text-cyan",
      )}
    >
      {label}
      {active && <span className="text-[9px]">{dir === "desc" ? "▼" : "▲"}</span>}
    </button>
  );
}

function CatalogSkeleton() {
  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/30 divide-y divide-white/[0.04] overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 px-3 sm:px-4 py-2.5 min-w-0">
          <div className="col-span-5 flex items-center gap-2">
            <div className="w-9 h-4 bg-white/5 rounded animate-pulse" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-24 bg-white/5 rounded animate-pulse" />
              <div className="h-2.5 w-32 bg-white/5 rounded animate-pulse" />
            </div>
          </div>
          <div className="col-span-2 h-4 bg-white/5 rounded animate-pulse" />
          <div className="col-span-2 h-4 bg-white/5 rounded animate-pulse" />
          <div className="col-span-2 h-4 bg-white/5 rounded animate-pulse" />
          <div className="col-span-1 h-3 bg-white/5 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Slug helpers (mirrors LiveFeed) ──────────────────────────────────

function networkToChain(network: string): ChainId | null {
  const m: Record<string, ChainId> = {
    eth: "ethereum", bsc: "bsc", polygon_pos: "polygon", base: "base",
    arbitrum: "arbitrum", optimism: "optimism", avax: "avalanche",
    zksync: "zksync", linea: "linea", solana: "solana",
  };
  return m[network] ?? null;
}

function internalChainToDsSlug(chain: ChainId | null): string | null {
  if (!chain) return null;
  const m: Record<string, string> = {
    ethereum: "ethereum", bsc: "bsc", polygon: "polygon", base: "base",
    arbitrum: "arbitrum", optimism: "optimism", avalanche: "avalanche",
    linea: "linea", zksync: "zksync", solana: "solana",
  };
  return m[chain] ?? null;
}
