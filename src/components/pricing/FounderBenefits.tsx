"use client";

import {
  Crown, BadgeCheck, ListChecks, Trophy, Vote,
  FlaskConical, Gauge, Palette, Infinity as InfinityIcon,
} from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";
import { BENEFICIOS } from "@/lib/founders-commercial-truth";

interface Benefit {
  Icon:    React.ComponentType<{ className?: string }>;
  titleKey: MessageKey;
  descKey:  MessageKey;
}

const APRESENTACAO: Record<string, Benefit> = {
  founder_badge_onchain: { Icon: BadgeCheck, titleKey: "pricing.founderBadge", descKey: "pricing.founderBadgeDesc" },
  early_access_priority: { Icon: ListChecks, titleKey: "pricing.founderWhitelist", descKey: "pricing.founderWhitelistDesc" },
  hall_of_fame_opt_in: { Icon: Trophy, titleKey: "pricing.founderHall", descKey: "pricing.founderHallDesc" },
  product_polls: { Icon: Vote, titleKey: "pricing.founderGovernance", descKey: "pricing.founderGovernanceDesc" },
  beta_access: { Icon: FlaskConical, titleKey: "pricing.founderBeta", descKey: "pricing.founderBetaDesc" },
  elevated_api_limits: { Icon: Gauge, titleKey: "pricing.founderApi", descKey: "pricing.founderApiDesc" },
  founder_theme: { Icon: Palette, titleKey: "pricing.founderCustom", descKey: "pricing.founderCustomDesc" },
};

const BENEFITS: Benefit[] = BENEFICIOS
  // Esta grade usa ícones de benefício ativo. Roadmap permanente é explicado
  // na seção de estados da venda, sem ser promovido aqui como disponível.
  .filter((b) => b.duracao === "STATUS_ENQUANTO_HOLDER" && b.estado === "AVAILABLE_AT_LAUNCH")
  .map((b) => APRESENTACAO[b.id])
  .filter((b): b is Benefit => Boolean(b));

export default function FounderBenefits() {
  const t = useT();

  return (
    // Gold-tinted glass frame matching the Access Pass card aesthetic
    <div className="rounded-3xl p-px bg-[linear-gradient(150deg,rgba(245,166,35,0.5),rgba(245,166,35,0.12)_45%,rgba(159,95,255,0.35))] shadow-[0_0_56px_-18px_rgba(245,166,35,0.35)]">
    <div className="relative overflow-hidden rounded-[23px] bg-gradient-to-br from-gold/[0.08] via-bg-1/70 to-violet/[0.06] backdrop-blur-xl p-6 sm:p-8">
      {/* Ambient glow */}
      <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full bg-gold/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-28 -left-20 w-80 h-80 rounded-full bg-violet/10 blur-3xl pointer-events-none" />

      <div className="relative">
        {/* Header */}
        <div className="flex items-start gap-3 mb-1">
          <div className="w-11 h-11 rounded-2xl bg-gold/15 border border-gold/40 flex items-center justify-center flex-shrink-0">
            <Crown className="w-5 h-5 text-gold" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gold/30 bg-gold/[0.06] font-mono text-[9px] tracking-widest uppercase text-gold">
              <InfinityIcon className="w-3 h-3" /> {t("pricing.layerBTag")}
            </div>
            <h2 className="font-display font-extrabold text-xl sm:text-2xl text-ink mt-1.5">
              {t("pricing.founderHeading")}
            </h2>
          </div>
        </div>
        <p className="font-sans text-sm text-ink-2 leading-relaxed max-w-2xl mb-6 sm:pl-14">
          {t("pricing.founderSub")}
        </p>

        {/* Benefits grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BENEFITS.map(({ Icon, titleKey, descKey }) => (
            <div
              key={titleKey}
              className="group flex items-start gap-3 rounded-xl border border-white/5 bg-bg-1/50 p-3.5 hover:border-gold/25 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0 group-hover:bg-gold/15 transition-colors">
                <Icon className="w-4 h-4 text-gold" />
              </div>
              <div className="min-w-0">
                <div className="font-display font-bold text-[13px] text-ink leading-tight">
                  {t(titleKey)}
                </div>
                <p className="font-sans text-[11px] text-ink-3 leading-relaxed mt-1">
                  {t(descKey)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
