"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { Lock, Loader2, ArrowRight, Crown } from "lucide-react";
import { useTier } from "@/lib/tier/client";
import { type Tier } from "@/lib/tier/types";
import SignInButton from "./SignInButton";
import { useT, type MessageKey } from "@/lib/i18n";

const TIER_LABEL: Record<Tier, MessageKey> = {
  free:   "tier.free",
  pro:    "tier.pro",
  trader: "tier.trader",
  pilot:  "tier.pilot",
};

/**
 * Wraps tier-gated UI. Behavior:
 *   • Gates dormant (TIER_GATES_ENABLED=false) → always renders children.
 *   • Loading → children stay hidden behind a light skeleton.
 *   • Not authenticated → sign-in prompt.
 *   • Authenticated but tier too low → upgrade CTA (or a custom `fallback`).
 *   • Tier satisfied → children.
 *
 * Pass `silent` to render nothing (instead of a prompt) when locked — useful
 * for inline affordances where a full card would be noisy.
 */
export default function TierGate({
  required,
  children,
  fallback,
  silent = false,
}: {
  required: Tier;
  children: ReactNode;
  fallback?: ReactNode;
  silent?: boolean;
}) {
  const t = useT();
  const { isLoading, authenticated, satisfies, gatesEnabled } = useTier();

  // Dormant gates (or satisfied) → pass straight through.
  if (!gatesEnabled || satisfies(required)) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/5 bg-bg-1/40 p-8">
        <Loader2 className="w-5 h-5 text-ink-3 animate-spin" />
      </div>
    );
  }

  if (silent) return null;
  if (fallback) return <>{fallback}</>;

  const tierName = t(TIER_LABEL[required]);

  // Authenticated but under-tier → upgrade. Unauthenticated → sign in first.
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.05] to-violet/[0.03] p-6 sm:p-8 text-center">
      <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full bg-gold/10 blur-3xl pointer-events-none" />
      <div className="relative flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center">
          {authenticated ? <Crown className="w-5 h-5 text-gold" /> : <Lock className="w-5 h-5 text-gold" />}
        </div>
        <h3 className="font-display font-bold text-lg text-ink">
          {authenticated ? t("tier.lockedHeading", { tier: tierName }) : t("tier.signInHeading")}
        </h3>
        <p className="font-sans text-[13px] text-ink-2 leading-relaxed max-w-sm">
          {authenticated ? t("tier.lockedBody", { tier: tierName }) : t("tier.signInBody")}
        </p>
        <div className="mt-1">
          {authenticated ? (
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold/40 bg-gold/15 text-gold px-4 py-2.5 font-mono text-[11px] tracking-widest uppercase hover:bg-gold/25"
            >
              {t("tier.viewPlans")}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <SignInButton />
          )}
        </div>
      </div>
    </div>
  );
}
