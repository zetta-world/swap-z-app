"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, ShieldCheck, Swords } from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PLAN_TIERS, usdToSol, normalMonthlyUsd, type PlanTier } from "@/lib/pricing/plans";

/**
 * A HIRD — the sworn war-band that serves the gods (hirð): the recurring
 * monthly plans. Sister page to /pricing (O Panteão — the launch NFT gods).
 * Monthly at +30% vs the launch rate, no Founder layer (launch-exclusive).
 * USD-pegged: monthly USD is authoritative, SOL/month shown live.
 *
 * Visual family shared with PricingCard (same accent frames/halos) so the two
 * pages read as one collection. Card hero = rune medallion of the warrior +
 * the REAL crest of the god served (public/tiers/*). When the warrior artwork
 * ships (Fase B — docs/PLANO-HIRD-REDESIGN.md), the medallion slot becomes an
 * art hero with a file swap.
 *
 * Free tier = THRALL (Rígsþula's serf class — serves without oath or cost).
 * i18n: shared feature keys reused; page copy is PT (BR-first), like /pricing.
 */

type Accent = "gold" | "violet" | "prismatic";
const ACCENT: Record<Accent, {
  frame: string; name: string; check: string; halo: string; glow: string; runeColor: string; seal: string;
}> = {
  gold: {
    frame: "bg-[linear-gradient(160deg,rgba(245,166,35,0.45),rgba(245,166,35,0.10)_45%,rgba(201,169,85,0.35))]",
    name:  "text-gold", check: "text-gold",
    halo:  "shadow-[0_0_44px_-10px_rgba(245,166,35,0.40)]",
    glow:  "hover:shadow-[0_0_64px_-16px_rgba(245,166,35,0.45)]",
    runeColor: "text-gold", seal: "border-gold/40",
  },
  violet: {
    frame: "bg-[linear-gradient(160deg,rgba(159,95,255,0.45),rgba(159,95,255,0.10)_45%,rgba(124,58,237,0.35))]",
    name:  "text-violet", check: "text-violet",
    halo:  "shadow-[0_0_44px_-10px_rgba(159,95,255,0.40)]",
    glow:  "hover:shadow-[0_0_64px_-16px_rgba(159,95,255,0.45)]",
    runeColor: "text-violet", seal: "border-violet/40",
  },
  prismatic: {
    frame: "bg-[linear-gradient(140deg,rgba(0,232,255,0.45),rgba(159,95,255,0.40)_50%,rgba(245,166,35,0.45))]",
    name:  "bg-clip-text text-transparent bg-[linear-gradient(120deg,#00E8FF,#9F5FFF,#F5A623)]",
    check: "text-gold",
    halo:  "shadow-[0_0_44px_-10px_rgba(159,95,255,0.45)]",
    glow:  "hover:shadow-[0_0_72px_-16px_rgba(159,95,255,0.55)]",
    runeColor: "bg-clip-text text-transparent bg-[linear-gradient(120deg,#00E8FF,#9F5FFF,#F5A623)]", seal: "border-violet/40",
  },
};

const ACCENT_BY_TIER: Record<string, Accent> = { pro: "gold", trader: "violet", pilot: "prismatic" };

// The Hird gets the premium features but NOT the Founder layer (launch-only).
const FEATURES_BY_TIER: Record<string, MessageKey[]> = {
  pro:    ["pricing.featSwap", "pricing.featSecurity", "pricing.featZionSonnet", "pricing.featAutopilot"],
  trader: ["pricing.featSwap", "pricing.featSecurity", "pricing.featZionSonnet", "pricing.featAutopilot", "pricing.featArb", "pricing.featSupport"],
  pilot:  ["pricing.featZionOpus", "pricing.featAutopilot", "pricing.featArb", "pricing.featSupport"],
};

const MODEL_BY_TIER: Record<string, string> = { pro: "Sonnet 4.6", trader: "Sonnet 4.6", pilot: "Opus 4.8" };

export default function NormalPlansView() {
  const t = useT();
  const [solUsd, setSolUsd] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/sol-price").then((r) => r.json())
      .then((j) => { if (alive) setSolUsd(typeof j?.solUsd === "number" ? j.solUsd : null); })
      .catch(() => { /* USD-only */ });
    return () => { alive = false; };
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10 space-y-10">
      {/* Hero */}
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-violet/30 bg-violet/[0.05] font-mono text-[10px] tracking-widest uppercase text-violet">
          <Swords className="w-3 h-3" /> A Hird · juramentados aos deuses
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-4xl text-ink leading-tight">
          <span className="text-gradient-cyan">A Hird</span> — o bando juramentado que serve aos deuses
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed">
          Acesso premium recorrente, sem NFT. Os mesmos poderes dos deuses do Panteão,
          cobrados por mês. Preço em USD, pago em SOL na cotação do dia.
        </p>
      </div>

      {/* Pantheon cross-sell — the three real crests, not an icon */}
      <Link href="/pricing" className="block rounded-2xl border border-gold/25 bg-gold/[0.04] px-4 py-4 hover:bg-gold/[0.07] transition-colors">
        <div className="flex items-center gap-4">
          <div className="flex -space-x-2 flex-shrink-0">
            {PLAN_TIERS.map((p) => (
              <span key={p.tier} className="relative w-10 h-10 rounded-full border border-gold/30 bg-bg-2 overflow-hidden flex items-center justify-center">
                <Image src={p.crest} alt={p.god} width={34} height={34} className="object-contain" />
              </span>
            ))}
          </div>
          <p className="font-sans text-[13px] text-ink-2 leading-snug">
            <b className="text-gold">Comprou no Panteão? Você é um Deus.</b> Os Access Pass NFT
            (Freyr / Thor / Odin) dão 3 anos de premium num pagamento único + status Founder eterno —
            o melhor negócio. <span className="text-cyan whitespace-nowrap">Ver o Panteão →</span>
          </p>
        </div>
      </Link>

      {/* The Hird — Berserkr raised as the anchor pick */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-4 items-stretch">
        {PLAN_TIERS.map((p) => (
          <WarriorCard
            key={p.tier} plan={p} solUsd={solUsd}
            features={FEATURES_BY_TIER[p.tier]} model={MODEL_BY_TIER[p.tier]} t={t}
            highlighted={p.tier === "trader"}
          />
        ))}
      </div>

      {/* THRALL — free tier, canonical Rígsþula ladder (Thrall → the Hird → the gods) */}
      <div className="rounded-2xl border border-white/8 bg-bg-1/40 p-4 sm:p-5 max-w-3xl mx-auto">
        <div className="flex items-center justify-center gap-3">
          <span className="relative w-12 h-12 rounded-full border border-white/15 overflow-hidden flex-shrink-0">
            <Image src="/warriors/thrall.jpg" alt="Thrall" fill sizes="48px" className="object-cover" />
          </span>
          <div className="text-left">
            <div className="font-display font-bold text-sm tracking-[0.18em] uppercase text-ink">Thrall <span className="font-mono text-[10px] tracking-normal normal-case text-ink-3">· sem juramento · sempre grátis</span></div>
            <p className="font-sans text-[12px] text-ink-2 leading-relaxed mt-0.5">
              Swap aberto + segurança pré-trade + 5 análises ZION/dia. Sem cartão, sem assinatura.
              Todo guerreiro começa em algum lugar.
            </p>
          </div>
        </div>
      </div>

      {/* Trust + legal */}
      <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 flex items-start gap-2.5 max-w-3xl mx-auto">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          Assinatura recorrente em breve via PIX (Mercado Pago) e SOL. Preço fixo em USD; o valor em
          SOL acompanha a cotação. Acesso a utilidade da plataforma — não é instrumento financeiro.
        </p>
      </div>
    </div>
  );
}

function WarriorCard({ plan, solUsd, features, model, t, highlighted }: {
  plan: PlanTier; solUsd: number | null; features: MessageKey[]; model: string;
  t: (k: MessageKey) => string; highlighted?: boolean;
}) {
  const a = ACCENT[ACCENT_BY_TIER[plan.tier]];
  const monthlyUsd = normalMonthlyUsd(plan);
  const monthlySol = solUsd ? usdToSol(monthlyUsd, solUsd) : null;

  return (
    <div className={cn(
      "relative h-full rounded-2xl p-px transition-shadow duration-300",
      a.frame, a.glow,
      highlighted && "md:-my-2",
    )}>
      {highlighted && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 px-2.5 py-0.5 rounded-full border border-violet/40 bg-bg-2 font-mono text-[9px] tracking-widest uppercase text-violet whitespace-nowrap">
          Mais escolhido
        </div>
      )}

      <div className="flex flex-col h-full rounded-[15px] bg-bg-1/90 backdrop-blur-sm p-5">
        {/* Rune medallion hero — becomes the artwork slot in Fase B */}
        <div className="relative mx-auto mt-1 mb-4">
          <div className={cn("relative w-24 h-24 rounded-full p-px", a.frame, a.halo)}>
            <div className="relative w-full h-full rounded-full bg-bg-2/95 overflow-hidden flex items-center justify-center">
              {plan.avatar ? (
                <Image src={plan.avatar} alt={plan.warrior} fill sizes="96px" className="object-cover" />
              ) : (
                <span className={cn("font-display font-extrabold text-4xl leading-none select-none", a.runeColor)}>
                  {plan.warriorRune}
                </span>
              )}
            </div>
          </div>
          {/* Seal: the REAL crest of the god this warrior serves */}
          <span className={cn("absolute -bottom-1.5 -right-1.5 w-9 h-9 rounded-full border bg-bg-2 overflow-hidden flex items-center justify-center", a.seal)}>
            <Image src={plan.crest} alt={plan.god} width={30} height={30} className="object-contain" />
          </span>
        </div>

        <div className={cn("text-center font-display font-extrabold text-xl tracking-[0.18em] uppercase", a.name)}>
          {plan.warrior}
        </div>
        <div className="text-center font-mono text-[10px] text-ink-3 mt-1">
          {plan.warriorDesc} · serve {plan.god} {plan.rune}
        </div>

        {/* Monthly price (USD-pegged) */}
        <div className="mt-3 text-center">
          <span className="font-display font-extrabold text-2xl text-ink">${monthlyUsd % 1 === 0 ? monthlyUsd.toLocaleString("en-US") : monthlyUsd.toFixed(2)}</span>
          <span className="font-mono text-[11px] text-ink-3">/mês</span>
          <div className="font-mono text-[10px] text-ink-4 mt-0.5">
            {monthlySol && monthlySol > 0 ? `≈ ${monthlySol.toFixed(monthlySol < 1 ? 3 : 2)} SOL/mês` : "pago em SOL"}
          </div>
        </div>

        <div className="mt-2 text-center font-mono text-[11px] text-ink-2">
          {model} <span className="text-ink-4">·</span> {plan.dailyAnalyses} análises/dia
        </div>

        <ul className="mt-4 space-y-2 flex-1">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", a.check)} />
              <span className="font-sans text-[12px] text-ink-2 leading-snug">{t(f)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 w-full text-center rounded-lg border border-white/10 bg-white/[0.03] py-2.5 font-mono text-[10px] tracking-widest uppercase text-ink-3">
          Assinatura em breve
        </div>
      </div>
    </div>
  );
}
