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
          {!reduceMotion && tier === "trader" && (
            <>
              <ThorNetwork />
              <ThorRunes />
              <ThorBolts />
            </>
          )}
        </div>
      )}

      {active && tier === "trader" && !reduceMotion && <ThorNFTBadge />}

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
 * Three cinematic SVG bolts at prime-number cycles so they almost never
 * coincide — authentic randomness without JS.
 *   bolt-a   : 17 s — primary diagonal (upper-right → lower-left)
 *   bolt-b   : 29 s — counter-diagonal (upper-left → lower-right)
 *   bolt-mega: 41 s — rare center branching strike with gold-tinted halo
 */
function ThorBolts() {
  return (
    <>
      {/* Bolt A — 17s prime cycle, upper-right → lower-left */}
      <svg className="thor-bolt bolt-a" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <filter id="thor-halo-a" x="-220%" y="-5%" width="540%" height="110%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
          <filter id="thor-glow-a" x="-120%" y="-5%" width="340%" height="110%">
            <feGaussianBlur stdDeviation="1.0" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Sky ionization flash */}
        <rect width="100" height="100" fill="rgba(245,245,255,0.06)" />
        {/* Halo — Thunder Glow #B388FF */}
        <path d="M72 0 L58 28 L70 31 L52 58 L65 62 L40 100"
          stroke="rgba(179,136,255,0.62)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-halo-a)" />
        {/* Core — Lightning White #F5F5FF */}
        <path d="M72 0 L58 28 L70 31 L52 58 L65 62 L40 100"
          stroke="rgba(245,245,255,0.98)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-glow-a)" />
      </svg>

      {/* Bolt B — 29s prime cycle, upper-left → lower-right */}
      <svg className="thor-bolt bolt-b" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <filter id="thor-halo-b" x="-220%" y="-5%" width="540%" height="110%">
            <feGaussianBlur stdDeviation="2.8" />
          </filter>
          <filter id="thor-glow-b" x="-120%" y="-5%" width="340%" height="110%">
            <feGaussianBlur stdDeviation="0.8" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width="100" height="100" fill="rgba(138,92,255,0.05)" />
        <path d="M28 0 L44 24 L32 27 L50 56 L36 60 L62 100"
          stroke="rgba(179,136,255,0.52)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-halo-b)" />
        <path d="M28 0 L44 24 L32 27 L50 56 L36 60 L62 100"
          stroke="rgba(245,245,255,0.94)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-glow-b)" />
      </svg>

      {/* Mega Bolt — 41s prime cycle, center-screen with branches */}
      {/* Gold-tinted halo: Mjölnir's divine power in this rare strike  */}
      <svg className="thor-bolt bolt-mega" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <filter id="thor-halo-mega" x="-320%" y="-5%" width="740%" height="110%">
            <feGaussianBlur stdDeviation="5.5" />
          </filter>
          <filter id="thor-glow-mega" x="-140%" y="-5%" width="380%" height="110%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Full-screen sky ionization */}
        <rect width="100" height="100" fill="rgba(245,245,255,0.10)" />
        {/* Main halo — Ancient Gold tint for divine power */}
        <path d="M50 0 L42 22 L55 26 L38 52 L52 56 L35 80 L46 84 L28 100"
          stroke="rgba(212,175,55,0.35)" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-halo-mega)" />
        {/* Branch halos */}
        <path d="M55 26 L74 48 L82 60"
          stroke="rgba(179,136,255,0.28)" strokeWidth="6" strokeLinecap="round"
          filter="url(#thor-halo-mega)" />
        <path d="M52 56 L24 76"
          stroke="rgba(179,136,255,0.24)" strokeWidth="5" strokeLinecap="round"
          filter="url(#thor-halo-mega)" />
        {/* Main core — Lightning White */}
        <path d="M50 0 L42 22 L55 26 L38 52 L52 56 L35 80 L46 84 L28 100"
          stroke="rgba(250,250,255,0.99)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          filter="url(#thor-glow-mega)" />
        {/* Branch cores */}
        <path d="M55 26 L74 48 L82 60"
          stroke="rgba(245,245,255,0.88)" strokeWidth="1.1" strokeLinecap="round"
          filter="url(#thor-glow-mega)" />
        <path d="M52 56 L24 76"
          stroke="rgba(245,245,255,0.82)" strokeWidth="1.0" strokeLinecap="round"
          filter="url(#thor-glow-mega)" />
      </svg>
    </>
  );
}

/* ── Elder Futhark runes drifting in the charged plasma ─────────────────
 * Each rune has its own duration/delay so the field never pulses in unison.
 * ~12% chance any rune is gold (Ancient Gold #D4AF37) — power rune.       */
const THOR_RUNE_CHARS = ["ᚦ", "ᚱ", "ᛏ", "ᛚ", "ᛉ", "ᚷ", "ᚾ", "ᛗ", "ᚠ", "ᚨ", "ᛁ", "ᚹ", "ᛟ", "ᚲ"];

function ThorRunes() {
  const runes = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id:    i,
        char:  THOR_RUNE_CHARS[Math.floor(Math.random() * THOR_RUNE_CHARS.length)],
        left:  `${(Math.random() * 94 + 3).toFixed(1)}%`,
        top:   `${(Math.random() * 88 + 6).toFixed(1)}%`,
        size:  `${(12 + Math.random() * 20).toFixed(0)}px`,
        dur:   `${(22 + Math.random() * 26).toFixed(1)}s`,
        delay: `${(Math.random() * 22).toFixed(1)}s`,
        sway:  `${(Math.random() * 24 - 12).toFixed(0)}px`,
        peak:  (0.10 + Math.random() * 0.14).toFixed(2),
        gold:  Math.random() < 0.12,
      })),
    [],
  );
  return (
    <>
      {runes.map((r) => (
        <span
          key={r.id}
          className={cn("thor-rune", r.gold && "is-gold")}
          style={{
            left:     r.left,
            top:      r.top,
            fontSize: r.size,
            ["--dur"   as string]: r.dur,
            ["--delay" as string]: r.delay,
            ["--sway"  as string]: r.sway,
            ["--o"     as string]: r.peak,
          }}
        >
          {r.char}
        </span>
      ))}
    </>
  );
}

/* ── SVG energy network — electric field topology ────────────────────────
 * Fixed node positions form a network; edges pulse energy (moving dashes).
 * Subtle enough to read as atmosphere, not decoration.                     */
function ThorNetwork() {
  const { nodes, edges } = useMemo(() => {
    const pts = [
      { x: 12, y: 20 }, { x: 38, y:  6 }, { x: 68, y: 14 }, { x: 88, y: 36 },
      { x: 80, y: 62 }, { x: 55, y: 86 }, { x: 26, y: 76 }, { x:  5, y: 50 },
      { x: 32, y: 44 }, { x: 62, y: 34 }, { x: 50, y: 52 },
    ];
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }> = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < 34) {
          segs.push({ x1: pts[i].x, y1: pts[i].y, x2: pts[j].x, y2: pts[j].y, key: `${i}-${j}` });
        }
      }
    }
    return { nodes: pts, edges: segs };
  }, []);

  return (
    <svg
      className="thor-network"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden
    >
      {edges.map((e, i) => (
        <line
          key={e.key}
          x1={e.x1} y1={e.y1}
          x2={e.x2} y2={e.y2}
          className="thor-connector"
          style={{ animationDelay: `${(i * 1.1 % 10).toFixed(1)}s` }}
        />
      ))}
      {nodes.map((n, i) => (
        <circle
          key={i}
          cx={n.x} cy={n.y} r="0.45"
          className="thor-node"
          style={{ animationDelay: `${(i * 0.55 % 5).toFixed(1)}s` }}
        />
      ))}
    </svg>
  );
}

/* ── Floating holographic TRADER NFT badge ───────────────────────────────
 * Fixed top-right talisman mirroring the Access Pass card: obsidian slab,
 * gold corner brackets, rotating holo shimmer, ᚦ sigil. Three transform
 * layers so effects never fight: wrapper (mouse parallax, inline) →
 * float (CSS bob) → card (hover scale/glow). Desktop only via CSS.       */
function ThorNFTBadge() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setPos({ x: ((e.clientX - cx) / cx) * -10, y: ((e.clientY - cy) / cy) * -6 });
    };
    window.addEventListener("mousemove", handle, { passive: true });
    return () => window.removeEventListener("mousemove", handle);
  }, []);
  return (
    <div
      aria-hidden
      className="thor-nft-wrap"
      style={{ transform: `translate(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px)` }}
    >
      <div className="thor-nft-float">
        <div className="thor-nft-card">
          <div className="thor-nft-holo" />
          <div className="thor-nft-corner tl" />
          <div className="thor-nft-corner tr" />
          <div className="thor-nft-corner bl" />
          <div className="thor-nft-corner br" />
          <div className="thor-nft-body">
            <span className="thor-nft-rune">ᚦ</span>
            <div className="thor-nft-divider" />
            <span className="thor-nft-god">THOR</span>
            <span className="thor-nft-tier">TRADER</span>
          </div>
        </div>
      </div>
    </div>
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
