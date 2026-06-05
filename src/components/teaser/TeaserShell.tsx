"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, Mail, CheckCircle2, Loader2, ArrowRight, ShieldCheck,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * TeaserShell — canonical "Em breve" gate layout.
 *
 * The four teaser pages (/buy, /otc, /p2p, /nft) all share the same
 * five-section structure: gold badge → display headline → subtitle →
 * optional tabs → preview card → optional auxiliary section → gold
 * waitlist card → cyan trust line. Before this component each page
 * inlined ~80 lines of nearly identical JSX; one drift and the visual
 * identity would crack across the trade group.
 *
 * What stays per-page: only the preview content + any teaching section
 * (how-it-works, mock quotes etc.) — both flow in as children. Tabs,
 * waitlist storage + form behaviour, trust line: all handled here so
 * the form contract (email validation, localStorage persistence,
 * placeholder-by-audience) is identical across surfaces.
 */

export interface TeaserTabOption<T extends string> {
  id:    T;
  label: string;
  icon:  React.ComponentType<{ className?: string }>;
  tone:  "green" | "violet";
}

export interface TeaserShellProps<T extends string = string> {
  /** Hero copy. titleHL renders in the cyan gradient if present. */
  hero: {
    titleA:   string;
    titleHL?: string;
    titleB:   string;
    /** Either a plain string OR pre-rendered nodes (for inline `<b>` highlights). */
    subtitle: ReactNode;
  };
  /** Optional binary tab strip rendered above the preview. */
  tabs?: {
    value:    T;
    onChange: (v: T) => void;
    options:  [TeaserTabOption<T>, TeaserTabOption<T>];
  };
  /** Gold waitlist card. */
  waitlist: {
    Icon:         React.ComponentType<{ className?: string }>;
    title:        string;
    body:         ReactNode;
    doneHL:       string;
    doneBody:     string;
    /** localStorage key used to remember the user already submitted. */
    storageKey:   string;
    /** Picks the right placeholder copy (`teaser.emailPersonal` vs `.emailCompany`). */
    audience?:    "personal" | "company";
  };
  /** Cyan trust line at the bottom of the page. */
  trustLine: ReactNode;
  /** Preview card + any teaching sections live here. */
  children: ReactNode;
}

export default function TeaserShell<T extends string = string>({
  hero, tabs, waitlist, trustLine, children,
}: TeaserShellProps<T>) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return !!window.localStorage.getItem(waitlist.storageKey); } catch { return false; }
  });

  const onJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return;
    setSubmitting(true);
    try {
      window.localStorage.setItem(waitlist.storageKey, JSON.stringify({ email: trimmed, at: Date.now() }));
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const placeholder = waitlist.audience === "company"
    ? t("teaser.emailCompany")
    : t("teaser.emailPersonal");

  const WaitlistIcon = waitlist.Icon;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10 space-y-6">
      {/* Hero */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/30 bg-gold/[0.05] font-mono text-[10px] tracking-widest uppercase text-gold">
          <Sparkles className="w-3 h-3" /> {t("teaser.soon")}
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink leading-tight">
          {hero.titleHL ? (
            <>
              {hero.titleA} <span className="text-gradient-cyan">{hero.titleHL}</span>
            </>
          ) : (
            <span className="text-gradient-cyan">{hero.titleA}</span>
          )}
          <br />
          {hero.titleB}
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed max-w-2xl">
          {hero.subtitle}
        </p>
      </div>

      {/* Tabs */}
      {tabs && (
        <div className="inline-flex w-full rounded-xl border border-white/5 bg-bg-1/30 p-1">
          {tabs.options.map((opt) => {
            const Icon = opt.icon;
            const active = tabs.value === opt.id;
            const activeCls = opt.tone === "green"
              ? "bg-green/15 text-green border border-green/30"
              : "bg-violet/15 text-violet border border-violet/30";
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => tabs.onChange(opt.id)}
                className={cn(
                  "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
                  active ? activeCls : "text-ink-3 hover:text-ink-2",
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {children}

      {/* Waitlist */}
      <motion.div
        layout
        className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/[0.04] to-cyan/[0.03] p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <WaitlistIcon className="w-4 h-4 text-gold" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-base text-ink">{waitlist.title}</h2>
            <p className="font-sans text-xs sm:text-sm text-ink-2 leading-relaxed mt-1">
              {waitlist.body}
            </p>
          </div>
        </div>

        {submitted ? (
          <div className="rounded-lg border border-green/30 bg-green/[0.05] px-3 py-3 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
            <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
              <b className="text-green">{waitlist.doneHL}</b> {waitlist.doneBody}
            </div>
          </div>
        ) : (
          <form onSubmit={onJoin} className="flex items-stretch gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-white/10 bg-bg-2 px-3 focus-within:border-gold/40">
              <Mail className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={placeholder}
                maxLength={120}
                className="flex-1 min-w-0 bg-transparent outline-none font-mono text-sm text-ink placeholder:text-ink-4 py-2.5"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="px-4 py-2.5 rounded-lg border border-gold/40 bg-gold/15 text-gold font-mono text-[11px] tracking-widest uppercase hover:bg-gold/25 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              {t("teaser.enter")}
            </button>
          </form>
        )}
      </motion.div>

      {/* Trust line */}
      <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          {trustLine}
        </p>
      </div>
    </div>
  );
}

/**
 * Preview card wrapper — the cyan / violet blobs + glass pane that
 * each teaser uses to frame its mock data. Optional convenience: a
 * teaser can pass its preview JSX into a `<TeaserCard>` and skip the
 * boilerplate.
 */
export function TeaserCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 overflow-hidden",
        className,
      )}
    >
      <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-20 w-72 h-72 rounded-full bg-violet/10 blur-3xl pointer-events-none" />
      <div className="relative space-y-5">{children}</div>
    </motion.div>
  );
}
