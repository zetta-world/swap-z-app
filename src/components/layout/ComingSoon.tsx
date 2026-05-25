"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import AppShell from "./AppShell";
import { useT } from "@/lib/i18n";

export default function ComingSoon({
  title,
  subtitle,
  phase,
  bullets = [],
}: {
  title: string;
  subtitle: string;
  phase?: string;
  bullets?: string[];
}) {
  const t = useT();
  const phaseLabel = phase ?? t("comingSoon.inDevelopment");
  return (
    <AppShell>
      <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 w-[420px] h-[420px] rounded-full bg-grad-cyan opacity-10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/3 right-1/4 w-[320px] h-[320px] rounded-full bg-violet/20 blur-3xl pointer-events-none" />

        <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-10 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Link
              href="/"
              className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-3 hover:text-cyan tracking-widest uppercase mb-6 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("comingSoon.backToSwap")}
            </Link>

            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gold/30 bg-gold/[0.06] mb-5">
              <Sparkles className="w-3 h-3 text-gold" />
              <span className="font-mono text-[10px] text-gold tracking-widest uppercase">{phaseLabel}</span>
            </div>

            <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-tight tracking-tight text-ink mb-4">
              {title}
            </h1>
            <p className="font-sans text-lg text-ink-2 leading-relaxed mb-8 max-w-2xl">
              {subtitle}
            </p>

            {bullets.length > 0 && (
              <div className="rounded-2xl border border-white/5 glass-pane p-6 space-y-3">
                <div className="font-mono text-[10px] text-cyan tracking-widest uppercase mb-2">
                  {t("comingSoon.comingInModule")}
                </div>
                {bullets.map((b, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    className="flex items-start gap-3"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan mt-2 flex-shrink-0" />
                    <span className="font-sans text-sm text-ink-2 leading-relaxed">{b}</span>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </AppShell>
  );
}
