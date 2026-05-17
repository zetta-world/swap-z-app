"use client";

import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Flame } from "lucide-react";
import type { TrendingPair } from "@/lib/api/dexscreener";
import { formatUsd, formatPct } from "@/lib/format";

interface TrendingResponse { pairs: TrendingPair[]; ts: number; }

async function fetchTrending(): Promise<TrendingPair[]> {
  const res = await fetch("/api/trending");
  if (!res.ok) throw new Error("Failed to fetch trending");
  const data = (await res.json()) as TrendingResponse;
  return data.pairs ?? [];
}

const FALLBACK: TrendingPair[] = [
  { chain: "solana",   dex: "raydium",     symbol: "WIF/SOL",   baseSymbol: "WIF",   quoteSymbol: "SOL",  priceUsd: 1.86,  change24h: 18.4, volume24h: 0, liquidity: 0, marketCap: 0, url: "", baseAddress: "", pairAddress: "wif1" },
  { chain: "solana",   dex: "raydium",     symbol: "JUP/USDC",  baseSymbol: "JUP",   quoteSymbol: "USDC", priceUsd: 0.95,  change24h: 9.2,  volume24h: 0, liquidity: 0, marketCap: 0, url: "", baseAddress: "", pairAddress: "jup1" },
  { chain: "arbitrum", dex: "uniswap_v3",  symbol: "GMX/ETH",   baseSymbol: "GMX",   quoteSymbol: "ETH",  priceUsd: 24.6,  change24h: 7.1,  volume24h: 0, liquidity: 0, marketCap: 0, url: "", baseAddress: "", pairAddress: "gmx1" },
];

const CHAIN_COLOR: Record<string, string> = {
  ethereum: "#627EEA", bsc: "#F3BA2F", polygon: "#8247E5", base: "#0052FF",
  arbitrum: "#28A0F0", optimism: "#FF0420", solana: "#14F195", avalanche: "#E84142",
};

export default function TopMovers() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["top-movers"],
    queryFn: fetchTrending,
    refetchInterval: 90_000,
    retry: 1,
  });

  const movers = data && data.length > 0 ? data.slice(0, 7) : FALLBACK;

  return (
    <div className="rounded-xl border border-white/5 glass-pane overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <Flame className="w-3.5 h-3.5 text-gold" />
        <span className="font-display font-bold text-sm text-ink">Hot Movers</span>
        <span className="ml-auto font-mono text-[9px] text-ink-4 tracking-widest uppercase">
          {isLoading ? "loading" : isError ? "cached" : "24h live"}
        </span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {movers.map((m, i) => {
          const color = CHAIN_COLOR[m.chain] ?? "#00E8FF";
          const positive = m.change24h >= 0;
          return (
            <motion.a
              key={m.pairAddress || m.symbol + i}
              href={m.url || undefined}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-[10px] font-bold flex-shrink-0"
                style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
              >
                {m.baseSymbol.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-xs text-ink truncate">{m.symbol}</div>
                <div className="font-mono text-[9px] text-ink-3 uppercase tracking-wider truncate">{m.chain} · {m.dex.replace(/_/g, " ")}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs text-ink">{formatUsd(m.priceUsd)}</div>
                <div className={`flex items-center justify-end gap-0.5 font-mono text-[10px] ${positive ? "text-green" : "text-red"}`}>
                  {positive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {formatPct(m.change24h)}
                </div>
              </div>
            </motion.a>
          );
        })}
      </div>
    </div>
  );
}
