"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Shield, Search, ExternalLink, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { CHAINS } from "@/lib/chains";
import { compactNumber, formatUsd, formatPct, shortenAddress } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Signal { kind: "ok" | "warn" | "danger"; label: string; weight: number; }
interface RiskResponse {
  chain: string;
  address: string;
  score: number;
  category: "safe" | "caution" | "risky" | "danger";
  signals: Signal[];
  security: Record<string, unknown> | null;
  honeypot: Record<string, unknown> | null;
  info: {
    address: string; name?: string; symbol?: string;
    priceUsd?: number; mcapUsd?: number; fdvUsd?: number;
    volume24h?: number; totalSupply?: number;
  } | null;
  ts: number;
}

const EXAMPLES = [
  { chain: "ethereum", addr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", label: "USDC (safe)"      },
  { chain: "ethereum", addr: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", label: "stETH (safe)"    },
  { chain: "bsc",      addr: "0x8aacc38933007ec530c552007e210b4667749df1", label: "ZETTA Token"     },
  { chain: "bsc",      addr: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", label: "CAKE (defi)"      },
];

const CAT_CFG = {
  safe:    { color: "text-green",  bg: "bg-green/10",  border: "border-green/30",  label: "SAFE",    glow: "shadow-glow-green" },
  caution: { color: "text-gold",   bg: "bg-gold/10",   border: "border-gold/30",   label: "CAUTION", glow: "shadow-glow-gold"  },
  risky:   { color: "text-gold",   bg: "bg-gold/15",   border: "border-gold/40",   label: "RISKY",   glow: "shadow-glow-gold"  },
  danger:  { color: "text-red",    bg: "bg-red/10",    border: "border-red/30",    label: "DANGER",  glow: "shadow-glow-red"   },
} as const;

const SIGNAL_ICONS = {
  ok:     { Icon: CheckCircle2,   color: "text-green" },
  warn:   { Icon: AlertTriangle,  color: "text-gold"  },
  danger: { Icon: XCircle,        color: "text-red"   },
} as const;

export default function RiskScanner() {
  const [chain, setChain] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<RiskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async (c: string, a: string) => {
    if (!c || !a) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/risk?chain=${c}&address=${a}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    scan(chain, address.trim());
  };

  const cat = result ? CAT_CFG[result.category] : null;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-32 right-1/4 w-[360px] h-[360px] rounded-full bg-red/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-12 max-w-5xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-red" />
            <span className="font-mono text-[10px] text-red/80 tracking-widest uppercase">
              06 — Security Layer · live
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            Risk <span className="text-grad-aurora">Scanner</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
            Real-time honeypot detection, tax simulation, holder concentration, contract verification.
            Powered by <span className="text-cyan">GoPlus Security</span> + <span className="text-violet">Honeypot.is</span> + <span className="text-gold">GeckoTerminal</span>.
          </p>
        </motion.div>

        {/* Input */}
        <form onSubmit={onSubmit} className="mt-7">
          <div className="aurora-border p-px">
            <div className="rounded-[18px] glass p-4 flex flex-col sm:flex-row gap-3">
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                className="bg-bg-2 border border-white/10 rounded-lg px-3 py-2.5 text-sm font-mono text-ink outline-none focus:border-cyan/40 min-w-[140px]"
              >
                {CHAINS.filter((c) => c.evm || c.id === "solana").map((c) => (
                  <option key={c.id} value={c.id}>{c.short} · {c.name}</option>
                ))}
              </select>
              <div className="flex-1 flex items-center gap-2 px-3 bg-bg-2 border border-white/10 rounded-lg focus-within:border-cyan/40">
                <Search className="w-4 h-4 text-ink-3 flex-shrink-0" />
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="0x... or paste a token address to scan"
                  className="flex-1 bg-transparent outline-none text-sm font-mono text-ink placeholder:text-ink-4 py-2.5"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !address.trim()}
                className="btn btn-primary px-6 disabled:opacity-50"
              >
                {loading ? "Scanning…" : "Scan"}
              </button>
            </div>
          </div>
        </form>

        {/* Examples */}
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <span className="font-mono text-[10px] text-ink-4 tracking-widest uppercase">Try:</span>
          {EXAMPLES.map((e) => (
            <button
              key={e.label}
              onClick={() => { setChain(e.chain); setAddress(e.addr); scan(e.chain, e.addr); }}
              className="text-[11px] font-mono px-2.5 py-1 rounded-full border border-white/10 text-ink-2 hover:border-cyan/30 hover:text-cyan transition-colors"
            >
              {e.label}
            </button>
          ))}
        </div>

        {/* Loading shimmer */}
        {loading && (
          <div className="mt-6 space-y-3">
            <div className="h-32 rounded-xl shimmer border border-white/5" />
            <div className="h-48 rounded-xl shimmer border border-white/5" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-6 rounded-xl border border-red/30 bg-red/5 p-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red" />
              <span className="font-display font-bold text-sm text-red">Scan failed</span>
            </div>
            <p className="font-mono text-xs text-red/80">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && cat && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
            {/* Verdict Card */}
            <div className={cn("rounded-2xl border p-5 sm:p-6 glass", cat.border, cat.bg)}>
              <div className="flex items-start gap-4">
                <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 border", cat.border, cat.bg, cat.glow)}>
                  <Shield className={cn("w-6 h-6", cat.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("font-display font-extrabold text-2xl", cat.color)}>{cat.label}</span>
                    <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">verdict</span>
                  </div>
                  <div className="font-mono text-[11px] text-ink-2 truncate">
                    {result.info?.symbol ?? "TOKEN"} <span className="text-ink-3">·</span> {result.info?.name ?? "—"}
                    <span className="text-ink-4"> · </span>
                    <a href={`https://etherscan.io/address/${result.address}`} target="_blank" rel="noopener" className="text-cyan/80 hover:text-cyan inline-flex items-center gap-0.5">
                      {shortenAddress(result.address, 8, 6)}
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={cn("font-display font-extrabold text-4xl tabular-nums", cat.color)}>{result.score}</div>
                  <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mt-1">/ 100 risk</div>
                </div>
              </div>

              {/* Score bar */}
              <div className="mt-4 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full", result.score < 20 ? "bg-green" : result.score < 40 ? "bg-gold" : result.score < 70 ? "bg-gold" : "bg-red")}
                  style={{ width: `${Math.max(result.score, 4)}%` }}
                />
              </div>
            </div>

            {/* Token info */}
            {result.info && (
              <div className="rounded-2xl border border-white/5 glass-pane p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Price"        value={formatUsd(result.info.priceUsd)} />
                <Stat label="Market Cap"   value={result.info.mcapUsd ? `$${compactNumber(result.info.mcapUsd)}` : "—"} />
                <Stat label="24h Volume"   value={result.info.volume24h ? `$${compactNumber(result.info.volume24h)}` : "—"} />
                <Stat label="Supply"       value={result.info.totalSupply ? compactNumber(result.info.totalSupply) : "—"} />
              </div>
            )}

            {/* Signals */}
            <div className="rounded-2xl border border-white/5 glass-pane overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5">
                <Info className="w-3.5 h-3.5 text-cyan" />
                <span className="font-display font-bold text-sm text-ink">Signal Breakdown</span>
                <span className="ml-auto font-mono text-[10px] text-ink-4 tracking-widest uppercase">
                  {result.signals.length} signal{result.signals.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {result.signals.map((s, i) => {
                  const { Icon, color } = SIGNAL_ICONS[s.kind];
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="flex items-center gap-3 px-5 py-2.5"
                    >
                      <Icon className={cn("w-3.5 h-3.5 flex-shrink-0", color)} />
                      <span className="font-mono text-xs text-ink-2 flex-1 truncate">{s.label}</span>
                      {s.weight > 0 && (
                        <span className={cn("font-mono text-[10px] tabular-nums", color)}>+{s.weight}</span>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Disclaimer */}
            <div className="rounded-xl border border-gold/15 bg-gold/[0.03] p-4">
              <div className="font-mono text-[10px] text-gold tracking-widest uppercase mb-1.5">Scoring methodology</div>
              <p className="font-sans text-xs text-ink-2 leading-relaxed">
                Deterministic score derived from GoPlus security flags and Honeypot.is simulation results.
                This is structural risk analysis, not investment advice. Final execution requires your manual approval.
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">{label}</div>
      <div className="font-display font-bold text-base text-ink">{value}</div>
    </div>
  );
}
