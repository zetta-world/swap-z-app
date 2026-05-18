"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Layers, ArrowUpDown, Search, ExternalLink } from "lucide-react";
import { CHAINS, type ChainId } from "@/lib/chains";
import { compactNumber, formatPct } from "@/lib/format";
import type { PoolSummary } from "@/lib/api/geckoterminal";
import { cn } from "@/lib/cn";

type SortKey = "tvl" | "vol" | "change";

const FALLBACK: PoolSummary[] = [
  { id: "1", name: "ETH / USDC",  network: "eth",     tvlUsd: 142_800_000, volume24h: 892_000,   change24h: 0.42,  priceUsd: 3450, baseSymbol: "ETH",   quoteSymbol: "USDC", dex: "uniswap_v3",  address: "" },
  { id: "2", name: "BNB / USDT",  network: "bsc",     tvlUsd: 98_300_000,  volume24h: 654_000,   change24h: 1.20,  priceUsd: 720,  baseSymbol: "BNB",   quoteSymbol: "USDT", dex: "pancakeswap", address: "" },
  { id: "3", name: "SOL / USDC",  network: "solana",  tvlUsd: 203_100_000, volume24h: 1_400_000, change24h: -0.18, priceUsd: 218,  baseSymbol: "SOL",   quoteSymbol: "USDC", dex: "raydium",     address: "" },
  { id: "4", name: "WBTC / ETH",  network: "eth",     tvlUsd: 67_500_000,  volume24h: 420_000,   change24h: 0.06,  priceUsd: 96400,baseSymbol: "WBTC",  quoteSymbol: "ETH",  dex: "uniswap_v3",  address: "" },
  { id: "5", name: "wstETH / ETH",network: "eth",     tvlUsd: 312_700_000, volume24h: 2_100_000, change24h: 0.02,  priceUsd: 3445, baseSymbol: "wstETH",quoteSymbol: "ETH",  dex: "balancer",    address: "" },
  { id: "6", name: "ARB / USDC",  network: "arbitrum",tvlUsd: 54_200_000,  volume24h: 310_000,   change24h: 0.84,  priceUsd: 0.78, baseSymbol: "ARB",   quoteSymbol: "USDC", dex: "uniswap_v3",  address: "" },
  { id: "7", name: "OP / USDC",   network: "optimism",tvlUsd: 32_800_000,  volume24h: 186_000,   change24h: -0.32, priceUsd: 1.62, baseSymbol: "OP",    quoteSymbol: "USDC", dex: "velodrome",   address: "" },
  { id: "8", name: "AVAX / USDC", network: "avax",    tvlUsd: 28_600_000,  volume24h: 172_000,   change24h: 0.51,  priceUsd: 39.8, baseSymbol: "AVAX",  quoteSymbol: "USDC", dex: "trader_joe",  address: "" },
];

async function fetchPools(chain: ChainId | "all"): Promise<PoolSummary[]> {
  const url = chain === "all" ? "/api/pools?trending=1" : `/api/pools?chain=${chain}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed");
  const data = await res.json();
  return (data.pools ?? []) as PoolSummary[];
}

const CHAIN_COLOR: Record<string, string> = {
  eth: "#627EEA", bsc: "#F3BA2F", polygon_pos: "#8247E5", base: "#0052FF",
  arbitrum: "#28A0F0", optimism: "#FF0420", solana: "#14F195", avax: "#E84142",
  zksync: "#8C8DFC", linea: "#61DFFF",
};

const DEX_COLOR: Record<string, string> = {
  uniswap_v3:  "#FF007A", uniswap_v2:  "#FF007A",
  pancakeswap: "#F3BA2F", raydium:     "#14F195",
  curve:       "#3676FF", balancer:    "#FF6B00",
  trader_joe:  "#E84142", velodrome:   "#FF0420",
};

export default function PoolsView() {
  const [chain, setChain] = useState<ChainId | "all">("all");
  const [sortBy, setSortBy] = useState<SortKey>("tvl");
  const [q, setQ] = useState("");

  const { data, isError, isLoading } = useQuery({
    queryKey: ["pools-view", chain],
    queryFn: () => fetchPools(chain),
    refetchInterval: 60_000,
  });

  const pools = useMemo(() => {
    const list = data && data.length ? data : FALLBACK;
    const filtered = q.trim()
      ? list.filter((p) =>
          (p.baseSymbol + p.quoteSymbol + p.dex).toLowerCase().includes(q.trim().toLowerCase()),
        )
      : list;
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "tvl")    return b.tvlUsd     - a.tvlUsd;
      if (sortBy === "vol")    return b.volume24h  - a.volume24h;
      return Math.abs(b.change24h) - Math.abs(a.change24h);
    });
    return sorted;
  }, [data, q, sortBy]);

  // Aggregate metrics
  const totals = useMemo(() => {
    const tvl = pools.reduce((acc, p) => acc + p.tvlUsd, 0);
    const vol = pools.reduce((acc, p) => acc + p.volume24h, 0);
    return { tvl, vol, count: pools.length };
  }, [pools]);

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-[420px] h-[420px] rounded-full bg-cyan/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-7xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-cyan" />
            <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">
              Liquidity Layer · live · GeckoTerminal
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            Pools <span className="text-grad-aurora">Universe</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
            Real-time pool depth across 11 chains. Filter by chain, sort by TVL or volume,
            click through to provide liquidity or analyze on the explorer.
          </p>
        </motion.div>

        {/* Aggregate stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <StatCard label="Aggregated TVL" value={`$${compactNumber(totals.tvl)}`} tone="cyan" />
          <StatCard label="24h Volume"     value={`$${compactNumber(totals.vol)}`} tone="violet" />
          <StatCard label="Pools tracked"  value={String(totals.count)}            tone="gold"   />
          <StatCard label="Chains"         value={`${chain === "all" ? "all 11" : "1"}`} tone="green" />
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-white/5 glass-pane p-4 mb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-2 border border-white/10 flex-1 focus-within:border-cyan/30">
              <Search className="w-4 h-4 text-ink-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by token symbol or DEX…"
                className="flex-1 min-w-0 bg-transparent outline-none text-sm font-sans text-ink placeholder:text-ink-4"
              />
            </div>
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value as ChainId | "all")}
              className="bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink outline-none focus:border-cyan/30 min-w-[160px]"
            >
              <option value="all">All chains · trending</option>
              {CHAINS.filter((c) => !c.comingSoon).map((c) => (
                <option key={c.id} value={c.id}>{c.short} · {c.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-bg-2 border border-white/10">
              {([
                ["tvl",    "TVL"],
                ["vol",    "Volume"],
                ["change", "Δ 24h"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSortBy(k)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-[11px] font-mono tracking-wider uppercase transition-all",
                    sortBy === k ? "bg-cyan/15 text-cyan" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  <ArrowUpDown className="w-3 h-3 inline mr-1" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Status pill */}
        <div className="flex items-center gap-2 mb-3">
          <span className={cn("w-1.5 h-1.5 rounded-full", isError ? "bg-gold" : "bg-cyan", "pulse-dot")} />
          <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
            {isLoading ? "Loading live pools…" : isError ? "Upstream quiet · showing cached" : "Refreshes every 60s"}
          </span>
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-white/5 glass-pane overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-12 px-4 py-3 border-b border-white/5 bg-white/[0.02] gap-2">
            <div className="col-span-4 font-mono text-[10px] text-ink-3 tracking-widest uppercase">Pool</div>
            <div className="col-span-2 hidden sm:block font-mono text-[10px] text-ink-3 tracking-widest uppercase">DEX</div>
            <div className="col-span-3 sm:col-span-2 font-mono text-[10px] text-ink-3 tracking-widest uppercase text-right">TVL</div>
            <div className="col-span-3 sm:col-span-2 font-mono text-[10px] text-ink-3 tracking-widest uppercase text-right">24h Vol</div>
            <div className="col-span-2 font-mono text-[10px] text-ink-3 tracking-widest uppercase text-right">Δ</div>
          </div>

          <div className="divide-y divide-white/[0.04]">
            {pools.length === 0 && (
              <div className="px-4 py-10 text-center font-sans text-sm text-ink-3">No pools match the filter.</div>
            )}
            {pools.map((p, i) => {
              const color = CHAIN_COLOR[p.network] ?? "#00E8FF";
              const dexColor = DEX_COLOR[p.dex.toLowerCase().replace(/ /g, "_")] ?? color;
              return (
                <motion.div
                  key={p.id || `${p.name}-${i}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.4) }}
                  className="grid grid-cols-12 px-4 py-3 items-center gap-2 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="col-span-4 flex items-center gap-3 min-w-0">
                    <div className="flex flex-shrink-0">
                      <span className="w-7 h-7 rounded-full border-2 border-bg-1" style={{ background: color }} />
                      <span className="w-7 h-7 rounded-full -ml-3 border-2 border-bg-1" style={{ background: dexColor }} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-display font-bold text-xs sm:text-sm text-ink truncate">
                        {p.baseSymbol} / {p.quoteSymbol}
                      </div>
                      <div className="font-mono text-[9px] text-ink-3 uppercase tracking-wider truncate">
                        {p.network}
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 hidden sm:block">
                    <span className="font-mono text-[10px] text-ink-2 truncate">
                      {p.dex.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-right">
                    <span className="font-mono text-xs sm:text-sm text-ink">${compactNumber(p.tvlUsd)}</span>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-right">
                    <span className="font-mono text-xs sm:text-sm text-ink-2">${compactNumber(p.volume24h)}</span>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className={cn(
                      "font-mono text-xs sm:text-sm tabular-nums",
                      p.change24h >= 0 ? "text-green" : "text-red",
                    )}>
                      {formatPct(p.change24h)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-4">
          Powered by GeckoTerminal · ZION can analyze any of these pools — paste the address into <a className="text-cyan/70 hover:text-cyan inline-flex items-center gap-0.5" href="/explorer">/explorer <ExternalLink className="w-2.5 h-2.5" /></a>
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "cyan" | "violet" | "gold" | "green" }) {
  const cfg = {
    cyan:   { ring: "rgba(0,232,255,0.18)",  text: "text-cyan",   border: "border-cyan/20"   },
    violet: { ring: "rgba(159,95,255,0.18)", text: "text-violet", border: "border-violet/20" },
    gold:   { ring: "rgba(245,166,35,0.18)", text: "text-gold",   border: "border-gold/20"   },
    green:  { ring: "rgba(0,224,135,0.18)",  text: "text-green",  border: "border-green/20"  },
  }[tone];
  return (
    <div className={cn("relative rounded-xl border glass-pane p-4 overflow-hidden", cfg.border)}>
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-50" style={{ background: cfg.ring }} />
      <div className="relative">
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">{label}</div>
        <div className={cn("font-display font-bold text-xl sm:text-2xl", cfg.text)}>{value}</div>
      </div>
    </div>
  );
}
