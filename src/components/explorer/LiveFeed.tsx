"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCw, Activity, Filter, AlertCircle, Globe, Clock, TrendingUp, TrendingDown,
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
  generatedAt: number;
}

const AGE_FILTERS: { labelKey: MessageKey; hours: number | null }[] = [
  { labelKey: "explorer.age15m", hours: 0.25 },
  { labelKey: "explorer.age1h",  hours: 1 },
  { labelKey: "explorer.age6h",  hours: 6 },
  { labelKey: "explorer.age24h", hours: 24 },
  { labelKey: "explorer.ageAny", hours: null },
];

const FEATURED_CHAINS: { id: ChainId | "all"; labelKey: MessageKey }[] = [
  { id: "all",      labelKey: "explorer.chainAll"  },
  { id: "ethereum", labelKey: "explorer.chainEth"  },
  { id: "bsc",      labelKey: "explorer.chainBsc"  },
  { id: "base",     labelKey: "explorer.chainBase" },
  { id: "solana",   labelKey: "explorer.chainSol"  },
  { id: "arbitrum", labelKey: "explorer.chainArb"  },
  { id: "polygon",  labelKey: "explorer.chainPol"  },
];

/**
 * Live feed of newly-created liquidity pools. Polls /api/new-pairs every
 * 20 seconds; new rows fly in from the top. Filterable by chain and age,
 * with min-liquidity floor so the feed isn't drowned by dust deployments.
 */
export default function LiveFeed() {
  const [chain,    setChain]    = useState<ChainId | "all">("all");
  const [ageHours, setAgeHours] = useState<number | null>(6);
  const [minLiq,   setMinLiq]   = useState<number>(5_000);
  const [paused,   setPaused]   = useState(false);
  const [pools,    setPools]    = useState<Pool[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [pulseAt,  setPulseAt]  = useState<number>(0);

  const seenIds = useRef<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (chain !== "all")        params.set("chain",   chain);
      if (ageHours !== null)      params.set("maxAgeH", String(ageHours));
      params.set("limit", "40");

      const res  = await fetch(`/api/new-pairs?${params.toString()}`, { cache: "no-store" });
      const body = (await res.json()) as ApiResponse & { error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);

      // Apply min-liquidity floor
      const next = body.pools.filter((p) => p.tvlUsd >= minLiq);

      // Pulse animation when new ids appear
      const previouslySeen = seenIds.current;
      const freshIds = next.filter((p) => !previouslySeen.has(p.id));
      if (freshIds.length > 0 && previouslySeen.size > 0) {
        setPulseAt(Date.now());
      }
      next.forEach((p) => previouslySeen.add(p.id));

      setPools(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Initial load + on filter change
  useEffect(() => {
    seenIds.current = new Set();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, ageHours, minLiq]);

  // Poll every 20s when not paused
  useEffect(() => {
    if (paused) return;
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, chain, ageHours, minLiq]);

  const t = useT();
  return (
    <div className="space-y-4 min-w-0">
      <Header
        loading={loading}
        paused={paused}
        onToggle={() => setPaused((p) => !p)}
        onRefresh={load}
        pulseAt={pulseAt}
      />

      {/* Filter bar */}
      <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-3 h-3 text-ink-3" />
          <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">{t("explorer.filterChain")}</span>
          <div className="flex gap-1 flex-wrap min-w-0">
            {FEATURED_CHAINS.map((c) => {
              const active = chain === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setChain(c.id)}
                  className={cn(
                    "px-2 py-0.5 rounded-md font-mono text-[10px] tracking-wider transition-colors",
                    active
                      ? "bg-cyan/15 text-cyan border border-cyan/30"
                      : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2",
                  )}
                >
                  {t(c.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="w-3 h-3 text-ink-3" />
          <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">{t("explorer.filterAge")}</span>
          <div className="flex gap-1 flex-wrap min-w-0">
            {AGE_FILTERS.map((a) => {
              const active = ageHours === a.hours;
              return (
                <button
                  key={a.labelKey}
                  onClick={() => setAgeHours(a.hours)}
                  className={cn(
                    "px-2 py-0.5 rounded-md font-mono text-[10px] tracking-wider transition-colors",
                    active
                      ? "bg-gold/15 text-gold border border-gold/30"
                      : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2",
                  )}
                >
                  {t(a.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-ink-3" />
          <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">{t("explorer.filterMinLiq")}</span>
          <div className="flex gap-1 flex-wrap min-w-0">
            {[0, 5_000, 25_000, 100_000].map((m) => {
              const active = minLiq === m;
              return (
                <button
                  key={m}
                  onClick={() => setMinLiq(m)}
                  className={cn(
                    "px-2 py-0.5 rounded-md font-mono text-[10px] tracking-wider transition-colors",
                    active
                      ? "bg-violet/15 text-violet border border-violet/30"
                      : "bg-white/[0.03] text-ink-3 border border-white/5 hover:text-ink-2",
                  )}
                >
                  {m === 0 ? t("explorer.liqAny") : `$${compactNumber(m)}`}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red/30 bg-red/[0.05] p-3 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-display font-bold text-xs text-red">{t("explorer.feedOffline")}</div>
            <p className="font-mono text-[11px] text-ink-2 mt-0.5 truncate">{error}</p>
          </div>
        </div>
      )}

      {/* Pool list */}
      {!error && pools.length === 0 && !loading && (
        <div className="rounded-xl border border-white/5 bg-bg-1/30 p-6 text-center">
          <Activity className="w-5 h-5 text-ink-3 mx-auto mb-2" />
          <p className="font-mono text-xs text-ink-3">
            {t("explorer.feedEmpty")}
          </p>
        </div>
      )}

      {!error && pools.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-bg-1/30 divide-y divide-white/[0.04] overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            {pools.map((p) => (
              <FeedRow key={p.id} pool={p} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {loading && pools.length === 0 && <FeedSkeleton />}
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────────────

function Header({
  loading, paused, onToggle, onRefresh, pulseAt,
}: {
  loading:  boolean;
  paused:   boolean;
  onToggle: () => void;
  onRefresh: () => void;
  pulseAt:   number;
}) {
  const t = useT();
  // Pulse cue every time new rows arrive
  const recent = pulseAt > 0 && Date.now() - pulseAt < 2500;
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="section-label">{t("explorer.tabLive")}</span>
          <span className={cn(
            "tag tag-green inline-flex items-center gap-1.5",
            paused && "opacity-50",
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full bg-current", !paused && "pulse-dot")} />
            {paused ? t("explorer.livePaused") : t("explorer.liveActive")}
          </span>
          {recent && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="inline-flex items-center gap-1 font-mono text-[9px] text-cyan tracking-widest uppercase"
            >
              <Activity className="w-2.5 h-2.5" />
              {t("explorer.liveNew")}
            </motion.span>
          )}
        </div>
        <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink leading-tight">
          {t("explorer.liveTitle")}
        </h1>
        <p className="font-sans text-xs sm:text-sm text-ink-3 leading-relaxed mt-1 max-w-2xl">
          {t("explorer.liveBody")}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border font-mono text-[10px] tracking-widest uppercase transition-colors",
            paused
              ? "border-cyan/30 bg-cyan/[0.06] text-cyan hover:bg-cyan/[0.10]"
              : "border-gold/30 bg-gold/[0.04] text-gold hover:bg-gold/[0.08]",
          )}
        >
          {paused ? t("explorer.resume") : t("explorer.pause")}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border font-mono text-[10px] tracking-widest uppercase border-cyan/20 bg-cyan/[0.05] text-cyan hover:bg-cyan/[0.10]",
            loading && "opacity-50 cursor-not-allowed",
          )}
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          {loading ? t("explorer.loading") : t("explorer.refresh")}
        </button>
      </div>
    </div>
  );
}

// ─── Row ───────────────────────────────────────────────────────────────

function FeedRow({ pool }: { pool: Pool }) {
  const ageMs = pool.createdAtMs ? Date.now() - pool.createdAtMs : null;
  const ageLabel =
    ageMs === null      ? "—"                                        :
    ageMs < 60_000      ? `${Math.round(ageMs / 1_000)}s`            :
    ageMs < 3_600_000   ? `${Math.round(ageMs / 60_000)}m`           :
    ageMs < 86_400_000  ? `${Math.round(ageMs / 3_600_000)}h`        :
                          `${Math.round(ageMs / 86_400_000)}d`;
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
      // @ts-expect-error — framer's discriminated union doesn't carry through dynamic element
      href={href}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y:  0 }}
      exit={{    opacity: 0, x: -8 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "flex items-center gap-3 px-3 sm:px-4 py-2.5 min-w-0",
        href && "hover:bg-white/[0.03] transition-colors cursor-pointer",
      )}
    >
      {/* Age chip */}
      <div
        className="font-mono text-[10px] tracking-widest uppercase tabular-nums px-1.5 py-0.5 rounded border flex-shrink-0"
        style={{
          background:  ageMs !== null && ageMs < 600_000 ? "#27D49B14" : "transparent",
          borderColor: ageMs !== null && ageMs < 600_000 ? "#27D49B40" : "rgba(255,255,255,0.08)",
          color:       ageMs !== null && ageMs < 600_000 ? "#27D49B"   : "var(--ink-3, #888)",
        }}
      >
        {ageLabel}
      </div>

      {/* Chain chip */}
      {chainMeta && (
        <span
          className="font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded border flex-shrink-0"
          style={{ borderColor: `${chainMeta.color}40`, background: `${chainMeta.color}10`, color: chainMeta.color }}
        >
          {chainMeta.short}
        </span>
      )}

      {/* Pair + dex */}
      <div className="min-w-0 flex-1">
        <div className="font-display font-bold text-sm text-ink truncate">
          {pool.baseSymbol}
          <span className="text-ink-4"> / </span>
          <span className="text-ink-2">{pool.quoteSymbol}</span>
        </div>
        <div className="font-mono text-[10px] text-ink-3 truncate">
          via {pool.dex}
          {" · "}
          Liq ${compactNumber(pool.tvlUsd)}
          {pool.volume24h > 0 && (
            <>
              {" · "}Vol ${compactNumber(pool.volume24h)}
            </>
          )}
        </div>
      </div>

      {/* Price + change */}
      <div className="text-right flex-shrink-0">
        <div className="font-mono text-[11px] text-ink tabular-nums">
          {pool.priceUsd > 0
            ? `$${pool.priceUsd < 0.0001 ? pool.priceUsd.toExponential(2) : pool.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 6 })}`
            : "—"}
        </div>
        {pool.change24h !== 0 && (
          <div className={cn(
            "inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums",
            up ? "text-green" : "text-red",
          )}>
            {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {up ? "+" : ""}{pool.change24h.toFixed(2)}%
          </div>
        )}
      </div>
    </Row>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/30 divide-y divide-white/[0.04] overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 sm:px-4 py-2.5">
          <div className="w-10 h-4 bg-white/5 rounded animate-pulse" />
          <div className="w-10 h-4 bg-white/5 rounded animate-pulse" />
          <div className="flex-1 space-y-1">
            <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
            <div className="h-3 w-40 bg-white/5 rounded animate-pulse" />
          </div>
          <div className="space-y-1 text-right">
            <div className="h-4 w-16 bg-white/5 rounded animate-pulse ml-auto" />
            <div className="h-3 w-12 bg-white/5 rounded animate-pulse ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Slug mapping ──────────────────────────────────────────────────────

function networkToChain(network: string): ChainId | null {
  const m: Record<string, ChainId> = {
    eth:         "ethereum",
    bsc:         "bsc",
    polygon_pos: "polygon",
    base:        "base",
    arbitrum:    "arbitrum",
    optimism:    "optimism",
    avax:        "avalanche",
    zksync:      "zksync",
    linea:       "linea",
    solana:      "solana",
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

// Globe kept for future use (chain-of-origin row badge)
void Globe;
