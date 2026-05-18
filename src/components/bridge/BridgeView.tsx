"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownUp, Workflow, Shield, Zap, ChevronRight, ChevronDown } from "lucide-react";
import { CHAINS, type ChainId } from "@/lib/chains";
import { DEFAULT_TOKENS, tokensByChain, type Token } from "@/lib/tokens";
import { formatUsd, formatAmount, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/cn";

interface BridgeRoute {
  protocol: string;
  estTime:  string;
  fee:      string;
  color:    string;
}

const BRIDGE_ROUTES: BridgeRoute[] = [
  { protocol: "LayerZero V2",  estTime: "~30 s",  fee: "$0.42", color: "#7C3AED" },
  { protocol: "Stargate",       estTime: "~45 s",  fee: "$0.58", color: "#00E8FF" },
  { protocol: "Hop Protocol",   estTime: "~5 min", fee: "$1.20", color: "#F5A623" },
  { protocol: "ZETTA Bridge",  estTime: "~15 s",  fee: "$0.18", color: "#00E087" },
];

export default function BridgeView() {
  const [fromChain, setFromChain] = useState<ChainId>("ethereum");
  const [toChain,   setToChain]   = useState<ChainId>("arbitrum");
  const [fromToken, setFromToken] = useState<Token | undefined>(() => tokensByChain("ethereum")[0]);
  const [toToken,   setToToken]   = useState<Token | undefined>(() => tokensByChain("arbitrum")[0]);
  const [amount,    setAmount]    = useState("1.0");
  const [routeIdx,  setRouteIdx]  = useState(0);

  const quote = useMemo(() => {
    const a = parseDecimalInput(amount) ?? 0;
    if (!fromToken || !toToken || a <= 0) return null;
    const inUsd  = a * (fromToken.priceUsd ?? 0);
    const out    = (inUsd / (toToken.priceUsd ?? 1)) * 0.998;     // 0.2% bridge fee
    return { inUsd, outAmt: out, outUsd: out * (toToken.priceUsd ?? 0) };
  }, [fromToken, toToken, amount]);

  const flip = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setFromToken(toToken);
    setToToken(fromToken);
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/3 left-1/4 w-[420px] h-[420px] rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/4 w-[360px] h-[360px] rounded-full bg-violet/15 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-6xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 mb-3">
            <Workflow className="w-4 h-4 text-cyan" />
            <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">
              Cross-Chain Settlement · 11 networks
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(2rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            One Router. <span className="text-grad-aurora">Every Chain.</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
            Atomic cross-chain settlement aggregated across LayerZero, Stargate, Hop, and ZETTA Bridge.
            ZION audits every route before quoting. MEV protection on every hop.
          </p>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-8">
          {/* Bridge card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="lg:col-span-7"
          >
            <div className="aurora-border p-px">
              <div className="rounded-[20px] glass p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="section-label">Cross-chain swap</span>
                  <span className="tag tag-green">
                    <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" />
                    Atomic
                  </span>
                </div>

                <ChainTokenBox
                  side="From"
                  chain={fromChain}
                  onChain={(c) => { setFromChain(c); setFromToken(tokensByChain(c)[0]); }}
                  token={fromToken}
                  onToken={setFromToken}
                  amount={amount}
                  onAmount={setAmount}
                  amountEditable
                  usd={quote?.inUsd}
                />

                <div className="relative h-0 flex items-center justify-center">
                  <button
                    onClick={flip}
                    className="absolute -my-3 w-10 h-10 rounded-xl bg-bg-2 border border-white/10 flex items-center justify-center text-ink-2 hover:text-cyan hover:border-cyan/30 hover:rotate-180 transition-all duration-300 shadow-card"
                  >
                    <ArrowDownUp className="w-3.5 h-3.5" />
                  </button>
                </div>

                <ChainTokenBox
                  side="To"
                  chain={toChain}
                  onChain={(c) => { setToChain(c); setToToken(tokensByChain(c)[0]); }}
                  token={toToken}
                  onToken={setToToken}
                  amount={quote ? formatAmount(quote.outAmt, 6) : ""}
                  onAmount={() => {}}
                  amountEditable={false}
                  usd={quote?.outUsd}
                />

                {/* Route picker */}
                <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Route</span>
                    <span className="font-mono text-[10px] text-cyan tracking-widest uppercase flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
                      Live · 4 routes
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {BRIDGE_ROUTES.map((r, i) => {
                      const active = i === routeIdx;
                      return (
                        <button
                          key={r.protocol}
                          onClick={() => setRouteIdx(i)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left",
                            active
                              ? "border-cyan/30 bg-cyan/[0.06]"
                              : "border-white/5 bg-white/[0.02] hover:border-white/10",
                          )}
                        >
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: r.color, boxShadow: active ? `0 0 10px ${r.color}` : "none" }} />
                          <span className="font-display font-bold text-sm text-ink flex-1">{r.protocol}</span>
                          <span className="font-mono text-[10px] text-ink-3">{r.estTime}</span>
                          <span className="font-mono text-[11px] text-ink-2">{r.fee}</span>
                          {active && (
                            <span className="tag tag-cyan text-[8px]">Best</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button className="w-full btn btn-primary py-3.5 text-sm tracking-widest" disabled={!quote}>
                  {quote ? "Bridge & Swap" : "Enter amount"}
                </button>
                <p className="font-mono text-[10px] text-ink-4 text-center">
                  Demo environment · simulation only · awaiting wallet integration
                </p>
              </div>
            </div>
          </motion.div>

          {/* Right — diagnostics + info */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="lg:col-span-5 space-y-3"
          >
            {/* Summary card */}
            <div className="rounded-2xl border border-white/5 glass-pane p-5">
              <span className="section-label">Bridge summary</span>
              <div className="mt-3 space-y-2">
                <SummaryRow label="From" value={`${fromToken?.symbol} on ${CHAINS.find((c) => c.id === fromChain)?.name}`} />
                <SummaryRow label="To"   value={`${toToken?.symbol}   on ${CHAINS.find((c) => c.id === toChain)?.name}`} />
                <SummaryRow label="Send"     value={`${amount} ${fromToken?.symbol}`} />
                <SummaryRow label="Receive"  value={quote ? `${formatAmount(quote.outAmt, 6)} ${toToken?.symbol}` : "—"} tone="cyan" />
                <SummaryRow label="Bridge"   value={BRIDGE_ROUTES[routeIdx].protocol} />
                <SummaryRow label="ETA"      value={BRIDGE_ROUTES[routeIdx].estTime} />
                <SummaryRow label="Fee"      value={BRIDGE_ROUTES[routeIdx].fee} />
                <SummaryRow label="Slippage" value="0.5% (suggested)" />
              </div>
            </div>

            <div className="rounded-2xl border border-green/15 bg-green/[0.04] p-4 flex gap-3">
              <Shield className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-display font-bold text-sm text-green">Atomic settlement</div>
                <p className="font-sans text-xs text-ink-2 leading-relaxed mt-1">
                  No partial fills. The transaction either completes end-to-end or reverts on the source chain.
                  ZETTA Chain provides finality assurance for the destination leg.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-gold/15 bg-gold/[0.04] p-4 flex gap-3">
              <Zap className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-display font-bold text-sm text-gold">MEV-shielded</div>
                <p className="font-sans text-xs text-ink-2 leading-relaxed mt-1">
                  Cross-chain routes are encrypted until settlement. No sandwich attacks possible on either leg.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 glass-pane p-5">
              <span className="section-label">Network coverage</span>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {CHAINS.map((c) => (
                  <div key={c.id} className="flex flex-col items-center gap-1 p-2 rounded-lg border border-white/5 bg-white/[0.02]">
                    <span className="w-5 h-5 rounded" style={{ background: c.gradient }} />
                    <span className="font-mono text-[9px] text-ink-2 tracking-wider uppercase">{c.short}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

interface BoxProps {
  side: "From" | "To";
  chain: ChainId;
  onChain: (c: ChainId) => void;
  token: Token | undefined;
  onToken: (t: Token) => void;
  amount: string;
  onAmount: (v: string) => void;
  amountEditable: boolean;
  usd?: number;
}

function ChainTokenBox({ side, chain, onChain, token, onToken, amount, onAmount, amountEditable, usd }: BoxProps) {
  const chainObj = CHAINS.find((c) => c.id === chain);
  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/30 p-3.5 hover:border-white/10 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">{side}</span>
        <ChainPicker chain={chain} onChange={onChain} />
      </div>
      <div className="flex items-center gap-2">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => amountEditable && onAmount(e.target.value)}
          placeholder="0.00"
          readOnly={!amountEditable}
          className={cn(
            "flex-1 bg-transparent text-2xl sm:text-3xl font-display font-bold text-ink outline-none placeholder:text-ink-4",
            !amountEditable && "cursor-default",
          )}
        />
        <TokenChip token={token} chain={chain} onToken={onToken} />
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="font-mono text-[11px] text-ink-3">
          {usd !== undefined ? formatUsd(usd) : "$0.00"}
        </span>
        <span className="font-mono text-[10px] text-ink-3 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: chainObj?.color }} />
          {chainObj?.name}
        </span>
      </div>
    </div>
  );
}

function ChainPicker({ chain, onChange }: { chain: ChainId; onChange: (c: ChainId) => void }) {
  const cur = CHAINS.find((c) => c.id === chain);
  return (
    <div className="relative">
      <select
        value={chain}
        onChange={(e) => onChange(e.target.value as ChainId)}
        className="appearance-none bg-bg-2 border border-white/10 rounded-lg pl-2.5 pr-7 py-1.5 text-[11px] font-mono uppercase tracking-wider text-ink-2 outline-none focus:border-cyan/40 cursor-pointer"
      >
        {CHAINS.map((c) => (
          <option key={c.id} value={c.id}>{c.short} · {c.name}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-3 pointer-events-none" />
      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none" style={{ background: cur?.color }} />
    </div>
  );
}

function TokenChip({ token, chain, onToken }: { token: Token | undefined; chain: ChainId; onToken: (t: Token) => void }) {
  const tokens = tokensByChain(chain);
  return (
    <div className="relative">
      <select
        value={token?.address ?? ""}
        onChange={(e) => {
          const t = tokens.find((x) => x.address === e.target.value);
          if (t) onToken(t);
        }}
        className="appearance-none bg-white/[0.03] border border-white/5 rounded-xl pl-2.5 pr-8 py-2 text-sm font-display font-bold text-ink outline-none focus:border-cyan/40 cursor-pointer hover:border-white/10"
      >
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>{t.symbol}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-3 pointer-events-none" />
    </div>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "cyan" }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{label}</span>
      <span className={cn("font-mono text-xs truncate ml-2", tone === "cyan" ? "text-cyan" : "text-ink-2")}>
        {value}
      </span>
    </div>
  );
}

// Avoid unused import
void DEFAULT_TOKENS;
void ChevronRight;
