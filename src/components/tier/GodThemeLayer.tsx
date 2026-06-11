"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useTierAccent } from "./TierAccentProvider";
import { GOD_META, isPaidTier, type PaidTier } from "@/lib/tier/gods";
import { ceremonyArmed, disarmCeremony } from "@/lib/tier/ceremony";
import type { Tier } from "@/lib/tier/types";
import { cn } from "@/lib/cn";

/**
 * God theme layer — the dramatic half of the tier experience.
 *
 * Two pieces, both pointer-events-none:
 *   1. `.god-ambient` — a persistent full-viewport background wash themed per
 *      god. Freyr/Odin get individually-phased DOM particles (embers/stars)
 *      so the field shimmers organically — never a whole-layer opacity pulse,
 *      which reads as "blinking". Thor's lightning stays pure CSS.
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
        <div aria-hidden className={cn("god-ambient", `god-${tier}`)}>
          {!reduceMotion && tier === "pilot"  && <OdinStars />}
          {!reduceMotion && tier === "pro"    && <FreyrEmbers />}
          {!reduceMotion && tier === "trader" && <ThorBolts />}
        </div>
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

/* ── Ambient particle fields ─────────────────────────────────────────────
 * Generated once per mount with Math.random — this component only renders
 * client-side after the tier resolves, so there is no SSR hydration risk.
 * Each particle gets its own duration/delay so the field never pulses in
 * unison.                                                                  */

const STAR_COLORS = [
  "rgba(255,255,255,0.95)",
  "rgba(255,255,255,0.95)",   // white twice as likely
  "rgba(0,232,255,0.90)",
  "rgba(214,178,255,0.90)",
  "rgba(245,166,35,0.85)",
];

function OdinStars() {
  const stars = useMemo(
    () =>
      Array.from({ length: 38 }, (_, i) => {
        const size = 1 + Math.random() * 1.8;
        const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
        return {
          id:    i,
          left:  `${(Math.random() * 100).toFixed(2)}%`,
          top:   `${(Math.random() * 100).toFixed(2)}%`,
          size:  `${size.toFixed(2)}px`,
          color,
          glow:  size > 1.9,
          dur:   `${(2.6 + Math.random() * 4.4).toFixed(2)}s`,
          delay: `${(Math.random() * 7).toFixed(2)}s`,
          peak:  (0.65 + Math.random() * 0.35).toFixed(2),
        };
      }),
    [],
  );
  return (
    <>
      {stars.map((s) => (
        <span
          key={s.id}
          className="odin-star"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            background: s.color,
            boxShadow: s.glow ? `0 0 6px 1px ${s.color}` : undefined,
            ["--dur" as string]: s.dur,
            ["--delay" as string]: s.delay,
            ["--o" as string]: s.peak,
          }}
        />
      ))}
      <span className="odin-comet" />
    </>
  );
}

const EMBER_COLORS = [
  "rgba(255,225,110,0.95)",
  "rgba(245,166,35,0.90)",
  "rgba(255,205,80,0.92)",
  "rgba(255,214,120,0.85)",
  "rgba(201,169,85,0.80)",
];

/**
 * Two SVG bolts that cut full-screen diagonally for Thor's ambient.
 * bolt-a fires on a 13 s cycle, bolt-b on a 19 s cycle (prime offset so
 * they almost never coincide) — giving genuine randomness without JS.
 */
function ThorBolts() {
  return (
    <>
      {/* Primary bolt — upper-right → lower-left */}
      <svg className="thor-bolt bolt-a" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <filter id="thor-halo-a" x="-200%" y="-5%" width="500%" height="110%">
            <feGaussianBlur stdDeviation="2.8" />
          </filter>
          <filter id="thor-glow-a" x="-100%" y="-5%" width="300%" height="110%">
            <feGaussianBlur stdDeviation="0.8" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Sky flash rectangle */}
        <rect width="100" height="100" fill="rgba(180,130,255,0.08)" />
        {/* Halo (wide, diffuse) */}
        <path d="M67 0 L52 32 L63 35 L44 66 L58 69 L32 100"
          stroke="rgba(180,130,255,0.55)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-halo-a)" />
        {/* Core (sharp white) */}
        <path d="M67 0 L52 32 L63 35 L44 66 L58 69 L32 100"
          stroke="rgba(255,255,255,0.97)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-glow-a)" />
      </svg>

      {/* Secondary bolt — slightly different angle + position */}
      <svg className="thor-bolt bolt-b" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <filter id="thor-halo-b" x="-200%" y="-5%" width="500%" height="110%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id="thor-glow-b" x="-100%" y="-5%" width="300%" height="110%">
            <feGaussianBlur stdDeviation="0.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width="100" height="100" fill="rgba(160,100,255,0.06)" />
        <path d="M74 0 L61 26 L72 29 L55 56 L67 59 L43 100"
          stroke="rgba(200,160,255,0.45)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-halo-b)" />
        <path d="M74 0 L61 26 L72 29 L55 56 L67 59 L43 100"
          stroke="rgba(255,255,255,0.92)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-glow-b)" />
      </svg>
    </>
  );
}

function FreyrEmbers() {
  const embers = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const size = 1.5 + Math.random() * 2.5;
        const color = EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)];
        return {
          id:    i,
          left:  `${(Math.random() * 100).toFixed(2)}%`,
          size:  `${size.toFixed(2)}px`,
          color,
          glow:  size > 2.8,
          dur:   `${(9 + Math.random() * 11).toFixed(2)}s`,
          delay: `${(Math.random() * 16).toFixed(2)}s`,
          sway:  `${(Math.random() * 70 - 35).toFixed(0)}px`,
          peak:  (0.55 + Math.random() * 0.4).toFixed(2),
        };
      }),
    [],
  );
  return (
    <>
      {embers.map((e) => (
        <span
          key={e.id}
          className="freyr-ember"
          style={{
            left: e.left,
            width: e.size,
            height: e.size,
            background: e.color,
            boxShadow: e.glow ? `0 0 8px 2px rgba(245,166,35,0.45)` : undefined,
            ["--dur" as string]: e.dur,
            ["--delay" as string]: e.delay,
            ["--sway" as string]: e.sway,
            ["--o" as string]: e.peak,
          }}
        />
      ))}
    </>
  );
}
