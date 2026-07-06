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

const TIER_EMBLEM: Partial<Record<PaidTier, string>> = {
  pro:    "/tiers/freyr.png",
  trader: "/tiers/thor.png",
  pilot:  "/tiers/pilot.png",
};

const SIZES = {
  sm: { box: "w-7 h-7",   radius: "rounded-lg", z: "text-[13px]", blur: "opacity-30", px: 28 },
  md: { box: "w-9 h-9",   radius: "rounded-lg", z: "text-sm",     blur: "opacity-25", px: 36 },
  lg: { box: "w-10 h-10", radius: "rounded-xl", z: "text-lg",     blur: "opacity-20", px: 40 },
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

  // Default platform mark — the Yggdrasil Z (world tree entwining the Z, the
  // three orbs = the connected chains). Shown when no paid-tier crest applies:
  // no plan, or (future) Hird monthly subscribers — god crests stay Founder-
  // exclusive. Prismatic halo behind, emblem over the dark tile.
  return (
    <div className={cn("relative flex-shrink-0", s.box)}>
      {/* No solid tile — the emblem floats on the bar (the old #05060C box read
          as a black square against the navy topbar). Soft prismatic halo only. */}
      <div aria-hidden className={cn("absolute inset-1 rounded-full blur-md opacity-45")}
           style={{ background: "linear-gradient(135deg,#00E8FF,#9F5FFF,#F5A623)" }} />
      <Image src="/brand/yggdrasil-z-transparent.png" alt="Z-SWAP" width={s.px} height={s.px} priority className={cn("relative object-contain drop-shadow-[0_0_6px_rgba(159,95,255,0.5)]", s.box)} />
    </div>
  );
}

function isPaid(t: string): t is PaidTier {
  return t === "pro" || t === "trader" || t === "pilot";
}
