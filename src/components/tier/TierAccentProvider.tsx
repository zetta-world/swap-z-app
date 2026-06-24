"use client";

import { createContext, useContext, useEffect } from "react";
import { useTier } from "@/lib/tier/client";
import { useUI } from "@/lib/store/ui";
import type { Tier } from "@/lib/tier/types";

/**
 * Tier experience layer — sets `data-tier` on <html> when the signed-in
 * wallet holds a paid tier, driving the `--tier-accent` / `--tier-glow` CSS
 * custom properties defined in globals.css. Components opt in via the
 * `tier-pill`, `tier-logo-underline`, `tier-ambient` classes or the
 * `var(--tier-dot, …)` fallback pattern — all of which render exactly
 * today's neutral UI when the attribute is absent.
 *
 * Progressive enhancement only: anonymous, free-tier, loading and error
 * states all leave <html> untouched.
 */

interface TierAccentState {
  tier:        Tier;
  accentColor: string;
  glowColor:   string;
  /** True only when a signed-in paid tier is driving the accent. */
  active:      boolean;
}

const TIER_COLORS: Record<Exclude<Tier, "free">, { accent: string; glow: string }> = {
  pro:    { accent: "#F5A623", glow: "rgba(245,166,35,0.40)" },
  trader: { accent: "#9F5FFF", glow: "rgba(159,95,255,0.40)" },
  pilot:  { accent: "#C9A2FF", glow: "rgba(159,95,255,0.45)" },
};

const DEFAULT_STATE: TierAccentState = {
  tier: "free",
  accentColor: "#00E8FF",
  glowColor: "rgba(0,232,255,0.35)",
  active: false,
};

const TierAccentContext = createContext<TierAccentState>(DEFAULT_STATE);

export function useTierAccent(): TierAccentState {
  return useContext(TierAccentContext);
}

export default function TierAccentProvider({ children }: { children: React.ReactNode }) {
  const { authenticated, tier, isError, isLoading } = useTier();
  const { disableTierTheme } = useUI();
  const active = authenticated && !isError && !isLoading && tier !== "free" && !disableTierTheme;

  useEffect(() => {
    const el = document.documentElement;
    if (active) el.setAttribute("data-tier", tier);
    else el.removeAttribute("data-tier");
    return () => el.removeAttribute("data-tier");
  }, [active, tier]);

  const value: TierAccentState = active
    ? { tier, accentColor: TIER_COLORS[tier].accent, glowColor: TIER_COLORS[tier].glow, active: true }
    : DEFAULT_STATE;

  return <TierAccentContext.Provider value={value}>{children}</TierAccentContext.Provider>;
}
