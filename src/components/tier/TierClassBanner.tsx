"use client";

import { Zap } from "lucide-react";
import { useTierAccent } from "./TierAccentProvider";
import { GOD_META, isPaidTier } from "@/lib/tier/gods";
import { useT } from "@/lib/i18n";

/**
 * God-class hero strip — "⚡ TRADER · THOR CLASS" + tagline, shown under
 * the hero eyebrow when a paid tier is active. Renders nothing for
 * anonymous / free users so the neutral hero stays untouched.
 */
export default function TierClassBanner() {
  const { active, tier } = useTierAccent();
  const t = useT();
  if (!active || !isPaidTier(tier)) return null;

  const meta = GOD_META[tier];
  const tierName = tier === "pro" ? t("tier.pro") : tier === "trader" ? t("tier.trader") : t("tier.pilot");
  const tagline  = tier === "pro" ? t("tier.taglinePro") : tier === "trader" ? t("tier.taglineTrader") : t("tier.taglinePilot");

  return (
    <div className="tier-class-banner">
      <div className="tier-class-row">
        <Zap className="tier-class-bolt" />
        <span className="tier-class-name">{tierName}</span>
        <span className="tier-class-sep">—</span>
        <span className="tier-class-god">{t("tier.classOf", { god: meta.god })}</span>
      </div>
      <p className="tier-class-tagline">{tagline}</p>
    </div>
  );
}
