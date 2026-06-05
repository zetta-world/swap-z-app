"use client";

import { useState } from "react";
import {
  Users, ArrowDownToLine, ArrowUpFromLine, MessageSquare, Star,
  Lock, Banknote, CheckCircle2,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import TeaserShell, { TeaserCard, type TeaserTabOption } from "@/components/teaser/TeaserShell";
import { cn } from "@/lib/cn";

/**
 * "Em breve" gate for the P2P market.
 *
 * P2P on Z-SWAP is fiat ↔ crypto direct between users — peer-to-peer
 * via PIX (and other Brazilian rails: TED, Mercado Pago, boleto). One
 * user posts an ad ("I sell 500 USDT for R$ 2,650 via PIX"), another
 * accepts, escrow contract locks the crypto, taker pays fiat off-chain
 * via PIX QR, maker confirms receipt, escrow releases.
 *
 * v0 teaser only — real backend (ad relay, off-chain chat with
 * end-to-end encryption, escrow contract, reputation system, dispute
 * resolution) lives in subsequent PRs once the legal model (BCB
 * compliance, KYC tier) is finalized.
 *
 * This file is i18n-only — all visible strings come from messages.ts
 * under the `p2p` and `teaser` namespaces.
 */

const WAITLIST_KEY = "zswap_p2p_waitlist_v1";

type Side = "buy" | "sell";

export default function P2pView() {
  const t = useT();
  const [side, setSide] = useState<Side>("buy");

  const tabs: [TeaserTabOption<Side>, TeaserTabOption<Side>] = [
    { id: "buy",  label: t("p2p.tabBuy"),  icon: ArrowDownToLine, tone: "green"  },
    { id: "sell", label: t("p2p.tabSell"), icon: ArrowUpFromLine, tone: "violet" },
  ];

  const tradesLabel = t("p2p.tradesLabel");
  const buyLabel = t("p2p.buyAction");
  const sellLabel = t("p2p.sellAction");

  return (
    <TeaserShell<Side>
      hero={{
        titleA:   t("p2p.titleA"),
        titleB:   t("p2p.titleB"),
        subtitle: t("p2p.subtitle"),
      }}
      tabs={{ value: side, onChange: setSide, options: tabs }}
      waitlist={{
        Icon:       Star,
        title:      t("p2p.waitlistTitle"),
        body:       t("p2p.waitlistBody"),
        doneHL:     t("p2p.waitlistDoneHL"),
        doneBody:   t("p2p.waitlistDoneBody"),
        storageKey: WAITLIST_KEY,
        audience:   "personal",
      }}
      trustLine={t("p2p.trustLine")}
    >
      <TeaserCard>
        <div className="space-y-4">
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
            {side === "buy" ? t("p2p.offersBuy") : t("p2p.offersSell")}
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_1.1fr_0.6fr] gap-2 px-3 pb-2 border-b border-white/5 font-mono text-[9px] text-ink-3 tracking-widest uppercase">
            <span>{t("p2p.colAdvertiser")}</span>
            <span className="text-right">{t("p2p.colPrice")}</span>
            <span>{t("p2p.colLimits")}</span>
            <span>{t("p2p.colPayment")}</span>
            <span className="text-right">—</span>
          </div>

          {/* Offer rows */}
          <div className="space-y-1.5">
            <OfferRow user="thiago.btc" rating={4.98} trades={2417} price="5.30"  limits="100 · 50.000" methods={["PIX", "TED"]} sideTone={side === "buy" ? "green" : "violet"} tradesLabel={tradesLabel} ctaLabel={side === "buy" ? buyLabel : sellLabel} />
            <OfferRow user="ana_cripto" rating={4.97} trades={1183} price="5.29"  limits="50 · 20.000"  methods={["PIX"]}        sideTone={side === "buy" ? "green" : "violet"} tradesLabel={tradesLabel} ctaLabel={side === "buy" ? buyLabel : sellLabel} />
            <OfferRow user="zion.trader" rating={4.95} trades={812}  price="5.28" limits="200 · 100k"   methods={["PIX", "MP"]}  sideTone={side === "buy" ? "green" : "violet"} tradesLabel={tradesLabel} ctaLabel={side === "buy" ? buyLabel : sellLabel} />
            <OfferRow user="otc_brasil"  rating={4.92} trades={609}  price="5.27" limits="500 · 200k"   methods={["PIX", "TED"]} sideTone={side === "buy" ? "green" : "violet"} tradesLabel={tradesLabel} ctaLabel={side === "buy" ? buyLabel : sellLabel} />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/5">
            <Stat label={t("p2p.statSettle")}  value={t("p2p.statSettleVal")}  sub={t("p2p.statSettleSub")}  tone="cyan"   />
            <Stat label={t("p2p.statFee")}     value={t("p2p.statFeeVal")}     sub={t("p2p.statFeeSub")}     tone="green"  />
            <Stat label={t("p2p.statDispute")} value={t("p2p.statDisputeVal")} sub={t("p2p.statDisputeSub")} tone="violet" />
          </div>
        </div>
      </TeaserCard>

      {/* How it works */}
      <div className="rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 space-y-4">
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("p2p.howItWorks")}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Step n={1} title={t("p2p.step1Title")} body={t("p2p.step1Body")} Icon={Lock}            tone="cyan"   />
          <Step n={2} title={t("p2p.step2Title")} body={t("p2p.step2Body")} Icon={MessageSquare}   tone="violet" />
          <Step n={3} title={t("p2p.step3Title")} body={t("p2p.step3Body")} Icon={CheckCircle2}    tone="green"  />
        </div>
      </div>

      {/* Suppress unused-warn — kept for the live ad feed iteration */}
      <span style={{ display: "none" }}><Users className="w-0" /><Banknote className="w-0" /></span>
    </TeaserShell>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function OfferRow({
  user, rating, trades, price, limits, methods, sideTone, tradesLabel, ctaLabel,
}: {
  user: string; rating: number; trades: number;
  price: string; limits: string; methods: string[];
  sideTone: "green" | "violet";
  tradesLabel: string; ctaLabel: string;
}) {
  const ctaCls = sideTone === "green"
    ? "border-green/30 bg-green/[0.08] text-green hover:bg-green/[0.15]"
    : "border-violet/30 bg-violet/[0.08] text-violet hover:bg-violet/[0.15]";
  return (
    <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_1.1fr_0.6fr] gap-2 items-center px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02] hover:border-white/10 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-[9px] font-bold flex-shrink-0"
          style={{
            background: `${sideTone === "green" ? "#22D27E" : "#9F5FFF"}22`,
            color: sideTone === "green" ? "#22D27E" : "#9F5FFF",
            border: `1px solid ${sideTone === "green" ? "#22D27E" : "#9F5FFF"}55`,
          }}
        >
          {user.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-ink truncate">{user}</div>
          <div className="flex items-center gap-1 font-mono text-[9px] text-ink-3">
            <Star className="w-2 h-2 text-gold fill-gold" />
            {rating.toFixed(2)} · {trades} {tradesLabel}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm text-ink tabular-nums">R$ {price}</div>
        <div className="font-mono text-[9px] text-ink-3 uppercase">/USDT</div>
      </div>
      <div className="font-mono text-[10px] text-ink-2 tabular-nums">
        R$ {limits}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {methods.map((m) => (
          <span
            key={m}
            className="px-1.5 py-0.5 rounded text-[8px] font-mono tracking-widest uppercase border border-cyan/20 bg-cyan/[0.04] text-cyan"
          >
            {m}
          </span>
        ))}
      </div>
      <button
        type="button"
        disabled
        className={cn(
          "px-2.5 py-1 rounded border font-mono text-[10px] tracking-widest uppercase opacity-90 cursor-not-allowed",
          ctaCls,
        )}
      >
        {ctaLabel}
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
