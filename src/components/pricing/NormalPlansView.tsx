"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Crown, ShieldCheck, Swords } from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { PLAN_TIERS, usdToSol, normalMonthlyUsd, type PlanTier } from "@/lib/pricing/plans";

/**
 * Normal (recurring) plans — the WARRIORS who serve the gods. Sister page to
 * /pricing (launch NFT, gods). Recurring monthly, +30% vs the launch rate, no
 * Founder layer (that's exclusive to the launch NFT holders). USD-pegged: the
 * monthly USD is authoritative, SOL/month shown live.
 *
 * i18n: reuses the shared feature keys; page-specific copy is PT (BR-first) for
 * now — full i18n is a follow-up.
 */

type Accent = "gold" | "violet" | "prismatic";
const ACCENT: Record<Accent, { name: string; check: string; ring: string; cta: string }> = {
  gold:      { name: "text-gold",   check: "text-gold",   ring: "border-gold/30",   cta: "border-gold/40 bg-gold/15 text-gold" },
  violet:    { name: "text-violet", check: "text-violet", ring: "border-violet/30", cta: "border-violet/40 bg-violet/15 text-violet" },
  prismatic: { name: "bg-clip-text text-transparent bg-[linear-gradient(120deg,#00E8FF,#9F5FFF,#F5A623)]", check: "text-gold", ring: "border-violet/30", cta: "border-violet/40 bg-violet/15 text-ink" },
};

const ACCENT_BY_TIER: Record<string, Accent> = { pro: "gold", trader: "violet", pilot: "prismatic" };

// Warriors get the premium features but NOT the Founder layer (launch-only).
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
          <Swords className="w-3 h-3" /> Planos · Os Guerreiros
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-4xl text-ink leading-tight">
          Assinatura mensal — <span className="text-gradient-cyan">os guerreiros</span> que servem aos deuses
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed">
          Acesso premium recorrente, sem NFT. Os mesmos poderes dos deuses do lançamento,
          cobrados por mês. Preço em USD, pago em SOL na cotação do dia.
        </p>
      </div>

      {/* Launch cross-sell banner */}
      <Link href="/pricing" className="block rounded-2xl border border-gold/25 bg-gold/[0.04] px-4 py-3.5 hover:bg-gold/[0.07] transition-colors">
        <div className="flex items-center gap-3">
          <Crown className="w-5 h-5 text-gold flex-shrink-0" />
          <p className="font-sans text-[13px] text-ink-2 leading-snug">
            <b className="text-gold">Comprou no lançamento? Você é um Deus.</b> Os Access Pass NFT
            (Freyr / Thor / Odin) dão 3 anos de premium num pagamento único + status Founder eterno —
            o melhor negócio. <span className="text-cyan">Ver a coleção de lançamento →</span>
          </p>
        </div>
      </Link>

      {/* Warrior tiers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-4 items-stretch">
        {PLAN_TIERS.map((p) => (
          <WarriorCard key={p.tier} plan={p} solUsd={solUsd} features={FEATURES_BY_TIER[p.tier]} model={MODEL_BY_TIER[p.tier]} t={t} />
        ))}
      </div>

      {/* Free tier note */}
      <div className="rounded-2xl border border-white/8 bg-bg-1/40 p-4 sm:p-5 max-w-3xl mx-auto text-center">
        <div className="font-display font-bold text-sm text-ink">Free · sempre grátis</div>
        <p className="font-sans text-[12px] text-ink-2 leading-relaxed mt-1">
          Swap aberto + segurança pré-trade + 5 análises ZION/dia. Sem cartão, sem assinatura.
        </p>
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

function WarriorCard({ plan, solUsd, features, model, t }: {
  plan: PlanTier; solUsd: number | null; features: MessageKey[]; model: string; t: (k: MessageKey) => string;
}) {
  const a = ACCENT[ACCENT_BY_TIER[plan.tier]];
  const monthlyUsd = normalMonthlyUsd(plan.usdTarget);
  const monthlySol = solUsd ? usdToSol(monthlyUsd, solUsd) : null;
  return (
    <div className={cn("flex flex-col h-full rounded-2xl border bg-bg-1/60 backdrop-blur-sm p-5", a.ring)}>
      <div className={cn("text-center font-display font-extrabold text-xl tracking-[0.18em] uppercase", a.name)}>
        {plan.warrior}
      </div>
      <div className="text-center font-mono text-[10px] text-ink-3 mt-1">
        {plan.warriorDesc} · serve {plan.god} {plan.rune}
      </div>

      {/* Monthly price (USD-pegged) */}
      <div className="mt-3 text-center">
        <span className="font-display font-extrabold text-2xl text-ink">${monthlyUsd.toFixed(2)}</span>
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
  );
}
