"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowRight, Globe } from "lucide-react";
import Link from "next/link";
import SwapCard from "@/components/swap/SwapCard";
import StatPanel from "./StatPanel";
import TopMovers from "./TopMovers";
import ChainConstellation from "./ChainConstellation";
import { Activity, Sparkles } from "lucide-react";

// Liquid Nexus (R3F) is heavy and uses browser-only APIs — load client-only
const LiquidNexus = dynamic(() => import("@/components/viz/LiquidNexus"), { ssr: false });

export default function SwapDashboard() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      {/* Cinematic 3D backdrop */}
      <div className="absolute inset-0 pointer-events-none">
        <LiquidNexus />
      </div>

      {/* Grid overlay for subtle techno texture */}
      <div className="absolute inset-0 grid-bg opacity-50 pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-6 lg:py-10 max-w-[1480px] mx-auto">
        {/* Hero header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 lg:mb-8 max-w-3xl"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px w-8 bg-cyan/40" />
            <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">
              ZETTA · Liquidity Layer · v0.1 demo
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(2rem,5.2vw,3.6rem)] leading-[0.98] tracking-[-0.02em] text-ink mb-3">
            The{" "}
            <span className="text-grad-aurora">Liquidity Nexus</span>
          </h1>
          <p className="font-sans text-base sm:text-lg text-ink-2/95 leading-relaxed max-w-2xl">
            Trade, route and analyze across <span className="text-cyan font-semibold">11 chains</span> with{" "}
            <span className="text-gold font-semibold">ZION AI</span> advising every move.
            Cross-chain native. MEV-protected. Institutional grade.
          </p>
        </motion.div>

        {/* Stat panel */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="mb-5"
        >
          <StatPanel />
        </motion.div>

        {/* Main grid: Swap centerpiece + side rails */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          {/* Left rail: chain constellation */}
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-3 order-2 lg:order-1"
          >
            <ChainConstellation />
          </motion.div>

          {/* Centerpiece: Swap card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="lg:col-span-6 order-1 lg:order-2"
          >
            <SwapCard />

            {/* Cross-Chain discovery CTA */}
            <Link
              href="/bridge"
              className="mt-4 block rounded-xl border border-violet/20 bg-gradient-to-r from-violet/[0.06] via-cyan/[0.03] to-violet/[0.06] hover:border-violet/40 hover:from-violet/[0.10] transition-all p-3 group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-violet/15 border border-violet/30 flex items-center justify-center flex-shrink-0">
                  <Globe className="w-4 h-4 text-violet" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-sm text-ink">
                    Send to a different chain
                  </div>
                  <p className="font-mono text-[10px] text-ink-3 tracking-wide truncate">
                    Cross-chain bridge · LiFi · 30+ networks · with custom recipient
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-violet/70 group-hover:text-violet group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </div>
            </Link>

            {/* Strip under swap: quick chips */}
            <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
              <Chip icon={<Sparkles className="w-3 h-3" />}    label="ZION rates this safe" tone="gold"   />
              <Chip icon={<Activity className="w-3 h-3" />}     label="14 routes evaluated"  tone="cyan"   />
              <Chip label="MEV shield active"                    tone="green"  />
            </div>
          </motion.div>

          {/* Right rail: top movers */}
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="lg:col-span-3 order-3"
          >
            <TopMovers />
          </motion.div>
        </div>

        {/* Footer disclaimer */}
        <div className="mt-12 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="font-mono text-[10px] text-ink-4 tracking-wide leading-relaxed max-w-2xl">
            Z-SWAP is infrastructure software. ZION operates in advisory mode exclusively — all suggestions require manual user review.
            Demo environment · not investment advice · VARA / VASP alignment in preparation.
          </p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-ink-3">Powered by</span>
            <span className="font-display font-bold text-xs text-ink">ZETTA</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ icon, label, tone }: { icon?: React.ReactNode; label: string; tone: "cyan" | "gold" | "green" | "violet" }) {
  const cls = {
    cyan:   "border-cyan/20 bg-cyan/5 text-cyan",
    gold:   "border-gold/20 bg-gold/5 text-gold",
    green:  "border-green/20 bg-green/5 text-green",
    violet: "border-violet/20 bg-violet/5 text-violet",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${cls} font-mono text-[10px] tracking-wide`}>
      {icon}
      {label}
    </span>
  );
}
