"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Globe, Sparkles, Activity, Zap, BarChart2, Clock } from "lucide-react";
import SwapCard from "@/components/swap/SwapCard";
import TierClassBanner from "@/components/tier/TierClassBanner";
import StatPanel from "./StatPanel";
import TraderRightPanel from "./TraderRightPanel";
import { useT } from "@/lib/i18n";
import { useTierAccent } from "@/components/tier/TierAccentProvider";

export default function SwapDashboard() {
  const t = useT();
  const { active, tier } = useTierAccent();
  const isTrader = active && tier === "trader";

  return (
    <div className="dashboard-shell">

      {/* ════════════════════════════════════════════════
          MAIN BODY: center column + right panel
          ════════════════════════════════════════════════ */}
      <div className="dashboard-body">

        {/* ── CENTER COLUMN ─────────────────────────── */}
        <div className="dashboard-center">

          {/* Compact hero */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="dashboard-hero"
          >
            <TierClassBanner />
            {!isTrader && (
              <>
                <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink leading-tight tracking-tight">
                  {t("hero.titleThe")}{" "}
                  <span className="text-grad-aurora">{t("hero.titleNexus")}</span>
                </h1>
                <p className="font-sans text-sm text-ink-2/80 mt-1 max-w-md">
                  {t("hero.body1")}{" "}
                  <span className="text-cyan font-semibold">{t("hero.chains11")}</span>
                  {" "}{t("hero.body2")}{" "}
                  <span className="text-gold font-semibold">{t("hero.zionAi")}</span>
                  {" "}{t("hero.body3")}
                </p>
              </>
            )}
          </motion.div>

          {/* Swap card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <SwapCard />

            {/* Bridge CTA */}
            <Link
              href="/bridge"
              className="mt-3 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-violet/20 bg-violet/[0.05] hover:border-violet/40 hover:bg-violet/[0.10] transition-all group"
            >
              <Globe className="w-3.5 h-3.5 text-violet flex-shrink-0" />
              <span className="font-mono text-[11px] text-violet/90 tracking-wide flex-1 truncate">
                {t("swap.sendToDiffChain")}
              </span>
            </Link>

            {/* Chips */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Chip icon={<Sparkles className="w-3 h-3" />} label={t("swap.chipZionSafe")} tone="gold"  />
              <Chip icon={<Activity  className="w-3 h-3" />} label={t("swap.chipRoutes", { n: 14 })}   tone="cyan"  />
              <Chip label={t("swap.chipMev")} tone="green" />
            </div>
          </motion.div>

          {/* 4-stat strip */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
          >
            <StatPanel />
          </motion.div>

          {/* ── Bottom analytics grid ── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {/* Thunder Terminal */}
            <div className="god-card glass-pane rounded-xl border border-white/5 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                <BarChart2 className="w-3.5 h-3.5 text-violet" />
                <span className="font-display font-bold text-sm text-ink">Thunder Terminal</span>
                <span className="ml-auto font-mono text-[9px] text-ink-4 tracking-widest uppercase">Terminal Pro</span>
              </div>
              <div className="p-4 space-y-2">
                <TerminalRow label="AI Sinal"    value="Forte Compra"   tone="green" />
                <TerminalRow label="Confiança"   value="92%"            tone="gold"  />
                <TerminalRow label="Momento"     value="Alta Polaridade" tone="violet" />
                <TerminalRow label="Liquidez"    value="Excelente"      tone="cyan"  />
              </div>
              <div className="px-4 pb-3">
                <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase text-center">
                  SINAL TERMINAL · COMPLETO
                </div>
              </div>
            </div>

            {/* Raios do Trovão mini */}
            <div className="god-card glass-pane rounded-xl border border-white/5 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                <Zap className="w-3.5 h-3.5 text-gold" />
                <span className="font-display font-bold text-sm text-ink">Raios do Trovão</span>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {[
                  { ev: "Swap Executado",     val: "+168.00 USDC", t: "Agora", tone: "green"  as const },
                  { ev: "Nova Conquista",      val: "Relâmpago Preciso", t: "2m", tone: "gold" as const },
                  { ev: "ZION AI Insight",    val: "Oportunidade detectada", t: "5m", tone: "violet" as const },
                  { ev: "Liquidez Adicionada",val: "MATIC/USDC 0.3%", t: "12m", tone: "cyan" as const },
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      row.tone === "green" ? "bg-green" : row.tone === "gold" ? "bg-gold" :
                      row.tone === "violet" ? "bg-violet" : "bg-cyan"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-sans text-xs text-ink truncate">{row.ev}</div>
                      <div className="font-mono text-[10px] text-ink-3 truncate">{row.val}</div>
                    </div>
                    <span className="font-mono text-[10px] text-ink-4 flex-shrink-0">{row.t}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Footer */}
          <div className="pt-4 border-t border-white/5 flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] text-ink-4 leading-relaxed">
              {t("hero.footerDisclaimer")}
            </p>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-mono text-[10px] text-ink-4">Powered by</span>
              <span className="font-display font-bold text-[11px] text-ink">ZETTA</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ───────────────────────────── */}
        <aside className="dashboard-right">
          <TraderRightPanel />
        </aside>
      </div>
    </div>
  );
}

function Chip({ icon, label, tone }: { icon?: React.ReactNode; label: string; tone: "cyan" | "gold" | "green" | "violet" }) {
  const cls = { cyan: "border-cyan/20 bg-cyan/5 text-cyan", gold: "border-gold/20 bg-gold/5 text-gold", green: "border-green/20 bg-green/5 text-green", violet: "border-violet/20 bg-violet/5 text-violet" }[tone];
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${cls} font-mono text-[10px] tracking-wide`}>{icon}{label}</span>;
}

function TerminalRow({ label, value, tone }: { label: string; value: string; tone: "green" | "gold" | "violet" | "cyan" }) {
  const cls = { green: "text-green", gold: "text-gold", violet: "text-violet", cyan: "text-cyan" }[tone];
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] text-ink-3 uppercase tracking-widest">{label}</span>
      <span className={`font-mono text-[11px] font-medium ${cls}`}>{value}</span>
    </div>
  );
}
