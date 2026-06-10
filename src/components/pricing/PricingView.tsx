"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Sparkles, X, Mail, ArrowRight, CheckCircle2, Loader2, Check,
  ShieldCheck, CalendarClock, ChevronDown, Clock, Infinity as InfinityIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useTier } from "@/lib/tier/client";
import type { Tier } from "@/lib/tier/types";
import SignInButton from "@/components/auth/SignInButton";
import PricingCard, { type TierConfig } from "./PricingCard";
import FounderBenefits from "./FounderBenefits";

const TIERS: TierConfig[] = [
  {
    id: "pro", accent: "gold", art: "/nft/pro.jpg",
    nameKey: "pricing.tierProName", priceKey: "pricing.tierProPrice",
    fiatKey: "pricing.tierProFiat", subKey: "pricing.tierProSub",
    modelKey: "pricing.tierProModel", capKey: "pricing.tierProCap",
    features: ["pricing.featSwap", "pricing.featSecurity", "pricing.featZionSonnet", "pricing.featAutopilot", "pricing.featFounder"],
  },
  {
    id: "trader", accent: "violet", art: "/nft/trader.png",
    nameKey: "pricing.tierTraderName", priceKey: "pricing.tierTraderPrice",
    fiatKey: "pricing.tierTraderFiat", subKey: "pricing.tierTraderSub",
    modelKey: "pricing.tierTraderModel", capKey: "pricing.tierTraderCap",
    features: ["pricing.featSwap", "pricing.featSecurity", "pricing.featZionSonnet", "pricing.featAutopilot", "pricing.featArb", "pricing.featSupport", "pricing.featFounder"],
  },
  {
    id: "pilot", accent: "prismatic", art: "/nft/pilot.jpg",
    highlighted: true, badgeKey: "pricing.founderPick",
    nameKey: "pricing.tierPilotName", priceKey: "pricing.tierPilotPrice",
    fiatKey: "pricing.tierPilotFiat", subKey: "pricing.tierPilotSub",
    modelKey: "pricing.tierPilotModel", capKey: "pricing.tierPilotCap",
    features: ["pricing.featZionOpus", "pricing.featAutopilot", "pricing.featArb", "pricing.featSupport", "pricing.featFounder"],
  },
];

const FREE_FEATURES: MessageKey[] = ["pricing.featSwap", "pricing.featSecurity", "pricing.featZionSonnet"];

const FAQ: { q: MessageKey; a: MessageKey }[] = [
  { q: "pricing.faq1Q", a: "pricing.faq1A" },
  { q: "pricing.faq2Q", a: "pricing.faq2A" },
  { q: "pricing.faq3Q", a: "pricing.faq3A" },
  { q: "pricing.faq4Q", a: "pricing.faq4A" },
  { q: "pricing.faq5Q", a: "pricing.faq5A" },
  { q: "pricing.faq6Q", a: "pricing.faq6A" },
];

const WAITLIST_KEY = "zswap_pricing_mint_waitlist";

export default function PricingView() {
  const t = useT();
  const [mintOpen, setMintOpen] = useState(false);
  const { authenticated, source, tier: currentTier, refresh } = useTier();
  const [selecting, setSelecting] = useState<Tier | null>(null);

  // The seeded admin wallet (source='admin' in tier_cache) can switch plans
  // live to test every gated surface — visitors keep the waitlist CTA.
  const isAdmin = authenticated && source === "admin";

  const selectTier = async (tier: Tier) => {
    setSelecting(tier);
    try {
      const res = await fetch("/api/tier/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tier }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw new Error(j?.error ?? `select ${res.status}`);
      refresh();
      toast.success(t("pricing.adminSwitched"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(null);
    }
  };

  const adminFor = (tier: Tier) =>
    isAdmin
      ? { isCurrent: currentTier === tier, selecting: selecting === tier, onSelect: () => selectTier(tier) }
      : undefined;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10 space-y-10">

      {/* Hero */}
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/30 bg-gold/[0.05] font-mono text-[10px] tracking-widest uppercase text-gold">
          <Sparkles className="w-3 h-3" /> {t("pricing.eyebrow")}
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-4xl text-ink leading-tight">
          {t("pricing.heroTitleA")} <span className="text-gradient-cyan">{t("pricing.heroTitleHL")}</span> {t("pricing.heroTitleB")}
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed">
          {t("pricing.heroSub")}
        </p>
      </div>

      {/* Tier comparison — 3 paid passes with their Access Pass artwork */}
      <div>
        <h2 className="font-mono text-[10px] tracking-widest uppercase text-ink-3 text-center mb-5">
          {t("pricing.tiersHeading")}
        </h2>

        {/* Sign-in strip — verify wallet tier; admin wallet unlocks the live
            plan switcher below */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 mb-6">
          {isAdmin ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gold/30 bg-gold/[0.05] font-mono text-[10px] tracking-wider uppercase text-gold text-center">
              {t("pricing.adminHint")}
            </div>
          ) : (
            <>
              <span className="font-sans text-xs text-ink-3">{t("pricing.signInHint")}</span>
              <SignInButton />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-4 items-stretch pt-2">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(tier.highlighted && "md:scale-105 md:z-10")}
            >
              <PricingCard
                tier={tier}
                onMint={() => setMintOpen(true)}
                admin={adminFor(tier.id as Tier)}
              />
            </div>
          ))}
        </div>

        {/* Free tier — simpler, no artwork */}
        <div className="mt-5 md:mt-8 rounded-2xl border border-white/8 bg-bg-1/40 backdrop-blur-sm p-4 sm:p-5 max-w-3xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="sm:w-44 flex-shrink-0">
              <div className="font-display font-bold text-sm text-ink tracking-wide">{t("pricing.tierFreeName")}</div>
              <div className="font-display font-extrabold text-xl text-ink mt-1">{t("pricing.tierFreePrice")}</div>
              <div className="font-mono text-[10px] text-ink-3 mt-1">
                {t("pricing.tierFreeModel")} · {t("pricing.tierFreeCap")}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-[12px] text-ink-2 leading-relaxed mb-2">{t("pricing.freeTagline")}</p>
              <ul className="space-y-1.5">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-ink-3" />
                    <span className="font-sans text-[12px] text-ink-2 leading-snug">{t(f)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="sm:w-36 flex-shrink-0">
              {isAdmin ? (
                currentTier === "free" ? (
                  <div className="w-full text-center rounded-lg border border-green/40 bg-green/[0.08] py-2.5 font-mono text-[10px] tracking-widest uppercase text-green">
                    {t("pricing.adminActive")}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => selectTier("free")}
                    disabled={selecting === "free"}
                    className="w-full text-center rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] py-2.5 font-mono text-[10px] tracking-widest uppercase text-ink-2 disabled:opacity-60"
                  >
                    {selecting === "free" ? "…" : t("pricing.adminUse")}
                  </button>
                )
              ) : (
                <div className="w-full text-center rounded-lg border border-white/8 bg-white/[0.02] py-2.5 font-mono text-[10px] tracking-widest uppercase text-ink-3">
                  {t("pricing.tierFreeCta")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Two layers explainer */}
      <div>
        <h2 className="font-display font-bold text-lg text-ink text-center mb-4">
          {t("pricing.layersHeading")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-cyan/20 bg-cyan/[0.03] p-5">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-cyan/30 bg-cyan/[0.06] font-mono text-[9px] tracking-widest uppercase text-cyan">
              <Clock className="w-3 h-3" /> {t("pricing.layerATag")}
            </div>
            <h3 className="font-display font-bold text-base text-ink mt-2">{t("pricing.layerATitle")}</h3>
            <p className="font-sans text-[13px] text-ink-2 leading-relaxed mt-1.5">{t("pricing.layerABody")}</p>
          </div>
          <div className="rounded-2xl border border-gold/25 bg-gold/[0.04] p-5">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gold/30 bg-gold/[0.06] font-mono text-[9px] tracking-widest uppercase text-gold">
              <InfinityIcon className="w-3 h-3" /> {t("pricing.layerBTag")}
            </div>
            <h3 className="font-display font-bold text-base text-ink mt-2">{t("pricing.layerBTitle")}</h3>
            <p className="font-sans text-[13px] text-ink-2 leading-relaxed mt-1.5">{t("pricing.layerBBody")}</p>
          </div>
        </div>
      </div>

      {/* Founder layer — the centerpiece */}
      <FounderBenefits />

      {/* FAQ */}
      <div>
        <h2 className="font-display font-bold text-lg text-ink text-center mb-4">
          {t("pricing.faqHeading")}
        </h2>
        <div className="space-y-2 max-w-3xl mx-auto">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group rounded-xl border border-white/5 bg-bg-1/40 overflow-hidden">
              <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3 font-display font-bold text-[13px] text-ink hover:text-cyan transition-colors">
                {t(q)}
                <ChevronDown className="w-4 h-4 text-ink-3 flex-shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-4 pb-4 font-sans text-[12px] text-ink-2 leading-relaxed">
                {t(a)}
              </p>
            </details>
          ))}
        </div>
      </div>

      {/* Trust line */}
      <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 flex items-start gap-2.5 max-w-3xl mx-auto">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">{t("pricing.trustLine")}</p>
      </div>

      {/* Legal disclaimer */}
      <p className="font-mono text-[9px] text-ink-4 leading-relaxed max-w-3xl mx-auto text-center border-t border-white/5 pt-6">
        {t("pricing.legalDisclaimer")}
      </p>

      <MintModal open={mintOpen} onOpenChange={setMintOpen} />
    </div>
  );
}

/* ── Mint waitlist modal (placeholder until FASE 5.4 mint is live) ──────── */

function MintModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none">
          <div className="glass-strong border border-gold/20 rounded-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
                  <CalendarClock className="w-4 h-4 text-gold" />
                </div>
                <Dialog.Title className="font-display font-bold text-base text-ink">
                  {t("pricing.mintModalTitle")}
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>

            <p className="font-sans text-sm text-ink-2 leading-relaxed">
              {t("pricing.mintModalBody")}
            </p>

            {submitted ? (
              <div className="rounded-lg border border-green/30 bg-green/[0.05] px-3 py-3 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
                <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
                  <b className="text-green">{t("pricing.mintDoneHL")}</b> {t("pricing.mintDoneBody")}
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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
