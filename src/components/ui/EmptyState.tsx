"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Canonical empty-state slot. Use this anywhere a list, scanner or
 * dashboard has zero results so the surface stays recognisable across
 * the app instead of every page inventing its own variant. Keeps the
 * Z-SWAP "glass pane + icon + display headline + mono caption" look.
 *
 * Variants:
 *   - tone: changes the icon halo and the optional CTA accent.
 *   - density: `default` (p-8) for top-level empty surfaces, `compact`
 *     (p-5) for inline lists inside an existing card.
 *
 * CTA is optional. Pass either `cta.href` (internal link) or
 * `cta.onClick` (button).
 */

export type EmptyStateTone = "ink" | "cyan" | "gold" | "violet" | "green";

interface EmptyStateProps {
  Icon:      React.ComponentType<{ className?: string }>;
  title:     string;
  body?:     string;
  tone?:     EmptyStateTone;
  density?:  "default" | "compact";
  cta?: {
    label:    string;
    href?:    string;
    onClick?: () => void;
  };
  className?: string;
}

const TONE_ICON_BG: Record<EmptyStateTone, string> = {
  ink:    "bg-white/[0.03] border-white/10 text-ink-3",
  cyan:   "bg-cyan/[0.06] border-cyan/25 text-cyan",
  gold:   "bg-gold/[0.06] border-gold/30 text-gold",
  violet: "bg-violet/[0.06] border-violet/30 text-violet",
  green:  "bg-green/[0.06] border-green/30 text-green",
};

const TONE_CTA: Record<EmptyStateTone, string> = {
  ink:    "border-white/15 bg-white/[0.04] text-ink hover:bg-white/[0.08]",
  cyan:   "border-cyan/40 bg-cyan/15 text-cyan hover:bg-cyan/25",
  gold:   "border-gold/40 bg-gold/15 text-gold hover:bg-gold/25",
  violet: "border-violet/40 bg-violet/15 text-violet hover:bg-violet/25",
  green:  "border-green/40 bg-green/15 text-green hover:bg-green/25",
};

export default function EmptyState({
  Icon, title, body, tone = "ink", density = "default", cta, className,
}: EmptyStateProps) {
  const padding = density === "compact" ? "p-5" : "p-8";
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/5 bg-bg-1/40 glass-pane text-center",
        padding,
        className,
      )}
    >
      <div
        className={cn(
          "w-10 h-10 mx-auto mb-3 rounded-xl flex items-center justify-center border",
          TONE_ICON_BG[tone],
        )}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="font-display font-bold text-sm sm:text-base text-ink mb-1.5">
        {title}
      </div>
      {body && (
        <p className="font-sans text-xs sm:text-sm text-ink-2 leading-relaxed max-w-md mx-auto">
          {body}
        </p>
      )}
      {cta && (
        <div className="mt-4">
          {cta.href ? (
            <Link
              href={cta.href}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border font-mono text-[11px] tracking-widest uppercase",
                TONE_CTA[tone],
              )}
            >
              {cta.label}
              <ArrowRight className="w-3 h-3" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={cta.onClick}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border font-mono text-[11px] tracking-widest uppercase",
                TONE_CTA[tone],
              )}
            >
              {cta.label}
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
