"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  CreditCard, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Sparkles,
  Mail, CheckCircle2, Loader2, ArrowRight, Bell,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * "Em breve" gate for the fiat ↔ crypto onramp. See PR #30 for the
 * full rationale. This file is i18n-only — all visible strings come
 * from messages.ts under the `buy` and `teaser` namespaces.
 */

const WAITLIST_KEY = "zswap_onramp_waitlist_v1";

export default function OnrampView() {
  const t = useT();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
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
          {t("buy.titleA")} <span className="text-gradient-cyan">{t("buy.titleHL")}</span><br />
          {t("buy.titleB")}
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed max-w-2xl">
          {t("buy.subtitle")}
        </p>
      </div>

      {/* Mode tabs */}
      <div className="inline-flex w-full rounded-xl border border-white/5 bg-bg-1/30 p-1">
        <button
          type="button"
          onClick={() => setMode("buy")}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            mode === "buy" ? "bg-green/15 text-green border border-green/30" : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          {t("buy.tabBuy")}
        </button>
        <button
          type="button"
          onClick={() => setMode("sell")}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            mode === "sell" ? "bg-violet/15 text-violet border border-violet/30" : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowUpFromLine className="w-3.5 h-3.5" />
          {t("buy.tabSell")}
        </button>
      </div>

      {/* Preview card */}
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-20 w-72 h-72 rounded-full bg-violet/10 blur-3xl pointer-events-none" />

        <div className="relative space-y-5">
          {mode === "buy" ? <BuyPreview /> : <SellPreview />}

          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/5">
            <Stat label={t("buy.statSettlement")} value={t("buy.statSettlementVal")} tone="cyan" />
            <Stat label={t("buy.statFee")} value={t("buy.statFeeVal")} tone="green" />
            <Stat label={t("buy.statNetworks")} value={t("buy.statNetworksVal")} tone="violet" />
          </div>
        </div>
      </motion.div>

      {/* Waitlist */}
      <motion.div
        layout
        className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/[0.04] to-cyan/[0.03] p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <Bell className="w-4 h-4 text-gold" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-base text-ink">
              {t("buy.waitlistTitle")}
            </h2>
            <p className="font-sans text-xs sm:text-sm text-ink-2 leading-relaxed mt-1">
              {t("buy.waitlistBody")}
            </p>
          </div>
        </div>

        {submitted ? (
          <div className="rounded-lg border border-green/30 bg-green/[0.05] px-3 py-3 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
            <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
              <b className="text-green">{t("buy.waitlistDoneHL")}</b> {t("buy.waitlistDoneBody")}
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

      {/* Trust line */}
      <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          {t("buy.trustLine")}
        </p>
      </div>
    </div>
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
