"use client";

import Image from "next/image";
import { useTierAccent } from "@/components/tier/TierAccentProvider";
import type { PaidTier } from "@/lib/tier/gods";
import { cn } from "@/lib/cn";

/**
 * Brand mark — the top-left logo shown in the sidebar, topbar and mobile nav.
 *
 * Default: the cyan "Z" gradient tile. When a signed-in wallet holds a paid
 * tier with a dedicated emblem (e.g. Thor for `trader`), the tile is replaced
 * by that tier's transparent crest, lit with the tier accent glow. Tiers
 * without an emblem keep the neutral "Z" until their artwork ships.
 */

// Transparent crest per paid tier. Add `pro` / `pilot` here as artwork lands.
const TIER_EMBLEM: Partial<Record<PaidTier, string>> = {
  trader: "/tiers/thor.png",
};

const SIZES = {
  sm: { box: "w-7 h-7", radius: "rounded-lg", z: "text-[13px]", blur: "opacity-30", px: 28 },
  md: { box: "w-8 h-8", radius: "rounded-lg", z: "text-sm",     blur: "opacity-25", px: 32 },
  lg: { box: "w-9 h-9", radius: "rounded-xl", z: "text-lg",     blur: "opacity-20", px: 36 },
} as const;

export default function BrandMark({ size = "lg" }: { size?: keyof typeof SIZES }) {
  const { active, tier, glowColor } = useTierAccent();
  const s = SIZES[size];
  const emblem = active && isPaid(tier) ? TIER_EMBLEM[tier] : undefined;

  if (emblem) {
    return (
      <div className={cn("relative flex-shrink-0", s.box)}>
        {/* tier accent halo behind the crest */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-full blur-md opacity-60"
          style={{ background: glowColor }}
        />
        <Image
          src={emblem}
          alt=""
          width={s.px}
          height={s.px}
          priority
          className={cn("relative object-contain", s.box)}
        />
      </div>
    );
  }

  // Default cyan "Z" tile
  return (
    <div className={cn("relative flex-shrink-0", s.box)}>
      <div aria-hidden className={cn("absolute inset-0 bg-grad-cyan blur-md", s.radius, s.blur)} />
      <div className={cn("relative bg-grad-cyan flex items-center justify-center", s.box, s.radius)}>
        <span className={cn("font-display font-extrabold text-bg leading-none", s.z)}>Z</span>
      </div>
    </div>
  );
}

function isPaid(t: string): t is PaidTier {
  return t === "pro" || t === "trader" || t === "pilot";
}
