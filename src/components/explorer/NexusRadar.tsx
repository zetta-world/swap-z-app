"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw, Sparkles, Globe, AlertCircle, ArrowRight, TrendingUp, TrendingDown,
} from "lucide-react";
import { compactNumber, formatPct } from "@/lib/format";
import { computeQuickScore } from "@/lib/conviction";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface NarrativeMember {
  symbol:      string;
  chain:       string;
  pairName:    string;
  pairAddress: string;
  baseAddress: string;
  dex:         string;
  priceUsd:    number;
  volume24h:   number;
  change24h:   number;
  liquidity:   number;
}

interface NarrativeCluster {
  id:           string;
  name:         string;
  tagline:      string;
  emoji?:       string;
  color:        string;
  thesis:       string;
  risk:         "low" | "medium" | "high";
  edge:         string;
  members:      NarrativeMember[];
  aggVolume24h: number;
  aggLiquidity: number;
  avgChange24h: number;
  crossChainSpread?: {
    symbol:     string;
    bestChain:  string;
    worstChain: string;
    spreadPct:  number;
  };
}

interface ApiResponse {
  ok:          boolean;
  clusters:    NarrativeCluster[];
  generatedAt: number;
  source:      "zion" | "fallback";
  note?:       string;
}

/**
 * Nexus Radar — ZION-clustered narratives across every chain in the Nexus.
 * Differs from DexScreener's manual "metas" chips because each cluster here
 * is auto-derived from live volume + cross-chain dispersion, and comes with
 * a tradable thesis the user can read in one glance.
 */
export default function NexusRadar() {
  const t = useT();
  const [data, setData]     = useState<ApiResponse | null>(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setLoad(true);
    setError(null);
    try {
      const res  = await fetch("/api/narratives", { cache: "no-store" });
      const body = (await res.json()) as ApiResponse;
      if (!res.ok || !body.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-5 min-w-0">
      <Header
        loading={loading}
        source={data?.source}
        generatedAt={data?.generatedAt}
        onRefresh={load}
      />

      {error && (
        <div className="rounded-xl border border-red/30 bg-red/[0.05] p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-red flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-display font-bold text-sm text-red mb-1">{t("explorer.radarOffline")}</div>
            <p className="font-sans text-xs text-ink-2">{error}</p>
          </div>
        </div>
      )}

      {!error && (
        <>
          {loading && !data && <RadarSkeleton />}
          {data && data.clusters.length === 0 && (
            <div className="rounded-xl border border-white/5 bg-bg-1/40 p-6 text-center">
              <Sparkles className="w-6 h-6 text-cyan/60 mx-auto mb-2" />
              <p className="font-mono text-xs text-ink-3">
                {data.note ?? t("explorer.radarEmpty")}
              </p>
            </div>
          )}

          {data && data.clusters.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
              {data.clusters.map((c, i) => (
                <ClusterCard
                  key={c.id}
                  cluster={c}
                  index={i}
                  expanded={openId === c.id}
                  onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {data && data.source === "fallback" && (
        <p className="font-mono text-[10px] text-ink-4 text-center">
          {t("explorer.radarFallback")}
        </p>
      )}
    </div>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────

function Header({
  loading, source, generatedAt, onRefresh,
}: {
  loading: boolean;
  source?: ApiResponse["source"];
  generatedAt?: number;
  onRefresh: () => void;
}) {
  const t = useT();
  const age = generatedAt ? Math.round((Date.now() - generatedAt) / 1000) : null;
  const ageLabel = age === null ? "" : age < 60 ? t("explorer.ageSeconds", { n: age }) : t("explorer.ageMinutes", { n: Math.round(age / 60) });

  return (
    <div className="flex items-start justify-between gap-3 min-w-0 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="section-label">{t("explorer.tabRadar")}</span>
          <span className="tag tag-green">
            <span className="w-1.5 h-1.5 rounded-full bg-current pulse-dot" />
            {t("explorer.radarLive")}
          </span>
        </div>
        <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink leading-tight">
          {t("explorer.radarTitle")}
        </h1>
        <p className="font-sans text-xs sm:text-sm text-ink-3 leading-relaxed mt-1 max-w-2xl">
          {t("explorer.radarBody")}
        </p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border font-mono text-[10px] tracking-widest uppercase flex-shrink-0",
          "border-cyan/20 bg-cyan/[0.05] text-cyan hover:bg-cyan/[0.10] hover:border-cyan/40 transition-colors",
          loading && "opacity-50 cursor-not-allowed",
        )}
      >
        <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        {loading ? t("explorer.radarScanning") : t("explorer.refresh")}
        {!loading && ageLabel && <span className="text-ink-4 ml-1">· {ageLabel}</span>}
        {source === "zion"     && !loading && <span className="text-gold/80 ml-1">· ZION</span>}
        {source === "fallback" && !loading && <span className="text-gold/80 ml-1">· {t("explorer.radarStatic")}</span>}
      </button>
    </div>
  );
}

// ─── Cluster card ──────────────────────────────────────────────────────

function ClusterCard({
  cluster, index, expanded, onToggle,
}: {
  cluster:  NarrativeCluster;
  index:    number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const riskCfg = {
    low:    { color: "text-green",  bg: "bg-green/10",  border: "border-green/30",  label: t("explorer.riskLowLabel")  },
    medium: { color: "text-gold",   bg: "bg-gold/10",   border: "border-gold/30",   label: t("explorer.riskMedLabel")  },
    high:   { color: "text-red",    bg: "bg-red/10",    border: "border-red/30",    label: t("explorer.riskHighLabel") },
  }[cluster.risk];

  const ChangeIcon = cluster.avgChange24h >= 0 ? TrendingUp : TrendingDown;
  const changeTone = cluster.avgChange24h >= 0 ? "text-green" : "text-red";

  const topMembers = useMemo(
    () => cluster.members.slice(0, 6),
    [cluster.members],
  );

  // Average quick-score across all cluster members → cluster-level conviction proxy.
  const clusterScore = useMemo(() => {
    if (cluster.members.length === 0) return 50;
    const total = cluster.members.reduce((acc, m) => acc + computeQuickScore({
      liquidityUsd: m.liquidity,
      volume24hUsd: m.volume24h,
      change24hPct: m.change24h,
    }), 0);
    return Math.round(total / cluster.members.length);
  }, [cluster.members]);
  const scoreColor =
    clusterScore >= 75 ? "#27D49B" :
    clusterScore >= 55 ? "#00E8FF" :
    clusterScore >= 35 ? "#FFB820" :
                         "#FF8A4C";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-2xl border border-white/5 bg-bg-1/40 overflow-hidden hover:border-white/10 transition-colors min-w-0"
    >
      {/* Top stripe — cluster color */}
      <div
        className="h-0.5 w-full"
        style={{ background: `linear-gradient(90deg, transparent, ${cluster.color}, transparent)` }}
      />

      <div className="p-4 space-y-3">
        {/* Title row */}
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
            style={{
              background: `${cluster.color}1A`,
              border:     `1px solid ${cluster.color}40`,
              boxShadow:  `0 0 24px -8px ${cluster.color}66`,
            }}
          >
            {cluster.emoji ?? "✦"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-extrabold text-base text-ink" style={{ color: cluster.color }}>
                {cluster.name}
              </h3>
              <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase", riskCfg.color, riskCfg.bg, riskCfg.border)}>
                {riskCfg.label}
              </span>
              <span
                className="font-mono text-[9px] px-1.5 py-0.5 rounded border tracking-widest uppercase inline-flex items-center gap-1 tabular-nums"
                style={{ background: `${scoreColor}10`, borderColor: `${scoreColor}33`, color: scoreColor }}
                title={`Cluster-level quick conviction (avg across ${cluster.members.length} members). Click any token for the full score.`}
              >
                <span className="w-1 h-1 rounded-full" style={{ background: scoreColor }} />
                {clusterScore} CONV
              </span>
            </div>
            <p className="font-sans text-xs text-ink-2 leading-relaxed mt-0.5 line-clamp-2">
              {cluster.tagline}
            </p>
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-2">
          <Metric label={t("explorer.metricVolume24h")} value={`$${compactNumber(cluster.aggVolume24h)}`} accent={cluster.color} />
          <Metric label={t("explorer.metricLiquidity")}  value={`$${compactNumber(cluster.aggLiquidity)}`} />
          <Metric
            label={t("explorer.metricAvgChange")}
            value={formatPct(cluster.avgChange24h)}
            icon={<ChangeIcon className={cn("w-2.5 h-2.5", changeTone)} />}
            tone={changeTone}
          />
        </div>

        {/* Cross-chain spread chip */}
        {cluster.crossChainSpread && (
          <div className="rounded-lg border border-violet/25 bg-violet/[0.05] p-2.5 flex items-start gap-2">
            <Globe className="w-3 h-3 text-violet mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-mono text-[9px] text-violet tracking-widest uppercase">Cross-chain spread</div>
              <p className="font-mono text-[10px] text-ink-2 leading-relaxed truncate">
                <b>{cluster.crossChainSpread.symbol}</b> · {cluster.crossChainSpread.bestChain} vs {cluster.crossChainSpread.worstChain}
                {" · "}
                <span className="text-violet font-bold">{cluster.crossChainSpread.spreadPct.toFixed(2)}%</span>
              </p>
            </div>
          </div>
        )}

        {/* Member token rail */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {topMembers.map((m) => (
            <MemberChip key={`${m.chain}:${m.pairAddress}`} member={m} clusterColor={cluster.color} />
          ))}
          {cluster.members.length > topMembers.length && (
            <span className="font-mono text-[10px] text-ink-3 px-1.5">
              +{cluster.members.length - topMembers.length} more
            </span>
          )}
        </div>

        {/* Expand toggle */}
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center justify-between text-left font-mono text-[10px] text-ink-3 tracking-widest uppercase hover:text-cyan transition-colors pt-1"
        >
          <span>{expanded ? t("explorer.hideThesis") : t("explorer.openThesis")}</span>
          <ArrowRight className={cn("w-3 h-3 transition-transform", expanded && "rotate-90")} />
        </button>

        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="space-y-3 pt-2 border-t border-white/5 overflow-hidden"
          >
            <div>
              <div className="font-mono text-[9px] text-cyan tracking-widest uppercase mb-1">ZION thesis</div>
              <p className="font-sans text-xs text-ink-2 leading-relaxed">{cluster.thesis}</p>
            </div>
            <div>
              <div className="font-mono text-[9px] text-gold tracking-widest uppercase mb-1">Where the edge is</div>
              <p className="font-sans text-xs text-ink-2 leading-relaxed">{cluster.edge}</p>
            </div>

            {/* Full member table */}
            <div className="rounded-lg border border-white/5 bg-bg-1/40 divide-y divide-white/[0.04]">
              {cluster.members.map((m) => (
                <MemberRow key={`${m.chain}:${m.pairAddress}`} m={m} />
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function Metric({
  label, value, accent, tone, icon,
}: {
  label:  string;
  value:  string;
  accent?: string;
  tone?:  string;
  icon?:  React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/40 px-2 py-2 min-w-0">
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-0.5 truncate">{label}</div>
      <div
        className={cn("font-mono text-[11px] truncate flex items-center gap-1", tone ?? "text-ink")}
        style={accent ? { color: accent } : undefined}
      >
        {icon}{value}
      </div>
    </div>
  );
}

function pairHref(m: NarrativeMember): string | null {
  // GeckoTerminal network slugs sometimes diverge from DexScreener's chain
  // slugs (e.g. eth → ethereum, polygon_pos → polygon). Map the most common
  // ones so the pair page can hit the right DexScreener endpoint.
  const slug =
    m.chain === "eth"         ? "ethereum" :
    m.chain === "polygon_pos" ? "polygon"  :
    m.chain;
  if (!m.pairAddress) return null;
  return `/pair/${encodeURIComponent(slug)}/${encodeURIComponent(m.pairAddress)}`;
}

function MemberChip({ member, clusterColor }: { member: NarrativeMember; clusterColor: string }) {
  const up = member.change24h >= 0;
  const href = pairHref(member);
  const Tag = href ? "a" : "span";
  return (
    <Tag
      {...(href ? { href } : {})}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border font-mono text-[10px] truncate max-w-[140px] hover:brightness-125 transition"
      style={{
        background: `${clusterColor}10`,
        borderColor: `${clusterColor}33`,
      }}
      title={`${member.pairName} on ${member.chain} via ${member.dex}`}
    >
      <span className="font-bold text-ink truncate">{member.symbol}</span>
      <span className="text-ink-4 text-[9px] uppercase">{member.chain}</span>
      <span className={cn("tabular-nums", up ? "text-green" : "text-red")}>
        {up ? "+" : ""}{member.change24h.toFixed(1)}%
      </span>
    </Tag>
  );
}

function MemberRow({ m }: { m: NarrativeMember }) {
  const up = m.change24h >= 0;
  const href = pairHref(m);
  const Tag = href ? "a" : "div";
  return (
    <Tag
      {...(href ? { href } : {})}
      className={cn(
        "flex items-center gap-3 px-2.5 py-2 min-w-0",
        href && "hover:bg-white/[0.03] transition-colors",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] text-ink truncate">
          <b>{m.symbol}</b>
          <span className="text-ink-4"> / </span>
          <span className="text-ink-3">{m.chain.toUpperCase()}</span>
          <span className="text-ink-4"> · {m.dex}</span>
        </div>
        <div className="font-mono text-[10px] text-ink-3 truncate">
          Liq ${compactNumber(m.liquidity)} · Vol 24h ${compactNumber(m.volume24h)}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="font-mono text-[11px] text-ink tabular-nums">
          {m.priceUsd > 0 ? `$${m.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : "—"}
        </div>
        <div className={cn("font-mono text-[10px] tabular-nums", up ? "text-green" : "text-red")}>
          {up ? "+" : ""}{m.change24h.toFixed(2)}%
        </div>
      </div>
    </Tag>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────

function RadarSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-white/5 bg-bg-1/40 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/5 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-24 bg-white/5 rounded animate-pulse" />
              <div className="h-3 w-full bg-white/5 rounded animate-pulse" />
              <div className="h-3 w-3/4 bg-white/5 rounded animate-pulse" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="h-12 bg-white/5 rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="h-5 w-16 bg-white/5 rounded animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
