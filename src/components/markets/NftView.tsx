"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Gem, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Sparkles,
  Mail, CheckCircle2, Loader2, ArrowRight, Star, TrendingUp,
  TrendingDown, Bot, Box,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * "Em breve" gate for the NFT marketplace.
 *
 * Z-SWAP's NFT surface is a multi-chain aggregator (OpenSea, Blur,
 * Magic Eden, LooksRare …) with on-chain Seaport / Magic Eden CMM
 * settlement and ZION AI rarity/holder/wash-trade scoring overlaid.
 * No off-chain orderbook custody, royalties paid per the collection's
 * on-chain policy.
 *
 * This page is the v0 teaser — same pattern as /buy, /otc, /p2p.
 * All strings live in messages.ts under `nft.*` + `teaser.*`.
 */

const WAITLIST_KEY = "zswap_nft_waitlist_v1";

interface MockCollection {
  name:    string;
  initials: string;
  color:   string;
  floor:   string;
  vol24:   string;
  change:  number;   // percentage (positive = up)
  chain:   string;
}

const FEATURED: MockCollection[] = [
  { name: "Bored Ape Yacht Club", initials: "BA", color: "#F2C879", floor: "12.4 ETH",  vol24: "184 ETH",  change: +3.2,  chain: "Ethereum" },
  { name: "Pudgy Penguins",        initials: "PP", color: "#00E8FF", floor: "5.8 ETH",   vol24: "92 ETH",   change: +1.7,  chain: "Ethereum" },
  { name: "Mad Lads",              initials: "ML", color: "#FF5C7A", floor: "210 SOL",   vol24: "1.4k SOL", change: -2.1,  chain: "Solana"   },
  { name: "Azuki",                 initials: "AZ", color: "#9F5FFF", floor: "3.1 ETH",   vol24: "67 ETH",   change: +0.4,  chain: "Ethereum" },
  { name: "DeGods",                initials: "DG", color: "#22D27E", floor: "8.6 SOL",   vol24: "320 SOL",  change: +5.8,  chain: "Solana"   },
];

export default function NftView() {
  const t = useT();
  const [mode, setMode] = useState<"browse" | "list">("browse");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return !!window.localStorage.getItem(WAITLIST_KEY); } catch { return false; }
  });

  const onJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return;
    setSubmitting(true);
    try {
      window.localStorage.setItem(WAITLIST_KEY, JSON.stringify({ email: trimmed, at: Date.now() }));
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10 space-y-6">
      {/* Hero */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/30 bg-gold/[0.05] font-mono text-[10px] tracking-widest uppercase text-gold">
          <Sparkles className="w-3 h-3" /> {t("teaser.soon")}
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink leading-tight">
          <span className="text-gradient-cyan">{t("nft.titleA")}</span><br />
          {t("nft.titleB")}
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed max-w-2xl">
          {t("nft.subtitle1")} <b className="text-ink">{t("nft.subtitleSources")}</b>{t("nft.subtitle2")}
        </p>
      </div>

      {/* Mode tabs */}
      <div className="inline-flex w-full rounded-xl border border-white/5 bg-bg-1/30 p-1">
        <button
          type="button"
          onClick={() => setMode("browse")}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            mode === "browse" ? "bg-green/15 text-green border border-green/30" : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          {t("nft.tabBrowse")}
        </button>
        <button
          type="button"
          onClick={() => setMode("list")}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            mode === "list" ? "bg-violet/15 text-violet border border-violet/30" : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowUpFromLine className="w-3.5 h-3.5" />
          {t("nft.tabList")}
        </button>
      </div>

      {/* Collections preview */}
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-20 w-72 h-72 rounded-full bg-violet/10 blur-3xl pointer-events-none" />

        <div className="relative space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
              {t("nft.featuredCollections")}
            </div>
            <div className="inline-flex items-center gap-1 font-mono text-[9px] text-green">
              <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
              live
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FEATURED.map((c) => (
              <CollectionRow key={c.name} c={c} mode={mode} />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/5">
            <Stat label={t("nft.statCollections")}  value={t("nft.statCollectionsVal")}  sub={t("nft.statCollectionsSub")}  tone="cyan"   />
            <Stat label={t("nft.statMarketplaces")} value={t("nft.statMarketplacesVal")} sub={t("nft.statMarketplacesSub")} tone="violet" />
            <Stat label={t("nft.statChains")}       value={t("nft.statChainsVal")}       sub={t("nft.statChainsSub")}       tone="green"  />
          </div>
        </div>
      </motion.div>

      {/* How it works */}
      <div className="rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 space-y-4">
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
          {t("nft.howItWorks")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Step n={1} title={t("nft.step1Title")} body={t("nft.step1Body")} Icon={Box}   tone="cyan"   />
          <Step n={2} title={t("nft.step2Title")} body={t("nft.step2Body")} Icon={Bot}   tone="violet" />
          <Step n={3} title={t("nft.step3Title")} body={t("nft.step3Body")} Icon={Gem}   tone="green"  />
        </div>
      </div>

      {/* Waitlist */}
      <motion.div
        layout
        className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/[0.04] to-cyan/[0.03] p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <Star className="w-4 h-4 text-gold" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-base text-ink">
              {t("nft.waitlistTitle")}
            </h2>
            <p className="font-sans text-xs sm:text-sm text-ink-2 leading-relaxed mt-1">
              {t("nft.waitlistBody")}
            </p>
          </div>
        </div>

        {submitted ? (
          <div className="rounded-lg border border-green/30 bg-green/[0.05] px-3 py-3 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
            <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
              <b className="text-green">{t("nft.waitlistDoneHL")}</b> {t("nft.waitlistDoneBody")}
            </div>
          </div>
        ) : (
          <form onSubmit={onJoin} className="flex items-stretch gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-white/10 bg-bg-2 px-3 focus-within:border-gold/40">
              <Mail className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("teaser.emailPersonal")}
                maxLength={120}
                className="flex-1 min-w-0 bg-transparent outline-none font-mono text-sm text-ink placeholder:text-ink-4 py-2.5"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="px-4 py-2.5 rounded-lg border border-gold/40 bg-gold/15 text-gold font-mono text-[11px] tracking-widest uppercase hover:bg-gold/25 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              {t("teaser.enter")}
            </button>
          </form>
        )}
      </motion.div>

      {/* Trust */}
      <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          {t("nft.trustLine")}
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function CollectionRow({ c, mode }: { c: MockCollection; mode: "browse" | "list" }) {
  const t = useT();
  const tone = mode === "browse" ? "green" : "violet";
  const toneCls = tone === "green"
    ? "border-green/30 bg-green/[0.06] text-green"
    : "border-violet/30 bg-violet/[0.06] text-violet";
  const up = c.change >= 0;
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] hover:border-white/10 transition-colors p-3 flex items-center gap-3">
      <div
        className="w-11 h-11 rounded-lg flex items-center justify-center font-mono text-[11px] font-extrabold flex-shrink-0"
        style={{
          background: `linear-gradient(135deg, ${c.color}30, ${c.color}10)`,
          color: c.color,
          border: `1px solid ${c.color}55`,
        }}
      >
        {c.initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display font-bold text-xs text-ink truncate">{c.name}</div>
        <div className="font-mono text-[9px] text-ink-3 tracking-wide uppercase truncate">{c.chain}</div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="font-mono text-[10px] text-ink-2 tabular-nums">
            <span className="text-ink-3">{t("nft.floor")}:</span> {c.floor}
          </span>
          <span className={cn(
            "inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums",
            up ? "text-green" : "text-red",
          )}>
            {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {up ? "+" : ""}{c.change.toFixed(1)}%
          </span>
        </div>
      </div>
      <button
        type="button"
        disabled
        className={cn(
          "px-2.5 py-1 rounded border font-mono text-[10px] tracking-widest uppercase opacity-80 cursor-not-allowed",
          toneCls,
        )}
      >
        {mode === "browse" ? t("nft.tabBrowse").split("·")[0].trim() : t("nft.tabList").split("·")[0].trim()}
      </button>
    </div>
  );
}

function Step({
  n, title, body, Icon, tone,
}: {
  n: number; title: string; body: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: "cyan" | "green" | "violet";
}) {
  const cls =
    tone === "cyan"   ? "border-cyan/20 bg-cyan/[0.04] text-cyan"
    : tone === "green"? "border-green/20 bg-green/[0.04] text-green"
                      : "border-violet/20 bg-violet/[0.04] text-violet";
  return (
    <div className={cn("rounded-xl border p-3 space-y-2", cls)}>
      <div className="flex items-center gap-2">
        <div className="font-mono text-[9px] tracking-widest opacity-70">#{n}</div>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="font-display font-bold text-sm text-ink">{title}</div>
      <p className="font-sans text-[11px] text-ink-2 leading-relaxed">{body}</p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "cyan" | "green" | "violet" }) {
  const txt = tone === "cyan" ? "text-cyan" : tone === "green" ? "text-green" : "text-violet";
  return (
    <div className="text-center">
      <div className={cn("font-display font-bold text-lg tabular-nums", txt)}>{value}</div>
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mt-0.5">{label}</div>
      <div className="font-mono text-[9px] text-ink-4 mt-0.5">{sub}</div>
    </div>
  );
}
