"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Flame, ExternalLink } from "lucide-react";
import type { TrendingPair } from "@/lib/api/dexscreener";
import { formatUsd, formatPct } from "@/lib/format";
import { useT, t as tImp } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface TrendingResponse { pairs: TrendingPair[]; ts: number; }

async function fetchTrending(): Promise<TrendingPair[]> {
  const res = await fetch("/api/trending");
  if (!res.ok) throw new Error(tImp("swap.topMoversError"));
  const data = (await res.json()) as TrendingResponse;
  return data.pairs ?? [];
}

// Chain metadata: color + logo
const CHAIN_META: Record<string, { color: string; logo: string }> = {
  ethereum:  { color: "#627EEA", logo: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  bsc:       { color: "#F3BA2F", logo: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" },
  polygon:   { color: "#8247E5", logo: "https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png" },
  base:      { color: "#0052FF", logo: "https://assets.coingecko.com/asset_platforms/images/131/small/base-network.png" },
  arbitrum:  { color: "#28A0F0", logo: "https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg" },
  optimism:  { color: "#FF0420", logo: "https://assets.coingecko.com/coins/images/25244/small/Optimism.png" },
  avalanche: { color: "#E84142", logo: "https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png" },
  solana:    { color: "#14F195", logo: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
};

// ─── Token avatar + chain badge ─────────────────────────────────────────
function PairAvatar({ symbol, chain, color }: { symbol: string; chain: string; color: string }) {
  const [tokenFailed, setTokenFailed] = useState(false);
  const [chainFailed, setChainFailed] = useState(false);
  const chainMeta = CHAIN_META[chain];

  const tokenLogoUrl = `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/icon/${symbol.toLowerCase()}.png`;

  return (
    <div className="relative flex-shrink-0 w-10 h-10">
      {/* Token logo */}
      {!tokenFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tokenLogoUrl}
          alt={symbol}
          width={40}
          height={40}
          onError={() => setTokenFailed(true)}
          className="w-10 h-10 rounded-full object-cover ring-1 ring-white/10"
        />
      ) : (
        <span
          className="w-10 h-10 rounded-full flex items-center justify-center font-display font-extrabold text-sm ring-1 ring-white/10"
          style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}
        >
          {symbol.slice(0, 2).toUpperCase()}
        </span>
      )}

      {/* Chain badge overlay */}
      {chainMeta && !chainFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={chainMeta.logo}
          alt={chain}
          width={16}
          height={16}
          onError={() => setChainFailed(true)}
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ring-2 ring-bg object-cover"
        />
      )}
      {chainMeta && chainFailed && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ring-2 ring-bg flex items-center justify-center font-mono text-[7px] font-bold"
          style={{ background: chainMeta.color }}
        >
          {chain.slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default function TopMovers() {
  const t = useT();
  const { data, isError, isLoading } = useQuery({
    queryKey: ["top-movers"],
    queryFn: fetchTrending,
    refetchInterval: 90_000,
    retry: 1,
  });

  const movers = data && data.length > 0 ? data.slice(0, 7) : [];

  return (
    <div className="rounded-2xl border border-white/5 bg-bg-1/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/5">
        <Flame className="w-3.5 h-3.5 text-gold" />
        <span className="font-display font-extrabold text-sm text-ink">
          {t("swap.topMoversTitle")}
        </span>
        <span
          className={cn(
            "ml-auto font-mono text-[9px] px-2 py-0.5 rounded-full border tracking-widest uppercase",
            isLoading ? "border-white/8 bg-white/[0.03] text-ink-3"
              : isError ? "border-red/20 bg-red/[0.05] text-red/70"
              : "border-green/20 bg-green/[0.05] text-green/80",
          )}
        >
          {isLoading ? t("explorer.loading") : isError ? t("common.offline") : t("explorer.liveActive")}
        </span>
      </div>

      {/* Empty / loading state */}
      {movers.length === 0 && (
        <div className="px-4 py-8 text-center font-mono text-[11px] text-ink-3">
          {isLoading ? t("explorer.loading") : isError ? t("swap.topMoversError") : t("swap.topMoversEmpty")}
        </div>
      )}

      {/* Rows */}
      <div className="divide-y divide-white/[0.03]">
        {movers.map((m, i) => {
          const meta     = CHAIN_META[m.chain];
          const color    = meta?.color ?? "#00E8FF";
          const positive = m.change24h >= 0;

          return (
            <motion.a
              key={m.pairAddress || m.symbol + i}
              href={m.url || undefined}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, ease: "easeOut" }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.025] active:bg-white/[0.04] transition-colors group"
            >
              <PairAvatar symbol={m.baseSymbol} chain={m.chain} color={color} />

              {/* Symbol + chain/dex */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-display font-bold text-[13px] text-ink truncate leading-tight">
                    {m.baseSymbol}
                  </span>
                  <span className="font-mono text-[10px] text-ink-3 truncate">
                    /{m.quoteSymbol}
                  </span>
                  <ExternalLink className="w-2.5 h-2.5 text-ink-4 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {/* Chain pill */}
                  <span
                    className="font-mono text-[9px] px-1.5 py-0.5 rounded-md uppercase tracking-wider flex-shrink-0"
                    style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}
                  >
                    {m.chain}
                  </span>
                  {m.volume24h > 0 && (
                    <span className="font-mono text-[9px] text-ink-4">
                      Vol {formatVolume(m.volume24h)}
                    </span>
                  )}
                </div>
              </div>

              {/* Price + change */}
              <div className="text-right flex-shrink-0">
                <div className="font-display font-bold text-[13px] text-ink tabular-nums">
                  {formatUsd(m.priceUsd)}
                </div>
                <div
                  className={cn(
                    "flex items-center justify-end gap-0.5 font-mono text-[10px] tabular-nums mt-0.5",
                    positive ? "text-green" : "text-red",
                  )}
                >
                  {positive
                    ? <TrendingUp className="w-2.5 h-2.5" />
                    : <TrendingDown className="w-2.5 h-2.5" />}
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
