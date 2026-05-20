"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, TrendingUp, TrendingDown, ExternalLink, Eye, EyeOff } from "lucide-react";
import { CHAINS } from "@/lib/chains";
import { compactNumber, formatUsd, formatPct } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Holding {
  symbol: string;
  name:   string;
  chain:  string;
  qty:    number;
  priceUsd: number;
  change24h: number;
  color:  string;
}

const MOCK_HOLDINGS: Holding[] = [
  { symbol: "ETH",  name: "Ethereum",       chain: "ethereum", qty: 2.4,       priceUsd: 3450,  change24h: 0.42,  color: "#627EEA" },
  { symbol: "USDC", name: "USD Coin",       chain: "ethereum", qty: 4_280,     priceUsd: 1.00,  change24h: 0.01,  color: "#2775CA" },
  { symbol: "wstETH", name: "Lido stETH",   chain: "ethereum", qty: 0.8,       priceUsd: 3445,  change24h: 0.02,  color: "#00A3FF" },
  { symbol: "WBTC", name: "Wrapped BTC",    chain: "ethereum", qty: 0.035,     priceUsd: 96400, change24h: -0.18, color: "#F7931A" },
  { symbol: "BNB",  name: "BNB",            chain: "bsc",      qty: 4.5,       priceUsd: 720,   change24h: 1.20,  color: "#F3BA2F" },
  { symbol: "Z",    name: "ZETTA Token",    chain: "bsc",      qty: 124_000,   priceUsd: 0.0084,change24h: 4.10,  color: "#00E8FF" },
  { symbol: "ARB",  name: "Arbitrum",       chain: "arbitrum", qty: 1_240,     priceUsd: 0.78,  change24h: 0.84,  color: "#28A0F0" },
  { symbol: "SOL",  name: "Solana",         chain: "solana",   qty: 18.4,      priceUsd: 218,   change24h: -0.18, color: "#14F195" },
  { symbol: "JUP",  name: "Jupiter",        chain: "solana",   qty: 1_820,     priceUsd: 0.95,  change24h: 9.2,   color: "#FBA124" },
];

interface Position {
  protocol: string; pair: string; chain: string; valueUsd: number; apr: number; color: string;
}

const MOCK_POSITIONS: Position[] = [
  { protocol: "Uniswap V3",  pair: "ETH/USDC 0.05%",  chain: "ethereum", valueUsd: 8_240,  apr: 14.2, color: "#FF007A" },
  { protocol: "Curve",       pair: "3pool",            chain: "ethereum", valueUsd: 5_120,  apr: 6.8,  color: "#3676FF" },
  { protocol: "Trader Joe",  pair: "AVAX/USDC v2.1",  chain: "avalanche", valueUsd: 2_840,  apr: 22.4, color: "#E84142" },
];

interface Tx {
  ts: string; type: "swap" | "bridge" | "lp" | "stake";
  description: string; chain: string; amount: string; positive: boolean;
}

const MOCK_TXS: Tx[] = [
  { ts: "2 min ago",   type: "swap",   description: "ETH → USDC",       chain: "ethereum", amount: "+3,448 USDC", positive: true  },
  { ts: "1h ago",      type: "bridge", description: "USDC → ARB",       chain: "arbitrum", amount: "−500 USDC",   positive: false },
  { ts: "5h ago",      type: "lp",     description: "Add LP wstETH/ETH",chain: "ethereum", amount: "+0.8 wstETH", positive: false },
  { ts: "yesterday",   type: "stake",  description: "Stake ZETTA",      chain: "bsc",      amount: "−10,000 Z",   positive: false },
  { ts: "2 days ago",  type: "swap",   description: "JUP → SOL",        chain: "solana",   amount: "+8.2 SOL",    positive: true  },
];

const TX_KIND: Record<string, string> = {
  swap: "Swap", bridge: "Bridge", lp: "Liquidity", stake: "Stake",
};

export default function PortfolioView() {
  const [hidden, setHidden] = useState(false);

  const totals = useMemo(() => {
    const portfolio = MOCK_HOLDINGS.reduce((acc, h) => acc + h.qty * h.priceUsd, 0);
    const positions = MOCK_POSITIONS.reduce((acc, p) => acc + p.valueUsd, 0);
    const total = portfolio + positions;
    // mocked rollup
    const change24h = 2.4;       // %
    const changeUsd = total * (change24h / 100);
    return { portfolio, positions, total, change24h, changeUsd };
  }, []);

  // Aggregate per chain for chart
  const byChain = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of MOCK_HOLDINGS) {
      const v = h.qty * h.priceUsd;
      map.set(h.chain, (map.get(h.chain) ?? 0) + v);
    }
    for (const p of MOCK_POSITIONS) {
      map.set(p.chain, (map.get(p.chain) ?? 0) + p.valueUsd);
    }
    const arr = [...map.entries()]
      .map(([id, v]) => ({ id, value: v, chain: CHAINS.find((c) => c.id === id) }))
      .sort((a, b) => b.value - a.value);
    return arr;
  }, []);

  const mask = (v: string) => (hidden ? "•••••" : v);

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-32 right-1/4 w-[420px] h-[420px] rounded-full bg-green/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-cyan" />
            <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">
              Multi-chain portfolio · demo wallet snapshot
            </span>
          </div>

          {/* Disclosure banner */}
          <div className="rounded-xl border border-gold/20 bg-gold/[0.04] p-3 mb-4 flex items-start gap-2.5">
            <Wallet className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] text-gold tracking-widest uppercase mb-0.5">Demo data</div>
              <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
                Real multi-chain holdings require a token-balance API (Alchemy / Zerion / Covalent).
                Numbers below are illustrative. Native + ERC-20 balances on the connected chain are
                already live in the Swap card; this dashboard ships in the next sprint with the
                full multi-chain indexer wired up.
              </p>
            </div>
          </div>
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
                Portfolio <span className="text-grad-aurora">snapshot</span>
              </h1>
              <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
                Balances, positions and P&amp;L unified across 11 chains.
                ZION watches each holding and flags structural risk changes.
              </p>
            </div>
            <button
              onClick={() => setHidden((h) => !h)}
              className="btn btn-secondary py-2 text-xs"
            >
              {hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {hidden ? "Show balances" : "Hide balances"}
            </button>
          </div>
        </motion.div>

        {/* Net worth card */}
        <div className="aurora-border p-px mb-5">
          <div className="rounded-[20px] glass p-5 sm:p-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">Total Net Worth</div>
                <div className="font-display font-extrabold text-3xl sm:text-4xl text-ink">{mask(formatUsd(totals.total))}</div>
                <div className={cn("flex items-center gap-1.5 mt-1.5 font-mono text-xs", totals.change24h >= 0 ? "text-green" : "text-red")}>
                  {totals.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {hidden ? "•••" : `${formatUsd(totals.changeUsd)} (${formatPct(totals.change24h)}) · 24h`}
                </div>
              </div>
              <Metric label="Wallet balance"  value={mask(formatUsd(totals.portfolio))} tone="cyan" />
              <Metric label="LP positions"    value={mask(formatUsd(totals.positions))} tone="violet" />
              <Metric label="Chains tracked"  value={String(byChain.length)}            tone="gold" />
            </div>

            {/* Chain distribution bar */}
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Distribution by chain</span>
                <span className="font-mono text-[10px] text-cyan tracking-widest uppercase flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
                  Live
                </span>
              </div>
              <div className="flex h-3 rounded-full overflow-hidden bg-white/[0.03]">
                {byChain.map((c) => (
                  <div
                    key={c.id}
                    title={`${c.chain?.name}: ${formatUsd(c.value)}`}
                    className="hover:brightness-125 transition-all"
                    style={{
                      width:  `${(c.value / totals.total) * 100}%`,
                      background: c.chain?.color ?? "#00E8FF",
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
                {byChain.map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.chain?.color }} />
                    <span className="font-mono text-[10px] text-ink-2">{c.chain?.short}</span>
                    <span className="font-mono text-[10px] text-ink-4">{((c.value / totals.total) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Holdings */}
          <div className="lg:col-span-7 rounded-2xl border border-white/5 glass-pane overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <span className="font-display font-bold text-sm text-ink">Holdings</span>
              <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">{MOCK_HOLDINGS.length} assets</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {MOCK_HOLDINGS.map((h) => {
                const value = h.qty * h.priceUsd;
                return (
                  <div key={h.symbol + h.chain} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center font-mono text-[11px] font-bold flex-shrink-0"
                      style={{ background: `${h.color}22`, color: h.color, border: `1px solid ${h.color}55` }}
                    >
                      {h.symbol.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm text-ink truncate">{h.symbol}</div>
                      <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider truncate">{h.chain}</div>
                    </div>
                    <div className="text-right min-w-0">
                      <div className="font-mono text-sm text-ink">{mask(formatUsd(value))}</div>
                      <div className="font-mono text-[10px] text-ink-3 truncate">
                        {hidden ? "•••••" : `${compactNumber(h.qty)} ${h.symbol}`}
                      </div>
                    </div>
                    <div className="text-right w-16">
                      <div className={cn("font-mono text-xs", h.change24h >= 0 ? "text-green" : "text-red")}>
                        {formatPct(h.change24h)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right column: positions + tx history */}
          <div className="lg:col-span-5 space-y-4">
            {/* LP positions */}
            <div className="rounded-2xl border border-white/5 glass-pane overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                <span className="font-display font-bold text-sm text-ink">LP positions</span>
                <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">{MOCK_POSITIONS.length} active</span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {MOCK_POSITIONS.map((p, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-display font-bold text-xs text-ink">{p.pair}</span>
                      <span className="font-mono text-xs text-green">{p.apr.toFixed(1)}% APR</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{p.protocol} · {p.chain}</span>
                      <span className="font-mono text-xs text-ink-2">{mask(formatUsd(p.valueUsd))}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Activity */}
            <div className="rounded-2xl border border-white/5 glass-pane overflow-hidden">
              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                <span className="font-display font-bold text-sm text-ink">Recent activity</span>
                <a href="#" className="font-mono text-[9px] text-cyan/70 hover:text-cyan tracking-widest uppercase inline-flex items-center gap-0.5">
                  All <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {MOCK_TXS.map((t, i) => (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[9px] text-ink-3 uppercase tracking-widest">{TX_KIND[t.type]}</span>
                        <span className="font-display font-bold text-xs text-ink truncate">{t.description}</span>
                      </div>
                      <span className={cn("font-mono text-xs", t.positive ? "text-green" : "text-ink-2")}>{hidden ? "•••" : t.amount}</span>
                    </div>
                    <div className="font-mono text-[10px] text-ink-4 tracking-widest uppercase">{t.ts} · {t.chain}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-6">
          Demo wallet · real connection lands with wagmi v2 + viem in Sprint 3
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "cyan" | "violet" | "gold" }) {
  const cfg = { cyan: "text-cyan", violet: "text-violet", gold: "text-gold" }[tone];
  return (
    <div>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">{label}</div>
      <div className={cn("font-display font-bold text-2xl", cfg)}>{value}</div>
    </div>
  );
}
