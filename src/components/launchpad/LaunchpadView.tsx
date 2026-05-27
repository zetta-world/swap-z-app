"use client";

import { motion } from "framer-motion";
import { Rocket, Inbox } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Launchpad is on the roadmap but no projects are live in the Z-PAD
 * factory yet. Until token-launch contracts ship, we render an honest
 * "coming soon" state instead of fabricated projects. When the factory
 * is live, this view will fetch active launches from the registry and
 * render the real list.
 */
export default function LaunchpadView() {
  const t = useT();
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/3 right-1/3 w-[480px] h-[480px] rounded-full bg-gold/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <Rocket className="w-4 h-4 text-gold" />
            <span className="font-mono text-[10px] text-gold/80 tracking-widest uppercase">
              {t("launchpad.eyebrow")}
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            <span className="text-grad-aurora">{t("launchpad.title")}</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed">
            {t("launchpad.body")}
          </p>
        </motion.div>

        <div className="rounded-2xl border border-white/8 bg-bg-1/40 p-8 text-center">
          <Inbox className="w-6 h-6 text-ink-3 mx-auto mb-3" />
          <div className="font-display font-bold text-base text-ink mb-1.5">
            {t("launchpad.comingSoonTitle")}
          </div>
          <p className="font-sans text-sm text-ink-2 max-w-md mx-auto leading-relaxed">
            {t("launchpad.comingSoonBody")}
          </p>
        </div>
      </div>
    </div>
  );
}
