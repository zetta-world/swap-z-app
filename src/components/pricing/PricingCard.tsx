"use client";

import { Check, Wallet } from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export type TierAccent = "ink" | "cyan" | "violet" | "gold";

export interface TierConfig {
  id:        string;
  nameKey:   MessageKey;
  priceKey:  MessageKey;
  fiatKey?:  MessageKey;
  subKey?:   MessageKey;
  modelKey:  MessageKey;
  capKey:    MessageKey;
  features:  MessageKey[];
  accent:    TierAccent;
  highlighted?: boolean;
  /** "free" = current-tier pill (disabled), "mint" = opens the mint modal. */
  cta:       "free" | "mint";
}

const ACCENT_BORDER: Record<TierAccent, string> = {
  ink:    "border-white/8",
  cyan:   "border-cyan/30",
  violet: "border-violet/30",
  gold:   "border-gold/40",
};
const ACCENT_TEXT: Record<TierAccent, string> = {
  ink:    "text-ink",
  cyan:   "text-cyan",
  violet: "text-violet",
  gold:   "text-gold",
};
const ACCENT_GLOW: Record<TierAccent, string> = {
  ink:    "",
  cyan:   "shadow-[0_0_40px_-12px_rgba(0,232,255,0.35)]",
  violet: "shadow-[0_0_40px_-12px_rgba(159,95,255,0.35)]",
  gold:   "shadow-[0_0_48px_-10px_rgba(255,184,32,0.45)]",
};

export default function PricingCard({ tier, onMint }: { tier: TierConfig; onMint: () => void }) {
  const t = useT();
  const accentText = ACCENT_TEXT[tier.accent];

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border bg-bg-1/40 p-5 backdrop-blur-sm",
        ACCENT_BORDER[tier.accent],
        tier.highlighted && ACCENT_GLOW[tier.accent],
      )}
    >
      {tier.highlighted && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full border border-gold/40 bg-bg-2 font-mono text-[9px] tracking-widest uppercase text-gold whitespace-nowrap">
          {t("pricing.mostPopular")}
        </div>
      )}

      {/* Name */}
      <div className={cn("font-display font-bold text-sm tracking-wide", accentText)}>
        {t(tier.nameKey)}
      </div>

      {/* Price */}
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display font-extrabold text-2xl text-ink">{t(tier.priceKey)}</span>
        {tier.fiatKey && (
          <span className="font-mono text-[10px] text-ink-4">{t(tier.fiatKey)}</span>
        )}
      </div>
      <div className="h-4 mt-0.5">
        {tier.subKey && (
          <span className="font-mono text-[10px] text-ink-3">
            {t("pricing.subSoon")} · {t(tier.subKey)}
          </span>
        )}
      </div>

      {/* Model + cap */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/5 bg-bg-2/60 px-2.5 py-2">
          <div className="font-mono text-[8px] tracking-widest uppercase text-ink-4">{t("pricing.modelLabel")}</div>
          <div className={cn("font-mono text-[11px] mt-0.5", tier.id === "pilot" ? "text-gold" : "text-ink-2")}>
            {t(tier.modelKey)}
          </div>
        </div>
        <div className="rounded-lg border border-white/5 bg-bg-2/60 px-2.5 py-2">
          <div className="font-mono text-[8px] tracking-widest uppercase text-ink-4">{t("pricing.capLabel")}</div>
          <div className="font-mono text-[11px] mt-0.5 text-ink-2">{t(tier.capKey)}</div>
        </div>
      </div>

      {/* Features */}
      <ul className="mt-4 space-y-2 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", accentText)} />
            <span className="font-sans text-[12px] text-ink-2 leading-snug">{t(f)}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-5">
        {tier.cta === "free" ? (
          <div className="w-full text-center rounded-lg border border-white/8 bg-white/[0.02] py-2.5 font-mono text-[11px] tracking-widest uppercase text-ink-3">
            {t("pricing.tierFreeCta")}
          </div>
        ) : (
          <button
            type="button"
            onClick={onMint}
            className={cn(
              "w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 font-mono text-[11px] tracking-widest uppercase transition-colors",
              tier.accent === "gold"
                ? "border border-gold/40 bg-gold/15 text-gold hover:bg-gold/25"
                : tier.accent === "violet"
                ? "border border-violet/40 bg-violet/15 text-violet hover:bg-violet/25"
                : "border border-cyan/40 bg-cyan/15 text-cyan hover:bg-cyan/25",
            )}
          >
            <Wallet className="w-3.5 h-3.5" />
            {t("pricing.ctaMint")}
          </button>
        )}
      </div>
    </div>
  );
}
