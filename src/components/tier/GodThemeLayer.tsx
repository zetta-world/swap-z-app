"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useTierAccent } from "./TierAccentProvider";
import { GOD_META, isPaidTier, type PaidTier } from "@/lib/tier/gods";
import { ceremonyArmed, disarmCeremony } from "@/lib/tier/ceremony";
import type { Tier } from "@/lib/tier/types";
import { cn } from "@/lib/cn";

/**
 * God theme layer — the dramatic half of the tier experience.
 *
 * Two pieces, both pointer-events-none and pure CSS animation:
 *   1. `.god-ambient` — a persistent full-viewport background wash themed per
 *      god (Freyr's golden haze, Thor's storm + lightning flicker, Odin's
 *      cosmos). Sits at z-0 behind the app shell; functional surfaces render
 *      above it untouched.
 *   2. `.god-ceremony` — a one-shot ~2.4s overlay played when the active tier
 *      CHANGES (sign-in or admin plan switch): Thor's bolt strikes, Freyr's
 *      gold blooms, Odin's prismatic iris opens — plus the god's rune sigil.
 *
 * Skipped entirely under prefers-reduced-motion; renders nothing for
 * free/anonymous users.
 */
export default function GodThemeLayer() {
  const { active, tier } = useTierAccent();
  const reduceMotion = useReducedMotion();
  const prev = useRef<Tier | null>(null);
  const [ceremony, setCeremony] = useState<PaidTier | null>(null);

  useEffect(() => {
    const cur: Tier = active ? tier : "free";
    const old = prev.current;
    prev.current = cur;
    // Only celebrate tier changes the user just caused (sign-in / plan
    // switch arm the ceremony) — never ambient page-load resolution.
    if (old !== null && old !== cur && isPaidTier(cur) && ceremonyArmed() && !reduceMotion) {
      disarmCeremony();
      setCeremony(cur);
      const t = setTimeout(() => setCeremony(null), 2100);
      return () => clearTimeout(t);
    }
  }, [active, tier, reduceMotion]);

  return (
    <>
      {active && isPaidTier(tier) && (
        <div aria-hidden className={cn("god-ambient", `god-${tier}`)} />
      )}

      {ceremony && (
        <div aria-hidden className={cn("god-ceremony", `god-${ceremony}`)}>
          <div className="god-flash" />
          {ceremony === "trader" && <ThorBolt />}
          {ceremony === "pilot" && <div className="god-iris" />}
          {ceremony === "pro" && <div className="god-bloom" />}
          <div className="god-sigil">
            <span className="god-rune">{GOD_META[ceremony].rune}</span>
            <span className="god-name">{GOD_META[ceremony].god}</span>
            <span className="god-epithet">{GOD_META[ceremony].epithet}</span>
          </div>
        </div>
      )}
    </>
  );
}

/** Jagged bolt that strikes down the screen during Thor's ceremony. */
function ThorBolt() {
  return (
    <svg className="god-bolt" viewBox="0 0 100 200" fill="none" preserveAspectRatio="xMidYMin meet">
      <path
        d="M62 0 L34 84 L52 87 L26 200 L80 72 L58 69 Z"
        fill="rgba(226,208,255,0.95)"
      />
    </svg>
  );
}
