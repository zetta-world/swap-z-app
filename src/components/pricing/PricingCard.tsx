"use client";

import Image from "next/image";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { Check, Wallet, Loader2, BadgeCheck } from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export type TierAccent = "gold" | "violet" | "prismatic";

/** Admin test mode — the seeded admin wallet can switch to any plan live. */
export interface AdminSelectState {
  isCurrent: boolean;
  selecting: boolean;
  onSelect:  () => void;
}

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
  /** Path under /public to the 3:4 Access Pass artwork. */
  art:       string;
  /** Elevated premium card — gets the badge. */
  highlighted?: boolean;
  badgeKey?: MessageKey;
  /** USD-pegged price. When set, overrides priceKey/fiatKey: shows "$USD" as the
   *  headline and "≈ N SOL" (live) as subtext. */
  priceUsd?: number;
  priceSol?: number | null;
}

/** SOL amount to a readable precision (2dp under 10, 1dp under 100, else 0). */
function fmtSol(n: number): string {
  const dp = n < 10 ? 2 : n < 100 ? 1 : 0;
  return n.toFixed(dp);
}

/* Per-accent styling. All class strings are literal so Tailwind JIT sees them. */
const ACCENT: Record<TierAccent, {
  frame:    string;  // p-px gradient border wrapper (30-40% opacity)
  name:     string;  // big tier name treatment
  check:    string;
  haloIdle: string;  // soft halo around the artwork
  cardGlow: string;  // hover glow on the whole card
  cta:      string;
}> = {
  gold: {
    frame:    "bg-[linear-gradient(160deg,rgba(245,166,35,0.45),rgba(245,166,35,0.10)_45%,rgba(201,169,85,0.35))]",
    name:     "text-gold",
    check:    "text-gold",
    haloIdle: "shadow-[0_0_44px_-10px_rgba(245,166,35,0.40)]",
    cardGlow: "hover:shadow-[0_0_64px_-16px_rgba(245,166,35,0.45)]",
    cta:      "border border-gold/40 bg-gold/15 text-gold hover:bg-gold/25",
  },
  violet: {
    frame:    "bg-[linear-gradient(160deg,rgba(159,95,255,0.45),rgba(159,95,255,0.10)_45%,rgba(124,58,237,0.35))]",
    name:     "text-violet",
    check:    "text-violet",
    haloIdle: "shadow-[0_0_44px_-10px_rgba(159,95,255,0.40)]",
    cardGlow: "hover:shadow-[0_0_64px_-16px_rgba(159,95,255,0.45)]",
    cta:      "border border-violet/40 bg-violet/15 text-violet hover:bg-violet/25",
  },
  prismatic: {
    frame:    "bg-[linear-gradient(140deg,rgba(0,232,255,0.45),rgba(159,95,255,0.40)_50%,rgba(245,166,35,0.45))]",
    name:     "bg-clip-text text-transparent bg-[linear-gradient(120deg,#00E8FF,#9F5FFF,#F5A623)]",
    check:    "text-gold",
    haloIdle: "shadow-[0_0_44px_-10px_rgba(159,95,255,0.45)]",
    cardGlow: "hover:shadow-[0_0_72px_-16px_rgba(159,95,255,0.55)]",
    cta:      "border border-violet/40 bg-[linear-gradient(120deg,rgba(0,232,255,0.14),rgba(159,95,255,0.16),rgba(245,166,35,0.14))] text-ink hover:brightness-125",
  },
};

const TILT_DEG = 3;

export default function PricingCard({ tier, onMint, admin }: {
  tier: TierConfig;
  onMint: () => void;
  admin?: AdminSelectState;
}) {
  const t = useT();
  const a = ACCENT[tier.accent];
  const reduceMotion = useReducedMotion();

  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springX = useSpring(rotateX, { stiffness: 180, damping: 22 });
  const springY = useSpring(rotateY, { stiffness: 180, damping: 22 });

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduceMotion) return;
    const r = e.currentTarget.getBoundingClientRect();
    rotateY.set(((e.clientX - r.left) / r.width - 0.5) * TILT_DEG * 2);
    rotateX.set(-((e.clientY - r.top) / r.height - 0.5) * TILT_DEG * 2);
  };
  const onMouseLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.div
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ rotateX: springX, rotateY: springY, transformPerspective: 900 }}
      className={cn(
        "relative h-full rounded-2xl p-px transition-shadow duration-300",
        a.frame,
        a.cardGlow,
      )}
    >
      {tier.highlighted && tier.badgeKey && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 px-2.5 py-0.5 rounded-full border border-gold/40 bg-bg-2 font-mono text-[9px] tracking-widest uppercase text-gold whitespace-nowrap">
          {t(tier.badgeKey)}
        </div>
      )}

      <div className="flex flex-col h-full rounded-[15px] bg-bg-1/90 backdrop-blur-sm p-4 sm:p-5">
        {/* NFT artwork hero — 3:4, halo in the tier accent */}
        <div className={cn("relative aspect-[3/4] rounded-xl overflow-hidden", a.haloIdle)}>
          <Image
            src={tier.art}
            alt={`${t(tier.nameKey)} — ${t("pricing.eyebrow")}`}
            fill
            priority
            sizes="(min-width: 768px) 30vw, calc(100vw - 4rem)"
            className="object-cover"
          />
        </div>

        {/* Tier name */}
        <div className={cn("mt-4 text-center font-display font-extrabold text-xl tracking-[0.22em] uppercase", a.name)}>
          {t(tier.nameKey)}
        </div>

        {/* Price — USD-pegged when priceUsd is set, else the i18n fallback */}
        <div className="mt-2 text-center">
          {typeof tier.priceUsd === "number" ? (
            <>
              <span className="font-display font-extrabold text-2xl text-ink">${tier.priceUsd.toLocaleString("en-US")}</span>
              <span className="font-mono text-[11px] text-ink-3 ml-1.5">
                {typeof tier.priceSol === "number" && tier.priceSol > 0 ? `· ≈ ${fmtSol(tier.priceSol)} SOL` : "· SOL"}
              </span>
            </>
          ) : (
            <>
              <span className="font-display font-extrabold text-2xl text-ink">{t(tier.priceKey)}</span>
              {tier.fiatKey && (
                <span className="font-mono text-[11px] text-ink-3 ml-1.5">· {t(tier.fiatKey)}</span>
              )}
            </>
          )}
        </div>
        <div className="h-4 mt-0.5 text-center">
          {tier.subKey && (
            <span className="font-mono text-[10px] text-ink-3">
              {t("pricing.subSoon")} · {t(tier.subKey)}
            </span>
          )}
        </div>

        {/* Model + cap */}
        <div className="mt-2 text-center font-mono text-[11px] text-ink-2">
          {t(tier.modelKey)} <span className="text-ink-4">·</span> {t(tier.capKey)}
        </div>

        {/* Features */}
        <ul className="mt-4 space-y-2 flex-1">
          {tier.features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", a.check)} />
              <span className="font-sans text-[12px] text-ink-2 leading-snug">{t(f)}</span>
            </li>
          ))}
        </ul>

        {/* CTA — waitlist modal for visitors; live plan switch for the admin
            test wallet (source='admin' in tier_cache) */}
        <div className="mt-5">
          {admin ? (
            admin.isCurrent ? (
              <div className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 font-mono text-[11px] tracking-widest uppercase border border-green/40 bg-green/[0.08] text-green">
                <BadgeCheck className="w-3.5 h-3.5" />
                {t("pricing.adminActive")}
              </div>
            ) : (
              <button
                type="button"
                onClick={admin.onSelect}
                disabled={admin.selecting}
                className={cn(
                  "w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 font-mono text-[11px] tracking-widest uppercase transition-all disabled:opacity-60",
                  a.cta,
                )}
              >
                {admin.selecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BadgeCheck className="w-3.5 h-3.5" />}
                {t("pricing.adminUse")}
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={onMint}
              className={cn(
                "w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 font-mono text-[11px] tracking-widest uppercase transition-all",
                a.cta,
              )}
            >
              <Wallet className="w-3.5 h-3.5" />
              {t("pricing.ctaMint")}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
