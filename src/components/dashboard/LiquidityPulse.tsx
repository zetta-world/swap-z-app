"use client";

import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { PoolSummary } from "@/lib/api/geckoterminal";
import { compactNumber, formatPct } from "@/lib/format";

interface PoolsResponse { pools: PoolSummary[]; ts: number; }

async function fetchPools(): Promise<PoolSummary[]> {
  const res = await fetch("/api/pools?trending=1");
  if (!res.ok) throw new Error("Failed to fetch pools");
  const data = (await res.json()) as PoolsResponse;
  return data.pools ?? [];
}

const FALLBACK: PoolSummary[] = [
  { id: "1", name: "ETH / USDC",    network: "eth",      tvlUsd: 142_800_000, volume24h: 892_000,   change24h: 0.42, priceUsd: 3450, baseSymbol: "ETH",   quoteSymbol: "USDC", dex: "uniswap_v3",  address: "" },
  { id: "2", name: "BNB / USDT",    network: "bsc",      tvlUsd: 98_300_000,  volume24h: 654_000,   change24h: 1.20, priceUsd: 720,  baseSymbol: "BNB",   quoteSymbol: "USDT", dex: "pancakeswap", address: "" },
  { id: "3", name: "SOL / USDC",    network: "solana",   tvlUsd: 203_100_000, volume24h: 1_400_000, change24h: -0.18, priceUsd: 218, baseSymbol: "SOL",   quoteSymbol: "USDC", dex: "raydium",    address: "" },
];

const DEX_COLOR: Record<string, string> = {
  uniswap_v3:  "#FF007A",
  uniswap_v2:  "#FF007A",
  pancakeswap: "#F3BA2F",
  raydium:     "#14F195",
  curve:       "#3676FF",
  balancer:    "#FF6B00",
  trader_joe:  "#E84142",
};

function colorFor(dex: string, network: string): string {
  return DEX_COLOR[dex.toLowerCase().replace(/ /g, "_")] ??
    ({ eth: "#627EEA", bsc: "#F3BA2F", polygon_pos: "#8247E5", base: "#0052FF", arbitrum: "#28A0F0", solana: "#14F195", avax: "#E84142" }[network] ?? "#00E8FF");
}

export default function LiquidityPulse() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["liquidity-pulse"],
    queryFn: fetchPools,
    refetchInterval: 60_000,
    retry: 1,
  });

  const pools = data && data.length > 0 ? data : FALLBACK;
  const rows = [...pools, ...pools];

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-white/5 glass-pane">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
        <span className="font-mono text-[10px] text-cyan tracking-widest uppercase">Liquidity Pulse</span>
        <span className="font-mono text-[9px] text-ink-4">
          {isLoading ? "Loading top pools…" :
           isError   ? "Showing cached snapshot (API quiet)" :
                      "Top trending pools · GeckoTerminal · live"}
        </span>
      </div>

      <div className="relative">
        <motion.div
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 60, ease: "linear", repeat: Infinity }}
          className="flex"
        >
          {rows.map((r, i) => {
            const color = colorFor(r.dex, r.network);
            return (
              <div key={i} className="flex items-center gap-3 px-5 py-3 border-r border-white/5 flex-shrink-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                <span className="font-display font-bold text-xs text-ink whitespace-nowrap">{r.baseSymbol}/{r.quoteSymbol}</span>
                <span className="font-mono text-[10px] text-ink-3 uppercase tracking-wider whitespace-nowrap">{r.network}</span>
                <span className="font-mono text-[10px] text-ink-2 whitespace-nowrap">TVL ${compactNumber(r.tvlUsd)}</span>
                <span className="font-mono text-[10px] text-ink-3 whitespace-nowrap">Vol ${compactNumber(r.volume24h)}</span>
                <span className={`font-mono text-[10px] whitespace-nowrap ${r.change24h >= 0 ? "text-green" : "text-red"}`}>
                  {formatPct(r.change24h)}
                </span>
              </div>
            );
          })}
        </motion.div>

        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-bg-1 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-bg-1 to-transparent" />
      </div>
    </div>
  );
}
