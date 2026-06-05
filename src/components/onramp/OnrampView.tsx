"use client";

import { useState } from "react";
import {
  CreditCard, ArrowDownToLine, ArrowUpFromLine, Bell,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import TeaserShell, { TeaserCard, type TeaserTabOption } from "@/components/teaser/TeaserShell";
import { cn } from "@/lib/cn";

/**
 * "Em breve" gate for the fiat ↔ crypto onramp. See PR #30 for the
 * full rationale. This file is i18n-only — all visible strings come
 * from messages.ts under the `buy` and `teaser` namespaces.
 */

const WAITLIST_KEY = "zswap_onramp_waitlist_v1";

type Mode = "buy" | "sell";

export default function OnrampView() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("buy");

  const tabs: [TeaserTabOption<Mode>, TeaserTabOption<Mode>] = [
    { id: "buy",  label: t("buy.tabBuy"),  icon: ArrowDownToLine, tone: "green"  },
    { id: "sell", label: t("buy.tabSell"), icon: ArrowUpFromLine, tone: "violet" },
  ];

  return (
    <TeaserShell<Mode>
      hero={{
        titleA:   t("buy.titleA"),
        titleHL:  t("buy.titleHL"),
        titleB:   t("buy.titleB"),
        subtitle: t("buy.subtitle"),
      }}
      tabs={{ value: mode, onChange: setMode, options: tabs }}
      waitlist={{
        Icon:       Bell,
        title:      t("buy.waitlistTitle"),
        body:       t("buy.waitlistBody"),
        doneHL:     t("buy.waitlistDoneHL"),
        doneBody:   t("buy.waitlistDoneBody"),
        storageKey: WAITLIST_KEY,
        audience:   "personal",
      }}
      trustLine={t("buy.trustLine")}
    >
      <TeaserCard>
        {mode === "buy" ? <BuyPreview /> : <SellPreview />}
        <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/5">
          <Stat label={t("buy.statSettlement")} value={t("buy.statSettlementVal")} tone="cyan" />
          <Stat label={t("buy.statFee")}        value={t("buy.statFeeVal")}        tone="green" />
          <Stat label={t("buy.statNetworks")}   value={t("buy.statNetworksVal")}   tone="violet" />
        </div>
      </TeaserCard>
    </TeaserShell>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function BuyPreview() {
  const t = useT();
  return (
    <>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
        {t("buy.examBuy")}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreviewSide label={t("buy.youPay")} amount={t("buy.youPayAmount")} sub={t("buy.youPaySub")} tone="violet" icon={<CreditCard className="w-3.5 h-3.5" />} />
        <PreviewSide label={t("buy.youReceive")} amount={t("buy.youReceiveBuyAmount")} sub={t("buy.youReceiveBuySub")} tone="green" icon={<ArrowDownToLine className="w-3.5 h-3.5" />} />
      </div>
      <ul className="space-y-1.5 font-mono text-[11px] text-ink-2">
        <Li>{t("buy.buyBullet1")}</Li>
        <Li>{t("buy.buyBullet2")}</Li>
        <Li>{t("buy.buyBullet3")}</Li>
      </ul>
    </>
  );
}

function SellPreview() {
  const t = useT();
  return (
    <>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
        {t("buy.examSell")}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreviewSide label={t("buy.youSell")} amount={t("buy.youSellAmount")} sub={t("buy.youSellSub")} tone="violet" icon={<ArrowUpFromLine className="w-3.5 h-3.5" />} />
        <PreviewSide label={t("buy.youReceive")} amount={t("buy.youReceiveSellAmount")} sub={t("buy.youReceiveSellSub")} tone="green" icon={<CreditCard className="w-3.5 h-3.5" />} />
      </div>
      <ul className="space-y-1.5 font-mono text-[11px] text-ink-2">
        <Li>{t("buy.sellBullet1")}</Li>
        <Li>{t("buy.sellBullet2")}</Li>
        <Li>{t("buy.sellBullet3")}</Li>
      </ul>
    </>
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

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="w-1 h-1 rounded-full bg-cyan mt-1.5 flex-shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "cyan" | "green" | "violet" }) {
  const txt = tone === "cyan" ? "text-cyan" : tone === "green" ? "text-green" : "text-violet";
  return (
    <div className="text-center">
      <div className={cn("font-display font-bold text-lg tabular-nums", txt)}>{value}</div>
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mt-0.5">{label}</div>
    </div>
  );
}
