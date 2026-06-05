"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Copy, ExternalLink, Globe, Sparkles, Shield, ShieldAlert, ShieldCheck,
  TrendingUp, TrendingDown, Clock, Twitter, MessageCircle, AlertTriangle, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import FlowSphere from "./FlowSphere";
import ConvictionBadge from "./ConvictionBadge";
import { compactNumber, formatUsd, formatPct } from "@/lib/format";
import { CHAIN_BY_ID, type ChainId } from "@/lib/chains";
import { computeConviction, type ConvictionAudit } from "@/lib/conviction";
import { cn } from "@/lib/cn";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import { useT } from "@/lib/i18n";
import Skeleton from "@/components/ui/Skeleton";

// Mirror of the server-side PairApiResponse shape (we keep a local copy so
// the page bundle doesn't drag the server route's deps into the client).
interface PairDetail {
  chainId:     string;
  dex:         string;
  url:         string;
  pairAddress: string;
  baseToken:   { address: string; name: string; symbol: string };
  quoteToken:  { address: string; name: string; symbol: string };
  priceUsd:    number;
  priceNative: number;
  liquidity:   { usd: number; base: number; quote: number };
  volume:      { h24: number; h6: number; h1: number; m5: number };
  priceChange: { h24: number; h6: number; h1: number; m5: number };
  txns:        Record<"h24" | "h6" | "h1" | "m5", { buys: number; sells: number }>;
  fdv:         number;
  marketCap:   number;
  pairCreatedAt: number;
  imageUrl?:   string;
  websites:    string[];
  socials:     { type: string; url: string }[];
}

interface PairAudit {
  isHoneypot:  boolean;
  buyTax:      number | null;
  sellTax:     number | null;
  openSource:  boolean | null;
  proxy:       boolean | null;
  mintable:    boolean | null;
  topHolderPct: number | null;
  lpLockedPct:  number | null;
  honeypotRisk: "low" | "medium" | "high" | null;
  source:       ("goplus" | "honeypot")[];
}

interface PairApi {
  ok:        boolean;
  pair:      PairDetail | null;
  audit:     PairAudit | null;
  ageSec:    number | null;
  pressure:  {
    txns:    { buy: number; sell: number };
    volume:  { buy: number; sell: number };
    wallets: { buy: number; sell: number } | null;
  };
  ts:        number;
}

export default function PairView({ chain, pair }: { chain: string; pair: string }) {
  const [data, setData] = useState<PairApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoad] = useState(true);

  const load = async () => {
    setLoad(true);
    setError(null);
    try {
      const res  = await fetch(`/api/pair?chain=${chain}&pair=${pair}`, { cache: "no-store" });
      const body = (await res.json()) as PairApi & { error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, pair]);

  if (loading && !data) {
    return <PairSkeleton />;
  }
  if (error || !data?.pair) {
    return (
      <div className="rounded-xl border border-red/30 bg-red/[0.05] p-5">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-red" />
          <span className="font-display font-bold text-sm text-red">Pair not found</span>
        </div>
        <p className="font-sans text-xs text-ink-2 leading-relaxed">
          {error ?? "DexScreener returned no data for this chain + pair combination."}
        </p>
        <p className="font-mono text-[10px] text-ink-4 mt-2">
          chain=<span className="text-ink-3">{chain}</span> pair=<span className="text-ink-3">{pair}</span>
        </p>
      </div>
    );
  }

  return <PairBody data={data} onRefresh={load} />;
}

// ─── Main body ─────────────────────────────────────────────────────────

function PairBody({ data, onRefresh }: { data: PairApi; onRefresh: () => void }) {
  const p = data.pair!;
  const internalChain = chainSlugToInternal(p.chainId);
  const chainMeta = internalChain ? CHAIN_BY_ID[internalChain] : null;
  const ageLabel = data.ageSec !== null ? humanAge(data.ageSec) : null;

  const change = p.priceChange.h24;
  const ChangeIcon = change >= 0 ? TrendingUp : TrendingDown;
  const changeTone = change >= 0 ? "text-green" : "text-red";

  // Compute the conviction score from the data we already have
  const conviction = useMemo(() => {
    const audit: ConvictionAudit | null = data.audit
      ? {
          isHoneypot:   data.audit.isHoneypot,
          buyTax:       data.audit.buyTax,
          sellTax:      data.audit.sellTax,
          openSource:   data.audit.openSource,
          proxy:        data.audit.proxy,
          mintable:     data.audit.mintable,
          topHolderPct: data.audit.topHolderPct,
          lpLockedPct:  data.audit.lpLockedPct,
          honeypotRisk: data.audit.honeypotRisk,
        }
      : null;
    return computeConviction({
      audit,
      pressureTxns:   data.pressure.txns,
      pressureVolume: data.pressure.volume,
      liquidityUsd:   p.liquidity.usd,
      volume24hUsd:   p.volume.h24,
      ageSec:         data.ageSec,
      change24hPct:   p.priceChange.h24,
    });
  }, [data, p]);

  return (
    <div className="space-y-4 min-w-0">
      {/* Back link + refresh */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <a
          href="/explorer"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink-3 hover:text-cyan tracking-widest uppercase"
        >
          <ArrowLeft className="w-3 h-3" />
          back to radar
        </a>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink-3 hover:text-cyan tracking-widest uppercase"
        >
          <RefreshCw className="w-3 h-3" />
          refresh
        </button>
      </div>

      {/* ─── Hero ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/5 bg-bg-1/40 overflow-hidden">
        {/* Top accent line */}
        <div
          className="h-0.5 w-full"
          style={{ background: change >= 0
            ? "linear-gradient(90deg, transparent, #27D49B, transparent)"
            : "linear-gradient(90deg, transparent, #FF5C5C, transparent)" }}
        />
        <div className="p-4 sm:p-5 flex items-start gap-3 sm:gap-4 min-w-0">
          {/* Token avatar */}
          <Avatar src={p.imageUrl} fallback={p.baseToken.symbol} chainColor={chainMeta?.color ?? "#00E8FF"} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <h1 className="font-display font-extrabold text-base sm:text-xl text-ink truncate">
                {p.baseToken.name || p.baseToken.symbol}
              </h1>
              <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
                {p.baseToken.symbol}/{p.quoteToken.symbol}
              </span>
              {ageLabel && (
                <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-ink-3 tracking-widest uppercase inline-flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {ageLabel}
                </span>
              )}
            </div>
            <div className="flex items-center flex-wrap gap-2 mb-2">
              {chainMeta && (
                <span
                  className="font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase"
                  style={{ borderColor: `${chainMeta.color}40`, background: `${chainMeta.color}10`, color: chainMeta.color }}
                >
                  {chainMeta.short}
                </span>
              )}
              <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-ink-3 tracking-widest uppercase">
                via {p.dex}
              </span>
              {/* Socials inline */}
              {p.websites.slice(0, 1).map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                   className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-cyan/30 bg-cyan/5 text-cyan tracking-widest uppercase inline-flex items-center gap-1 hover:bg-cyan/10">
                  <Globe className="w-2.5 h-2.5" /> site
                </a>
              ))}
              {p.socials.map((s) => {
                const Icon =
                  /twitter|x\b/i.test(s.type) ? Twitter :
                  /telegram/i.test(s.type)    ? MessageCircle :
                                                Globe;
                const label = /twitter|x\b/i.test(s.type) ? "twitter"
                            : /telegram/i.test(s.type)    ? "tg"
                            :                                s.type || "link";
                return (
                  <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                     className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-ink-3 hover:text-ink-2 tracking-widest uppercase inline-flex items-center gap-1">
                    <Icon className="w-2.5 h-2.5" /> {label}
                  </a>
                );
              })}
            </div>
            <div className="flex items-end gap-2 flex-wrap">
              <span className="font-display font-extrabold text-xl sm:text-2xl tabular-nums text-ink">
                ${formatPrice(p.priceUsd)}
              </span>
              <span className={cn("inline-flex items-center gap-1 font-mono text-xs tabular-nums", changeTone)}>
                <ChangeIcon className="w-3 h-3" />
                {formatPct(change)} (24h)
              </span>
              {p.priceNative > 0 && (
                <span className="font-mono text-[10px] text-ink-3 tabular-nums">
                  · {p.priceNative.toLocaleString("en-US", { maximumFractionDigits: 8 })} {p.quoteToken.symbol}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Conviction badge ─────────────────────────────────────── */}
      <ConvictionBadge result={conviction} />

      {/* ─── Flow Sphere + sidebar stats ───────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
        {/* Sphere */}
        <div className="rounded-2xl border border-white/5 bg-bg-1/40 p-4 sm:p-5 min-w-0">
          <FlowSphere
            rings={[
              {
                label:  "TXNS",
                value:  compactNumber(p.txns.h24.buys + p.txns.h24.sells),
                detail: `${compactNumber(p.txns.h24.buys)}↑ / ${compactNumber(p.txns.h24.sells)}↓`,
                buy:    data.pressure.txns.buy,
                sell:   data.pressure.txns.sell,
              },
              {
                label:  "VOLUME",
                value:  `$${compactNumber(p.volume.h24)}`,
                detail: `$${compactNumber(p.volume.h24 * data.pressure.txns.buy)}↑`,
                buy:    data.pressure.volume.buy,
                sell:   data.pressure.volume.sell,
              },
              {
                label:  "TRADES",
                value:  compactNumber(p.txns.h1.buys + p.txns.h1.sells),
                detail: "1h activity",
                buy:    safeRatio(p.txns.h1.buys, p.txns.h1.buys + p.txns.h1.sells),
                sell:   safeRatio(p.txns.h1.sells, p.txns.h1.buys + p.txns.h1.sells),
              },
            ]}
          />
        </div>

        {/* Key stats grid */}
        <div className="rounded-2xl border border-white/5 bg-bg-1/40 p-4 sm:p-5 grid grid-cols-2 gap-2 content-start min-w-0">
          <Stat label="Liquidity" value={`$${compactNumber(p.liquidity.usd)}`} />
          <Stat label="FDV"       value={`$${compactNumber(p.fdv)}`} />
          <Stat label="Market cap" value={`$${compactNumber(p.marketCap)}`} />
          <Stat label="Pair age" value={ageLabel ?? "—"} />
          <Stat label="Pooled" value={`${compactNumber(p.liquidity.base)} ${p.baseToken.symbol}`} />
          <Stat label=""        value={`${compactNumber(p.liquidity.quote)} ${p.quoteToken.symbol}`} />
          <Stat label="5m Δ"    value={formatPct(p.priceChange.m5)}  tone={p.priceChange.m5  >= 0 ? "green" : "red"} />
          <Stat label="1h Δ"    value={formatPct(p.priceChange.h1)}  tone={p.priceChange.h1  >= 0 ? "green" : "red"} />
          <Stat label="6h Δ"    value={formatPct(p.priceChange.h6)}  tone={p.priceChange.h6  >= 0 ? "green" : "red"} />
          <Stat label="24h Δ"   value={formatPct(p.priceChange.h24)} tone={p.priceChange.h24 >= 0 ? "green" : "red"} />
        </div>
      </div>

      {/* ─── Audit badge ───────────────────────────────────────────── */}
      <AuditPanel audit={data.audit} />

      {/* ─── ZION inline ──────────────────────────────────────────── */}
      <ZionInline base={p.baseToken} chain={internalChain} />

      {/* ─── Addresses ────────────────────────────────────────────── */}
      <AddressPanel
        pairAddress={p.pairAddress}
        baseAddress={p.baseToken.address}
        baseSymbol={p.baseToken.symbol}
        chain={internalChain}
        externalUrl={p.url}
      />
    </div>
  );
}

// ─── Token avatar ──────────────────────────────────────────────────────

function Avatar({ src, fallback, chainColor }: { src?: string; fallback: string; chainColor: string }) {
  if (src) {
    return (
      /* eslint-disable @next/next/no-img-element */
      <img
        src={src}
        alt=""
        className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover flex-shrink-0"
        style={{ border: `1px solid ${chainColor}40` }}
      />
    );
  }
  return (
    <div
      className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center flex-shrink-0 font-display font-extrabold text-sm"
      style={{
        background: `${chainColor}1A`,
        color:      chainColor,
        border:     `1px solid ${chainColor}55`,
        boxShadow:  `0 0 24px -8px ${chainColor}66`,
      }}
    >
      {fallback.slice(0, 3).toUpperCase()}
    </div>
  );
}

// ─── Audit panel ───────────────────────────────────────────────────────

function AuditPanel({ audit }: { audit: PairAudit | null }) {
  if (!audit) {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-1/30 p-3 flex items-center gap-2">
        <Shield className="w-3.5 h-3.5 text-ink-3" />
        <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
          Audit unavailable on this chain
        </span>
      </div>
    );
  }
  const flags: { kind: "ok" | "warn" | "danger"; label: string }[] = [];
  if (audit.isHoneypot)              flags.push({ kind: "danger", label: "Honeypot flag" });
  if (audit.honeypotRisk === "high") flags.push({ kind: "danger", label: "Honeypot.is: HIGH risk" });
  if (audit.sellTax !== null && audit.sellTax > 0.10) flags.push({ kind: "danger", label: `Sell tax ${(audit.sellTax * 100).toFixed(1)}%` });
  else if (audit.sellTax !== null && audit.sellTax > 0.05) flags.push({ kind: "warn", label: `Sell tax ${(audit.sellTax * 100).toFixed(1)}%` });
  if (audit.buyTax !== null && audit.buyTax > 0.10)  flags.push({ kind: "danger", label: `Buy tax ${(audit.buyTax * 100).toFixed(1)}%` });
  if (audit.openSource === false)    flags.push({ kind: "warn", label: "Not open source" });
  if (audit.proxy === true)          flags.push({ kind: "warn", label: "Proxy contract" });
  if (audit.mintable === true)       flags.push({ kind: "warn", label: "Mintable" });
  if (audit.topHolderPct !== null && audit.topHolderPct > 50)
                                     flags.push({ kind: "warn", label: `Top-10 holders ${audit.topHolderPct.toFixed(1)}%` });
  if (audit.lpLockedPct  !== null && audit.lpLockedPct  < 50)
                                     flags.push({ kind: "warn", label: `LP locked ${audit.lpLockedPct.toFixed(0)}%` });

  const isClean = flags.length === 0;
  const Icon  = isClean ? ShieldCheck : ShieldAlert;
  const tone  = isClean ? "green"     : "gold";
  const ToneCls =
    tone === "green" ? "text-green border-green/30 bg-green/[0.05]" :
                       "text-gold  border-gold/30  bg-gold/[0.05]";
  return (
    <div className={cn("rounded-xl border p-4 min-w-0", ToneCls)}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="font-display font-bold text-sm">
          {isClean ? "Audit · no major flags" : `Audit · ${flags.length} ${flags.length === 1 ? "flag" : "flags"}`}
        </span>
        <span className="ml-auto font-mono text-[9px] text-ink-3 tracking-widest uppercase">
          via {audit.source.join(" + ")}
        </span>
      </div>
      {flags.length > 0 && (
        <ul className="space-y-1">
          {flags.map((f, i) => (
            <li key={i} className="font-mono text-[11px] flex items-center gap-1.5 text-ink-2">
              <span className={cn("w-1.5 h-1.5 rounded-full",
                f.kind === "danger" ? "bg-red" :
                f.kind === "warn"   ? "bg-gold" :
                                      "bg-green",
              )} />
              {f.label}
            </li>
          ))}
        </ul>
      )}
      <p className="font-mono text-[10px] text-ink-4 mt-2 leading-relaxed">
        Audits aggregate GoPlus + Honeypot.is. They may not catch every edge case — always double-check large allocations.
      </p>
    </div>
  );
}

// ─── ZION inline ───────────────────────────────────────────────────────

function ZionInline({
  base, chain,
}: {
  base:  { address: string; name: string; symbol: string };
  chain: ChainId | null;
}) {
  const { toggleZion } = useUI();
  const { setFromToken, setToToken } = useSwap();

  const onAnalyze = () => {
    // Wire the pair into the swap store so ZION's drawer picks it up
    if (chain && base.address) {
      // Set the toToken to the pair's base token; leave fromToken untouched
      setToToken({
        symbol:   base.symbol || "TOKEN",
        name:     base.name   || base.symbol || "Token",
        chain,
        address:  base.address,
        decimals: 18, // best guess for unknown tokens — overridden by quote API
      });
    }
    toggleZion();
  };

  return (
    <button
      type="button"
      onClick={onAnalyze}
      className="w-full rounded-xl border border-gold/20 bg-gold/[0.04] hover:bg-gold/[0.08] hover:border-gold/35 transition-all p-4 flex items-center gap-3 group min-w-0"
    >
      <div className="w-9 h-9 rounded-lg bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
        <Sparkles className="w-4 h-4 text-gold" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="font-display font-bold text-sm text-gold">
          Ask ZION about {base.symbol}
        </div>
        <p className="font-sans text-[11px] text-ink-3 truncate">
          Full thesis · entry · 3 exits · stop loss · cross-chain arb scan
        </p>
      </div>
      <span className="font-mono text-[10px] text-gold/70 tracking-widest uppercase group-hover:text-gold">
        analyze →
      </span>
    </button>
  );
}

// ─── Address panel ─────────────────────────────────────────────────────

function AddressPanel({
  pairAddress, baseAddress, baseSymbol, chain, externalUrl,
}: {
  pairAddress: string;
  baseAddress: string;
  baseSymbol:  string;
  chain:       ChainId | null;
  externalUrl: string;
}) {
  const explorer = chain ? CHAIN_BY_ID[chain]?.explorer : null;
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/30 divide-y divide-white/[0.04]">
      <AddrRow label="Token" value={baseAddress} symbol={baseSymbol} explorer={explorer ? `${explorer}/address/${baseAddress}` : undefined} onCopy={copy} />
      <AddrRow label="Pair"  value={pairAddress} symbol="contract" explorer={explorer ? `${explorer}/address/${pairAddress}` : undefined} onCopy={copy} />
      {externalUrl && (
        <a href={externalUrl} target="_blank" rel="noopener noreferrer"
           className="flex items-center gap-2 px-3.5 py-3 font-mono text-[11px] text-cyan/80 hover:text-cyan hover:bg-cyan/[0.04] transition-colors">
          <ExternalLink className="w-3 h-3" /> Open on DexScreener
        </a>
      )}
    </div>
  );
}

function AddrRow({
  label, value, symbol, explorer, onCopy,
}: {
  label:     string;
  value:     string;
  symbol:    string;
  explorer?: string;
  onCopy:    (v: string) => void;
}) {
  const t = useT();
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 px-3.5 py-2.5 min-w-0">
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase w-12 flex-shrink-0">{label}</div>
      <div className="font-mono text-[11px] text-ink truncate flex-1 min-w-0">{value}</div>
      <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase hidden sm:inline">{symbol}</span>
      <button type="button" onClick={() => onCopy(value)} className="text-ink-3 hover:text-cyan p-1" aria-label={t("common.copy")}>
        <Copy className="w-3 h-3" />
      </button>
      {explorer && (
        <a href={explorer} target="_blank" rel="noopener noreferrer" className="text-ink-3 hover:text-cyan p-1" aria-label={t("common.viewOnExplorer")}>
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

// ─── Stat tile ─────────────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/30 px-2.5 py-2 min-w-0">
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-0.5 truncate">{label}</div>
      <div className={cn(
        "font-mono text-[11px] tabular-nums truncate",
        tone === "green" ? "text-green" :
        tone === "red"   ? "text-red"   :
                           "text-ink",
      )}>
        {value}
      </div>
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────

function PairSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28" rounded="lg" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Skeleton className="aspect-square" rounded="lg" />
        <Skeleton className="h-64" rounded="lg" />
      </div>
      <Skeleton className="h-16" rounded="lg" />
      <Skeleton className="h-12" rounded="lg" />
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function safeRatio(a: number, b: number): number {
  if (b <= 0) return 0.5;
  return Math.max(0, Math.min(1, a / b));
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1)        return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (n >= 0.0001)   return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return n.toExponential(2);
}

function humanAge(sec: number): string {
  if (sec < 60)         return `${sec}s ago`;
  if (sec < 3600)       return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400)      return `${Math.round(sec / 3600)}h ago`;
  if (sec < 86400 * 30) return `${Math.round(sec / 86400)}d ago`;
  if (sec < 86400 * 365) return `${Math.round(sec / (86400 * 30))}mo ago`;
  return `${Math.round(sec / (86400 * 365))}y ago`;
}

function chainSlugToInternal(slug: string): ChainId | null {
  const map: Record<string, ChainId> = {
    ethereum: "ethereum",
    bsc:      "bsc",
    polygon:  "polygon",
    base:     "base",
    arbitrum: "arbitrum",
    optimism: "optimism",
    avalanche:"avalanche",
    linea:    "linea",
    zksync:   "zksync",
    solana:   "solana",
  };
  return map[slug] ?? null;
}

// formatUsd kept available for future use
void formatUsd;
