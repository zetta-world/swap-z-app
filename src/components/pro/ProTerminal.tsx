"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Zap, Activity } from "lucide-react";
import { cn } from "@/lib/cn";
import { compactNumber, formatPct } from "@/lib/format";

/* ─── Mock chart series ──────────────────────────────────────────────── */
function buildSeries(n: number, start: number, vol: number): number[] {
  const out: number[] = [start];
  for (let i = 1; i < n; i++) {
    out.push(out[i - 1] * (1 + (Math.random() - 0.5) * vol));
  }
  return out;
}

function Sparkline({ data, color, height = 240 }: { data: number[]; color: string; height?: number }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const w = 100;
  const path = useMemo(() => {
    if (!data.length) return "";
    const range = max - min || 1;
    return data.map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = 100 - ((v - min) / range) * 100;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  }, [data, min, max]);

  const areaPath = `${path} L 100,100 L 0,100 Z`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id="proGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#proGrad)" />
      <path d={path} fill="none" stroke={color} strokeWidth="0.6" />
    </svg>
  );
}

/* ─── Orderbook mock ─────────────────────────────────────────────────── */
interface Level { price: number; qty: number; }
function buildBook(mid: number, depth: number): { bids: Level[]; asks: Level[] } {
  const bids: Level[] = [], asks: Level[] = [];
  for (let i = 1; i <= depth; i++) {
    bids.push({ price: mid * (1 - 0.0008 * i), qty: 10 + Math.random() * 200 });
    asks.push({ price: mid * (1 + 0.0008 * i), qty: 10 + Math.random() * 200 });
  }
  return { bids, asks };
}

const KEYBINDS = [
  { keys: "B",     label: "Buy"       },
  { keys: "S",     label: "Sell"      },
  { keys: "⌘ ↵",   label: "Execute"   },
  { keys: "⌘ K",   label: "Search"    },
  { keys: "Z",     label: "ZION ask"  },
  { keys: "1-9",   label: "Pair n"    },
];

const TRADES = [
  { ts: "12:48:02", side: "buy",  size: 0.42, price: 3451.23 },
  { ts: "12:48:01", side: "sell", size: 1.82, price: 3450.10 },
  { ts: "12:47:58", side: "buy",  size: 0.08, price: 3451.45 },
  { ts: "12:47:54", side: "buy",  size: 2.10, price: 3451.50 },
  { ts: "12:47:50", side: "sell", size: 0.32, price: 3449.80 },
  { ts: "12:47:46", side: "buy",  size: 0.55, price: 3450.55 },
  { ts: "12:47:42", side: "sell", size: 0.18, price: 3449.40 },
  { ts: "12:47:38", side: "buy",  size: 1.04, price: 3450.95 },
];

export default function ProTerminal() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2500);
    return () => clearInterval(id);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const series = useMemo(() => buildSeries(140, 3380, 0.004), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const book = useMemo(() => buildBook(3450, 12), [tick]);
  const last = series[series.length - 1];
  const prev = series[0];
  const change = ((last - prev) / prev) * 100;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] bg-black">
      <div className="absolute inset-0 grid-bg-dense opacity-25 pointer-events-none" />

      <div className="relative z-10 p-3 sm:p-4 lg:p-5 max-w-[1900px] mx-auto">
        {/* Top bar — pair + price + status */}
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 flex-wrap mb-3">
          <BarChart3 className="w-4 h-4 text-cyan" />
          <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">Pro Terminal · Z-SWAP</span>
          <div className="ml-auto flex items-center gap-2 font-mono text-[10px] text-ink-3">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green pulse-dot" /> NETWORK
            </span>
            <span className="text-ink-4">·</span>
            <span>UPTIME 99.998%</span>
            <span className="text-ink-4">·</span>
            <span>BLOCK #21,184,930</span>
          </div>
        </motion.div>

        {/* Workspace grid */}
        <div className="grid grid-cols-12 gap-3">
          {/* Pair header */}
          <div className="col-span-12 rounded-lg border border-white/5 bg-black/40 p-3 flex items-center gap-5 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center font-display font-extrabold text-cyan">Ξ</span>
              <div>
                <div className="font-display font-extrabold text-lg text-ink leading-none">ETH / USDC</div>
                <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mt-1">Ethereum · Uniswap V3 · 0.05%</div>
              </div>
            </div>
            <div className="font-mono">
              <div className="text-[10px] text-ink-3 tracking-widest uppercase">Last</div>
              <div className={cn("font-display font-extrabold text-2xl tabular-nums", change >= 0 ? "text-green" : "text-red")}>
                ${last.toFixed(2)}
              </div>
            </div>
            <Field label="24h" value={`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`} tone={change >= 0 ? "green" : "red"} />
            <Field label="High" value={`$${(Math.max(...series)).toFixed(2)}`} />
            <Field label="Low"  value={`$${(Math.min(...series)).toFixed(2)}`} />
            <Field label="Vol 24h" value={`$${compactNumber(892_000)}`} />
            <Field label="TVL" value={`$${compactNumber(142_800_000)}`} />
            <div className="ml-auto flex items-center gap-1.5">
              <button className="px-3 py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase border border-green/30 bg-green/5 text-green hover:bg-green/10">
                <ArrowUp className="w-3 h-3 inline mr-1" /> Buy (B)
              </button>
              <button className="px-3 py-1.5 rounded-md font-mono text-[10px] tracking-widest uppercase border border-red/30 bg-red/5 text-red hover:bg-red/10">
                <ArrowDown className="w-3 h-3 inline mr-1" /> Sell (S)
              </button>
            </div>
          </div>

          {/* Chart */}
          <div className="col-span-12 lg:col-span-8 rounded-lg border border-white/5 bg-black/40">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Price · 5m</span>
                <div className="flex items-center gap-0.5 ml-3">
                  {["1m", "5m", "15m", "1h", "4h", "1D"].map((t) => (
                    <button key={t} className={cn("px-2 py-1 rounded font-mono text-[9px] tracking-widest uppercase", t === "5m" ? "bg-white/10 text-ink" : "text-ink-3 hover:text-ink-2")}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                <span className="text-ink-3 tracking-widest uppercase">Indicators</span>
                {["MA", "RSI", "VOL", "EMA"].map((t) => (
                  <button key={t} className="px-2 py-1 rounded text-ink-3 hover:bg-white/5 hover:text-ink-2">{t}</button>
                ))}
              </div>
            </div>
            <div className="p-3">
              <Sparkline data={series} color={change >= 0 ? "#00E087" : "#FF3B5C"} height={320} />
              {/* Volume row */}
              <div className="mt-2 h-12 flex items-end gap-0.5">
                {Array.from({ length: 60 }).map((_, i) => (
                  <div key={i} className="flex-1 rounded-sm bg-cyan/30" style={{ height: `${20 + Math.random() * 70}%`, opacity: 0.6 }} />
                ))}
              </div>
            </div>
          </div>

          {/* Orderbook + trades */}
          <div className="col-span-12 lg:col-span-4 space-y-3">
            <div className="rounded-lg border border-white/5 bg-black/40">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Aggregated Orderbook</span>
                <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
                  Live
                </span>
              </div>
              <div className="grid grid-cols-3 px-3 py-1.5 border-b border-white/5 font-mono text-[9px] text-ink-3 tracking-widest uppercase">
                <span className="text-left">Size</span>
                <span className="text-center">Price</span>
                <span className="text-right">Total</span>
              </div>
              <div>
                {book.asks.slice(0, 6).reverse().map((l, i) => (
                  <div key={"a" + i} className="grid grid-cols-3 px-3 py-0.5 font-mono text-[10px] hover:bg-red/[0.04]">
                    <span className="text-ink-3">{l.qty.toFixed(2)}</span>
                    <span className="text-center text-red">{l.price.toFixed(2)}</span>
                    <span className="text-right text-ink-3">{(l.qty * l.price).toFixed(0)}</span>
                  </div>
                ))}
                <div className="px-3 py-1.5 flex items-center justify-between border-y border-white/5 bg-white/[0.02]">
                  <span className="font-display font-extrabold text-lg text-ink">${last.toFixed(2)}</span>
                  <span className={cn("font-mono text-[10px]", change >= 0 ? "text-green" : "text-red")}>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>
                </div>
                {book.bids.slice(0, 6).map((l, i) => (
                  <div key={"b" + i} className="grid grid-cols-3 px-3 py-0.5 font-mono text-[10px] hover:bg-green/[0.04]">
                    <span className="text-ink-3">{l.qty.toFixed(2)}</span>
                    <span className="text-center text-green">{l.price.toFixed(2)}</span>
                    <span className="text-right text-ink-3">{(l.qty * l.price).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/5 bg-black/40">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Recent Trades</span>
                <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">stream</span>
              </div>
              <div>
                {TRADES.map((t, i) => (
                  <div key={i} className="grid grid-cols-4 px-3 py-1 font-mono text-[10px] border-b border-white/[0.02] last:border-0">
                    <span className="text-ink-4">{t.ts}</span>
                    <span className={t.side === "buy" ? "text-green" : "text-red"}>{t.side.toUpperCase()}</span>
                    <span className="text-ink-2 text-right">{t.size.toFixed(2)}</span>
                    <span className="text-ink text-right tabular-nums">{t.price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Whales */}
          <div className="col-span-12 lg:col-span-6 rounded-lg border border-white/5 bg-black/40">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
              <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase flex items-center gap-2">
                <Activity className="w-3 h-3 text-cyan" /> Whale Activity
              </span>
              <span className="font-mono text-[10px] text-ink-4 tracking-widest uppercase">last 30 min</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {[
                { addr: "0x47a…cf91", action: "Buy",  amount: "82,400 USDC", note: "Coinbase 2 wallet"  },
                { addr: "0xb12…d4a8", action: "Sell", amount: "$340K worth ETH", note: "MEV bot — unknown" },
                { addr: "0xd9e…2e88", action: "Add LP", amount: "12.4 ETH + 42,800 USDC", note: "First-time LP" },
              ].map((w, i) => (
                <div key={i} className="px-3 py-2 flex items-center gap-3">
                  <span className={cn("w-1.5 h-1.5 rounded-full", w.action === "Buy" ? "bg-green" : w.action === "Sell" ? "bg-red" : "bg-cyan")} />
                  <span className="font-mono text-[10px] text-ink-3 w-24 truncate">{w.addr}</span>
                  <span className={cn("font-mono text-[10px] tracking-widest uppercase w-16", w.action === "Buy" ? "text-green" : w.action === "Sell" ? "text-red" : "text-cyan")}>{w.action}</span>
                  <span className="font-mono text-[10px] text-ink-2 flex-1 truncate">{w.amount}</span>
                  <span className="font-mono text-[10px] text-ink-4 truncate hidden sm:inline">{w.note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick analytics */}
          <div className="col-span-12 lg:col-span-3 rounded-lg border border-white/5 bg-black/40 p-3 space-y-2">
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Pool diagnostics</div>
            <Row label="Real vol" value="$892K" />
            <Row label="Artificial" value="$0" tone="green" />
            <Row label="Avg slip"  value="0.04%" />
            <Row label="MEV today" value="$0 saved" tone="green" />
            <Row label="LP unique" value="284" />
            <Row label="Top-10"    value="18.4%" tone="green" />
          </div>

          {/* Keybinds */}
          <div className="col-span-12 lg:col-span-3 rounded-lg border border-white/5 bg-black/40 p-3 space-y-2">
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-gold" /> Keybinds
            </div>
            {KEYBINDS.map((k) => (
              <div key={k.keys} className="flex items-center justify-between">
                <kbd className="font-mono text-[10px] text-ink-2 px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.02]">{k.keys}</kbd>
                <span className="font-mono text-[10px] text-ink-3">{k.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-4">
          Pro Terminal · monospace · resizable workspace ships with wallet connect · all data demo
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const cls = tone === "green" ? "text-green" : tone === "red" ? "text-red" : "text-ink";
  return (
    <div className="font-mono">
      <div className="text-[10px] text-ink-3 tracking-widest uppercase">{label}</div>
      <div className={cn("text-sm tabular-nums", cls)}>{value}</div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const cls = tone === "green" ? "text-green" : tone === "red" ? "text-red" : "text-ink-2";
  return (
    <div className="flex items-center justify-between font-mono text-[10px]">
      <span className="text-ink-3 tracking-widest uppercase">{label}</span>
      <span className={cls}>{value}</span>
    </div>
  );
}

// avoid unused import warning
void TrendingUp; void TrendingDown;
