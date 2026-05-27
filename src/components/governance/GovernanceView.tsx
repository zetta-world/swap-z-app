"use client";

import { motion } from "framer-motion";
import { Vote, Inbox } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Governance is on the roadmap but not yet wired to an on-chain proposal
 * registry. Until ZETTA DAO contracts ship, we render an honest "coming
 * soon" state instead of fabricated proposals. When the contracts are
 * live, this view will fetch active/passed proposals from the on-chain
 * Governor and render the real list.
 */
export default function GovernanceView() {
  const t = useT();
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[420px] h-[420px] rounded-full bg-violet/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <Vote className="w-4 h-4 text-violet" />
            <span className="font-mono text-[10px] text-violet/80 tracking-widest uppercase">
              {t("governance.eyebrow")}
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            <span className="text-grad-aurora">{t("governance.title")}</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed">
            {t("governance.body")}
          </p>
        </motion.div>

        <div className="rounded-2xl border border-white/8 bg-bg-1/40 p-8 text-center">
          <Inbox className="w-6 h-6 text-ink-3 mx-auto mb-3" />
          <div className="font-display font-bold text-base text-ink mb-1.5">
            {t("governance.comingSoonTitle")}
          </div>
          <p className="font-sans text-sm text-ink-2 max-w-md mx-auto leading-relaxed">
            {t("governance.comingSoonBody")}
          </p>
        </div>
      </div>
    </div>
  );
}
