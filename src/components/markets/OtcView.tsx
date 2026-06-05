"use client";

import { useState } from "react";
import {
  Handshake, ArrowDownToLine, ArrowUpFromLine, Lock, Briefcase, Eye,
  TrendingUp,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import TeaserShell, { TeaserCard, type TeaserTabOption } from "@/components/teaser/TeaserShell";
import { cn } from "@/lib/cn";

/**
 * "Em breve" gate for the OTC desk. See PR #36 for the full rationale.
 * This file is i18n-only — all visible strings live in messages.ts
 * under the `otc` + `teaser` namespaces.
 */

const WAITLIST_KEY = "zswap_otc_waitlist_v1";

type Side = "buy" | "sell";

export default function OtcView() {
  const t = useT();
  const [side, setSide] = useState<Side>("buy");

  const tabs: [TeaserTabOption<Side>, TeaserTabOption<Side>] = [
    { id: "buy",  label: t("otc.tabBuy"),  icon: ArrowDownToLine, tone: "green"  },
    { id: "sell", label: t("otc.tabSell"), icon: ArrowUpFromLine, tone: "violet" },
  ];

  return (
    <TeaserShell<Side>
      hero={{
        titleA:   t("otc.titleA"),
        titleB:   t("otc.titleB"),
        subtitle: <>{t("otc.subtitle1")} <b className="text-ink">{t("otc.subtitleAmounts")}</b>{t("otc.subtitle2")}</>,
      }}
      tabs={{ value: side, onChange: setSide, options: tabs }}
      waitlist={{
        Icon:       Lock,
        title:      t("otc.waitlistTitle"),
        body:       t("otc.waitlistBody"),
        doneHL:     t("otc.waitlistDoneHL"),
        doneBody:   t("otc.waitlistDoneBody"),
        storageKey: WAITLIST_KEY,
        audience:   "company",
      }}
      trustLine={t("otc.trustLine")}
    >
      <TeaserCard>
        {side === "buy" ? <BuyPreview /> : <SellPreview />}
        <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/5">
          <Stat label={t("otc.statSlippage")} value={t("otc.statSlippageVal")} sub={t("otc.statSlippageSub")} tone="cyan"   />
          <Stat label={t("otc.statSettle")}   value={t("otc.statSettleVal")}   sub={t("otc.statSettleSub")}   tone="green"  />
          <Stat label={t("otc.statTicket")}   value={t("otc.statTicketVal")}   sub={t("otc.statTicketSub")}   tone="violet" />
        </div>
      </TeaserCard>

      {/* How it works */}
      <div className="rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 space-y-4">
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("otc.howItWorks")}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Step n={1} title={t("otc.step1Title")} body={t("otc.step1Body")} Icon={Briefcase} tone="cyan"   />
          <Step n={2} title={t("otc.step2Title")} body={t("otc.step2Body")} Icon={Eye}       tone="violet" />
          <Step n={3} title={t("otc.step3Title")} body={t("otc.step3Body")} Icon={Handshake} tone="green"  />
        </div>
      </div>
    </TeaserShell>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function BuyPreview() {
  const t = useT();
  return (
    <>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
        {t("otc.exampleBuy")}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreviewSide label={t("otc.youWantToPay")}     amount={t("otc.payAmount")}        sub={t("otc.payChain")}      tone="violet" icon={<ArrowUpFromLine className="w-3.5 h-3.5" />} />
        <PreviewSide label={t("otc.youWantToReceive")} amount={t("otc.receiveAmountBuy")} sub={t("otc.receiveSubBuy")} tone="green"  icon={<ArrowDownToLine className="w-3.5 h-3.5" />} />
      </div>
      <MockQuotesRow />
    </>
  );
}

function SellPreview() {
  const t = useT();
  return (
    <>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
        {t("otc.exampleSell")}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreviewSide label={t("otc.youWantToSell")}           amount={t("otc.sellAmount")}        sub={t("otc.sellSub")}        tone="violet" icon={<ArrowUpFromLine className="w-3.5 h-3.5" />} />
        <PreviewSide label={t("otc.youWantToReceiveAtLeast")} amount={t("otc.receiveAmountSell")} sub={t("otc.receiveSubSell")} tone="green"  icon={<ArrowDownToLine className="w-3.5 h-3.5" />} />
      </div>
      <MockQuotesRow />
    </>
  );
}

function MockQuotesRow() {
  const t = useT();
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">{t("otc.quotesHeader")}</div>
        <div className="inline-flex items-center gap-1 font-mono text-[9px] text-green">
          <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
          {t("otc.quotesLive")}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {[
          { mm: "Wintermute",  px: "$3,425.71", best: true,  delta: t("otc.quoteBest") },
          { mm: "Amber Group", px: "$3,425.39", best: false, delta: "+0.01%" },
          { mm: "GSR",         px: "$3,425.04", best: false, delta: "+0.02%" },
          { mm: "Cumberland",  px: "$3,424.87", best: false, delta: "+0.02%" },
        ].map((q) => (
          <div key={q.mm} className={cn(
            "flex items-center gap-3 px-2.5 py-1.5 rounded border",
            q.best ? "border-green/30 bg-green/[0.04]" : "border-white/5",
          )}>
            <span className="font-mono text-[11px] text-ink-2 flex-1">{q.mm}</span>
            <span className="font-mono text-[11px] text-ink tabular-nums">{q.px}</span>
            <span className={cn(
              "font-mono text-[9px] tracking-widest uppercase",
              q.best ? "text-green" : "text-ink-3",
            )}>
              {q.delta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewSide({
  label, amount, sub, tone, icon,
}: {
  label: string; amount: string; sub: string;
  tone: "violet" | "green"; icon: React.ReactNode;
}) {
  const ring = tone === "green" ? "border-green/20 bg-green/[0.04]" : "border-violet/20 bg-violet/[0.04]";
  const txt  = tone === "green" ? "text-green" : "text-violet";
  return (
    <div className={cn("rounded-xl border p-3", ring)}>
      <div className={cn("inline-flex items-center gap-1 font-mono text-[9px] tracking-widest uppercase", txt)}>
        {icon}
        {label}
      </div>
      <div className="font-display font-extrabold text-xl text-ink mt-1.5 tabular-nums">{amount}</div>
      <div className="font-mono text-[10px] text-ink-3 tracking-wide mt-0.5">{sub}</div>
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

// Suppress unused-import warning — keeping TrendingUp around for the
// imminent "live RFQ feed" iteration after waitlist hits threshold.
void TrendingUp;
