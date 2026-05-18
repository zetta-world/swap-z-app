"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, Target, Calendar, Clock, ChevronDown, AlertCircle, Sparkles } from "lucide-react";
import { CHAINS, type ChainId } from "@/lib/chains";
import { tokensByChain, type Token } from "@/lib/tokens";
import { formatUsd, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/cn";

type OrderType = "limit" | "dca" | "twap";

const TABS: { id: OrderType; label: string; Icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { id: "limit", label: "Limit",          Icon: Target,    desc: "Buy or sell when the price hits your target" },
  { id: "dca",   label: "DCA",            Icon: Calendar,  desc: "Dollar-cost average on a recurring schedule"  },
  { id: "twap",  label: "TWAP",           Icon: Clock,     desc: "Split a large order across N intervals"        },
];

const FREQS = [
  { v: "hourly",  label: "Hourly"   },
  { v: "daily",   label: "Daily"    },
  { v: "weekly",  label: "Weekly"   },
  { v: "monthly", label: "Monthly"  },
];

interface ActiveOrder {
  id: string; type: OrderType; pair: string; status: "active" | "filled" | "cancelled";
  detail: string; chain: ChainId; progress?: number;
}

const MOCK_ORDERS: ActiveOrder[] = [
  { id: "ord_001", type: "limit", pair: "ETH → USDC",  status: "active",    detail: "Trigger at $3,600",     chain: "ethereum" },
  { id: "ord_002", type: "dca",   pair: "USDC → wstETH",status: "active",   detail: "Daily · $200 · 12 of 30", chain: "ethereum", progress: 0.40 },
  { id: "ord_003", type: "twap",  pair: "USDC → ARB",  status: "filled",    detail: "8 of 8 ticks · avg $0.79", chain: "arbitrum" },
  { id: "ord_004", type: "limit", pair: "BNB → CAKE",  status: "cancelled", detail: "Manually cancelled",     chain: "bsc" },
];

export default function OrdersView() {
  const [tab, setTab] = useState<OrderType>("limit");
  const [chain, setChain] = useState<ChainId>("ethereum");
  const [fromToken, setFromToken] = useState<Token | undefined>(() => tokensByChain("ethereum").find((t) => t.symbol === "USDC"));
  const [toToken,   setToToken]   = useState<Token | undefined>(() => tokensByChain("ethereum").find((t) => t.symbol === "ETH"));
  const [amount,    setAmount]    = useState("");
  const [limitPrice, setLimitPrice] = useState("3600");
  const [intervals, setIntervals] = useState("12");
  const [freq, setFreq] = useState("daily");

  const summary = useMemo(() => {
    const a = parseDecimalInput(amount) ?? 0;
    if (!a) return null;
    if (tab === "limit") return `Buy when ${toToken?.symbol} = $${limitPrice} per ${fromToken?.symbol}`;
    if (tab === "dca")   return `${freq} · $${(a / parseInt(intervals || "1")).toFixed(2)} per cycle · ${intervals} cycles`;
    return `Split ${amount} ${fromToken?.symbol} across ${intervals} intervals`;
  }, [tab, amount, intervals, freq, fromToken, toToken, limitPrice]);

  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] rounded-full bg-violet/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-6xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-violet" />
            <span className="font-mono text-[10px] text-violet/80 tracking-widest uppercase">
              Order Engine · Limit · DCA · TWAP
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(2rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            Set and <span className="text-grad-aurora">walk away</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
            Programmable order strategies that beat Jupiter and Matcha. Set the conditions —
            ZION watches the market continuously and executes when your rules are met.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Order builder */}
          <div className="lg:col-span-7 space-y-4">
            {/* Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-xl border border-white/5 glass-pane">
              {TABS.map((t) => {
                const Icon = t.Icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 px-3 py-3 rounded-lg transition-all",
                      active ? "bg-violet/15 border border-violet/30 text-violet" : "text-ink-3 hover:text-ink-2 border border-transparent",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="font-display font-bold text-[11px] tracking-widest uppercase">{t.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="font-sans text-xs text-ink-3 leading-relaxed">
              {TABS.find((t) => t.id === tab)?.desc}
            </div>

            {/* Form */}
            <div className="aurora-border p-px">
              <div className="rounded-[18px] glass p-5 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Chain">
                    <ChainSelect chain={chain} onChange={(c) => { setChain(c); setFromToken(tokensByChain(c)[0]); setToToken(tokensByChain(c)[1]); }} />
                  </Field>
                  <Field label="Type">
                    <div className="bg-bg-2 border border-white/10 rounded-lg px-2.5 py-2 text-sm font-mono text-ink-2 uppercase tracking-widest">
                      {TABS.find((t) => t.id === tab)?.label}
                    </div>
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Pay">
                    <TokenSelect token={fromToken} tokens={tokensByChain(chain)} onChange={setFromToken} />
                  </Field>
                  <Field label="Receive">
                    <TokenSelect token={toToken} tokens={tokensByChain(chain)} onChange={setToToken} />
                  </Field>
                </div>

                <Field label={tab === "dca" ? "Total budget" : "Amount"}>
                  <div className="flex items-center gap-2 bg-bg-2 border border-white/10 rounded-lg px-3 py-2 focus-within:border-violet/30">
                    <input
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 bg-transparent outline-none text-2xl font-display font-bold text-ink placeholder:text-ink-4"
                    />
                    <span className="font-display font-bold text-sm text-ink-2">{fromToken?.symbol}</span>
                  </div>
                </Field>

                {/* Type-specific fields */}
                {tab === "limit" && (
                  <Field label={`Trigger price (${toToken?.symbol} in USD)`}>
                    <div className="flex items-center gap-2 bg-bg-2 border border-white/10 rounded-lg px-3 py-2 focus-within:border-violet/30">
                      <span className="font-mono text-ink-3">$</span>
                      <input
                        inputMode="decimal"
                        value={limitPrice}
                        onChange={(e) => setLimitPrice(e.target.value)}
                        placeholder="0.00"
                        className="flex-1 bg-transparent outline-none text-xl font-display font-bold text-ink placeholder:text-ink-4"
                      />
                    </div>
                  </Field>
                )}

                {tab === "dca" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Frequency">
                      <select
                        value={freq}
                        onChange={(e) => setFreq(e.target.value)}
                        className="bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink-2 uppercase tracking-widest w-full"
                      >
                        {FREQS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Number of cycles">
                      <input
                        value={intervals}
                        onChange={(e) => setIntervals(e.target.value)}
                        type="number"
                        className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink-2 outline-none focus:border-violet/30"
                      />
                    </Field>
                  </div>
                )}

                {tab === "twap" && (
                  <Field label="Intervals (split the order into N slices)">
                    <input
                      value={intervals}
                      onChange={(e) => setIntervals(e.target.value)}
                      type="number"
                      className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink-2 outline-none focus:border-violet/30"
                    />
                  </Field>
                )}

                {summary && (
                  <div className="rounded-lg border border-violet/20 bg-violet/[0.04] p-3 flex items-start gap-2.5">
                    <Sparkles className="w-3.5 h-3.5 text-violet flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-mono text-[10px] text-violet tracking-widest uppercase mb-0.5">ZION will</div>
                      <div className="font-sans text-xs text-ink-2 leading-relaxed">{summary}</div>
                    </div>
                  </div>
                )}

                <button className="w-full btn btn-primary py-3.5 text-sm tracking-widest" disabled={!summary}>
                  {summary ? `Place ${TABS.find((t) => t.id === tab)?.label} order` : "Configure order"}
                </button>
                <p className="font-mono text-[10px] text-ink-4 text-center">
                  Demo · order will be logged locally · execution requires wallet integration
                </p>
              </div>
            </div>
          </div>

          {/* Active orders panel */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-white/5 glass-pane overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <span className="font-display font-bold text-sm text-ink">Active orders</span>
                <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">{MOCK_ORDERS.filter((o) => o.status === "active").length} live</span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {MOCK_ORDERS.map((o) => {
                  const meta = TABS.find((t) => t.id === o.type)!;
                  const Icon = meta.Icon;
                  const statusCfg = {
                    active:    "text-green border-green/30 bg-green/5",
                    filled:    "text-cyan border-cyan/30 bg-cyan/5",
                    cancelled: "text-ink-3 border-white/10 bg-white/[0.02]",
                  }[o.status];
                  return (
                    <div key={o.id} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-violet/10 border border-violet/30 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-3.5 h-3.5 text-violet" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-display font-bold text-xs text-ink truncate">{o.pair}</span>
                            <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase", statusCfg)}>
                              {o.status}
                            </span>
                          </div>
                          <div className="font-mono text-[10px] text-ink-3 mb-1">{o.detail}</div>
                          <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">{o.chain} · {meta.label}</div>
                          {o.progress !== undefined && (
                            <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-violet rounded-full" style={{ width: `${o.progress * 100}%` }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-gold/15 bg-gold/[0.04] p-4 flex gap-3">
              <AlertCircle className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-display font-bold text-sm text-gold">Persistent strategies</div>
                <p className="font-sans text-xs text-ink-2 leading-relaxed mt-1">
                  Orders survive page refresh and run server-side. ZION watches the market 24/7
                  and notifies on trigger. Limit and DCA settle through MEV-shielded routes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function ChainSelect({ chain, onChange }: { chain: ChainId; onChange: (c: ChainId) => void }) {
  const cur = CHAINS.find((c) => c.id === chain);
  return (
    <div className="relative">
      <select
        value={chain}
        onChange={(e) => onChange(e.target.value as ChainId)}
        className="appearance-none bg-bg-2 border border-white/10 rounded-lg pl-6 pr-7 py-2 text-sm font-mono uppercase tracking-wider text-ink-2 outline-none focus:border-violet/30 cursor-pointer w-full"
      >
        {CHAINS.filter((c) => !c.comingSoon).map((c) => (
          <option key={c.id} value={c.id}>{c.short} · {c.name}</option>
        ))}
      </select>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none" style={{ background: cur?.color }} />
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-3 pointer-events-none" />
    </div>
  );
}

function TokenSelect({ token, tokens, onChange }: { token: Token | undefined; tokens: Token[]; onChange: (t: Token) => void }) {
  return (
    <div className="relative">
      <select
        value={token?.address ?? ""}
        onChange={(e) => {
          const t = tokens.find((x) => x.address === e.target.value);
          if (t) onChange(t);
        }}
        className="appearance-none w-full bg-bg-2 border border-white/10 rounded-lg pl-3 pr-7 py-2 text-sm font-display font-bold text-ink outline-none focus:border-violet/30 cursor-pointer"
      >
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>{t.symbol}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-3 pointer-events-none" />
    </div>
  );
}

// avoid unused import warning
void formatUsd;
