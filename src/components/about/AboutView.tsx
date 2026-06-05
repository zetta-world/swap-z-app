"use client";

import { useT } from "@/lib/i18n";
import {
  Zap, Shield, Bot, Layers, ArrowLeftRight, BarChart3,
  ExternalLink, GitBranch, Cpu, Globe2, Lock,
} from "lucide-react";

/* ── Integration catalogue ─────────────────────────────────────────────── */
const DEX_INTEGRATIONS = [
  { name: "0x v2 Swap API",    role: "EVM DEX aggregation — best-execution routing across Uniswap, Curve, Balancer, and 100+ sources", link: "https://0x.org" },
  { name: "LiFi",              role: "Cross-chain bridging + swap — bridges Stargate, Across, Hop, LayerZero in one call",            link: "https://li.fi" },
  { name: "Jupiter",           role: "Solana DEX aggregation — routes across Raydium, Orca, Lifinity, Phoenix, and others",          link: "https://jup.ag" },
  { name: "CoW Protocol",      role: "Limit orders + MEV-protected batch auctions on Ethereum mainnet",                               link: "https://cow.fi" },
];

const DATA_INTEGRATIONS = [
  { name: "GeckoTerminal",  role: "Real-time OHLCV, pool stats, and trade feeds for 100+ chains" },
  { name: "DexScreener",    role: "Pair discovery, price feeds, and DEX metadata" },
];

const SECURITY_INTEGRATIONS = [
  { name: "GoPlus Security",  role: "On-chain token risk score — honeypot detection, contract audit, holder analysis" },
  { name: "Honeypot.is",      role: "Sell-tax and honeypot simulation for ERC-20 tokens on EVM chains" },
];

const CEX_INTEGRATIONS = [
  { name: "CCXT",  role: "Unified CEX connector — Binance, Coinbase, OKX, Bybit, Kraken, Gate.io, KuCoin, Bitfinex, MEXC, HTX and 100+ others. Spot orders, balances, deposit addresses via server-side proxy routes." },
];

const AI_INTEGRATIONS = [
  { name: "Anthropic Claude Haiku 4.5", role: "ZION advisory layer — streaming analysis of pair risk, liquidity depth, trade signals. Advisory mode only; all suggestions require manual user review." },
];

/* ── Architecture node ─────────────────────────────────────────────────── */
function ArchNode({
  label, sublabel, accent = "cyan",
}: { label: string; sublabel: string; accent?: "cyan" | "violet" | "gold" | "green" }) {
  const border = accent === "cyan"   ? "border-cyan/25 bg-cyan/[0.04]"
               : accent === "violet" ? "border-violet/25 bg-violet/[0.04]"
               : accent === "gold"   ? "border-gold/25 bg-gold/[0.04]"
               :                       "border-green/25 bg-green/[0.04]";
  const text   = accent === "cyan"   ? "text-cyan"
               : accent === "violet" ? "text-violet"
               : accent === "gold"   ? "text-gold"
               :                       "text-green";
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${border}`}>
      <div className={`font-display font-bold text-xs ${text}`}>{label}</div>
      <div className="font-mono text-[9px] text-ink-3 tracking-wide mt-0.5">{sublabel}</div>
    </div>
  );
}

/* ── Integration row ───────────────────────────────────────────────────── */
function IntegRow({ name, role, link }: { name: string; role: string; link?: string }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="w-1.5 h-1.5 rounded-full bg-cyan/60 flex-shrink-0 mt-1.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display font-bold text-sm text-ink">{name}</span>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-cyan/60 hover:text-cyan transition-colors">
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <p className="font-mono text-[11px] text-ink-3 mt-0.5 leading-relaxed">{role}</p>
      </div>
    </div>
  );
}

/* ── Section wrapper ───────────────────────────────────────────────────── */
function Section({ icon: Icon, title, children, accent = "cyan" }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  accent?: "cyan" | "violet" | "gold" | "green";
}) {
  const ic = accent === "cyan"   ? "text-cyan"
           : accent === "violet" ? "text-violet"
           : accent === "gold"   ? "text-gold"
           :                       "text-green";
  return (
    <section className="glass rounded-2xl p-5 sm:p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <Icon className={`w-4 h-4 ${ic} flex-shrink-0`} />
        <h2 className="font-display font-bold text-base text-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function AboutView() {
  const t = useT();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 space-y-6">

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div className="aurora-border rounded-2xl p-6 sm:p-8 relative overflow-hidden">
        <div className="grid-bg-dense absolute inset-0 opacity-20 pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <span className="tag tag-cyan section-label">{t("about.tagTechnical")}</span>
            <span className="tag tag-violet section-label">{t("about.tagWhitepaper")}</span>
          </div>
          <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-ink leading-tight mb-3">
            {t("about.heroTitle")}
            <span className="text-grad-cyan block sm:inline sm:ml-2">{t("about.heroTitleHL")}</span>
          </h1>
          <p className="font-mono text-[13px] text-ink-2 leading-relaxed max-w-2xl">
            {t("about.heroBody")}
          </p>
          <div className="flex flex-wrap gap-3 mt-5 font-mono text-[10px] text-ink-3 tracking-widest uppercase">
            <span>11 {t("about.statFunctionalPages")}</span>
            <span className="text-ink-4">·</span>
            <span>4 {t("about.statTeaserPages")}</span>
            <span className="text-ink-4">·</span>
            <span>13 {t("about.statChains")}</span>
            <span className="text-ink-4">·</span>
            <span>10+ {t("about.statCex")}</span>
          </div>
        </div>
      </div>

      {/* ── Architecture diagram ────────────────────────────────────────── */}
      <Section icon={GitBranch} title={t("about.sectionArch")} accent="cyan">
        <p className="font-mono text-[11px] text-ink-3 mb-4 leading-relaxed">
          {/* Intentionally English — technical architecture prose is grant-facing and authored in English */}
          Z-SWAP is a Next.js 14 App Router application deployed on Vercel edge infrastructure.
          The frontend talks directly to public DEX APIs, blockchain RPCs, and price-data feeds.
          CEX operations are proxied through Next.js route handlers so API keys stay server-side.
          ZION calls Anthropic via a streaming route handler; the model output is advisory-only
          and never triggers on-chain actions autonomously.
        </p>
        {/* Layer diagram */}
        <div className="space-y-2">
          <div className="flex justify-center">
            <ArchNode label="Browser / Mobile" sublabel="React 18 · Next.js 14 App Router · Tailwind CSS" accent="cyan" />
          </div>
          <div className="flex justify-center">
            <div className="w-0.5 h-4 bg-cyan/20 mx-auto" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ArchNode label="DEX Swap Layer" sublabel="0x v2 · LiFi · Jupiter · CoW" accent="cyan" />
            <ArchNode label="CEX Console" sublabel="CCXT → /api/cex/* proxy" accent="violet" />
            <ArchNode label="ZION AI" sublabel="Claude Haiku 4.5 stream" accent="gold" />
            <ArchNode label="Risk Scanner" sublabel="GoPlus · Honeypot.is" accent="green" />
          </div>
          <div className="flex justify-center">
            <div className="w-0.5 h-4 bg-white/10 mx-auto" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <ArchNode label="Wallet Layer" sublabel="Wagmi · Viem · Solana Adapters" accent="cyan" />
            <ArchNode label="Price Data" sublabel="GeckoTerminal · DexScreener" accent="violet" />
            <ArchNode label="On-chain RPCs" sublabel="13 chains · public + private" accent="gold" />
          </div>
        </div>
      </Section>

      {/* ── Value proposition ───────────────────────────────────────────── */}
      <Section icon={Zap} title={t("about.sectionValueProp")} accent="gold">
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              icon: ArrowLeftRight, accent: "text-cyan", bg: "bg-cyan/[0.06] border-cyan/20",
              title: t("about.vpSwapTitle"), body: t("about.vpSwapBody"),
            },
            {
              icon: Bot, accent: "text-gold", bg: "bg-gold/[0.06] border-gold/20",
              title: t("about.vpZionTitle"), body: t("about.vpZionBody"),
            },
            {
              icon: BarChart3, accent: "text-violet", bg: "bg-violet/[0.06] border-violet/20",
              title: t("about.vpCexTitle"), body: t("about.vpCexBody"),
            },
          ].map(({ icon: Icon, accent, bg, title, body }) => (
            <div key={title} className={`rounded-xl border p-4 ${bg}`}>
              <Icon className={`w-5 h-5 ${accent} mb-2`} />
              <h3 className="font-display font-bold text-sm text-ink mb-1.5">{title}</h3>
              <p className="font-mono text-[10px] text-ink-3 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── DEX integrations ────────────────────────────────────────────── */}
      <Section icon={Layers} title={t("about.sectionDex")} accent="cyan">
        {DEX_INTEGRATIONS.map((i) => <IntegRow key={i.name} {...i} />)}
      </Section>

      {/* ── CEX integrations ────────────────────────────────────────────── */}
      <Section icon={BarChart3} title={t("about.sectionCex")} accent="violet">
        {CEX_INTEGRATIONS.map((i) => <IntegRow key={i.name} {...i} />)}
      </Section>

      {/* ── AI integration ──────────────────────────────────────────────── */}
      <Section icon={Bot} title={t("about.sectionAi")} accent="gold">
        {AI_INTEGRATIONS.map((i) => <IntegRow key={i.name} {...i} />)}
        <p className="font-mono text-[10px] text-ink-3 mt-3 pt-3 border-t border-white/5 leading-relaxed">
          {t("about.aiDisclaimer")}
        </p>
      </Section>

      {/* ── Data + Security ─────────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 gap-6">
        <Section icon={Globe2} title={t("about.sectionData")} accent="cyan">
          {DATA_INTEGRATIONS.map((i) => <IntegRow key={i.name} {...i} />)}
        </Section>
        <Section icon={Shield} title={t("about.sectionSecurity")} accent="green">
          {SECURITY_INTEGRATIONS.map((i) => <IntegRow key={i.name} {...i} />)}
        </Section>
      </div>

      {/* ── Tech stack ──────────────────────────────────────────────────── */}
      <Section icon={Cpu} title={t("about.sectionTechStack")} accent="violet">
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 font-mono text-[11px]">
          {[
            ["Framework",        "Next.js 14.2 (App Router) · React 18.3 · TypeScript 5.6"],
            ["Styling",          "Tailwind CSS 3.4 · Framer Motion 11 · Radix UI"],
            ["EVM Wallet",       "Wagmi 2.19 · Viem 2.49 · MetaMask SDK · Coinbase SDK"],
            ["Solana Wallet",    "Solana wallet-adapter-react · Phantom · Solflare"],
            ["State / Queries",  "Zustand 5 · TanStack Query 5"],
            ["Charts",           "Lightweight-charts 4.2 (OHLCV)"],
            ["3D",               "Three.js 0.170 · @react-three/fiber (dynamically loaded)"],
            ["AI",               "Anthropic SDK 0.96 (server-side streaming only)"],
            ["CEX",              "CCXT 4.5 (externalized, server-side only)"],
            ["Deploy",           "Vercel (Edge + Serverless) · HSTS preload"],
          ].map(([cat, val]) => (
            <div key={cat} className="flex gap-2 py-1.5 border-b border-white/[0.04] last:border-0">
              <span className="text-ink-3 w-28 flex-shrink-0">{cat}</span>
              <span className="text-ink-2">{val}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Non-custodial posture ───────────────────────────────────────── */}
      <Section icon={Lock} title={t("about.sectionNonCustodial")} accent="green">
        <div className="space-y-3">
          {[
            t("about.ncPoint1"),
            t("about.ncPoint2"),
            t("about.ncPoint3"),
            t("about.ncPoint4"),
          ].map((pt) => (
            <div key={pt} className="flex gap-3">
              <Shield className="w-3.5 h-3.5 text-green flex-shrink-0 mt-0.5" />
              <p className="font-mono text-[11px] text-ink-2 leading-relaxed">{pt}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-white/5">
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">{t("about.ncFooter")}</p>
        </div>
      </Section>

    </div>
  );
}
