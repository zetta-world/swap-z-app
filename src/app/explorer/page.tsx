"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radar, Shield, Activity, Layers } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import NexusRadar from "@/components/explorer/NexusRadar";
import LiveFeed from "@/components/explorer/LiveFeed";
import PoolsCatalog from "@/components/explorer/PoolsCatalog";
import RiskScanner from "@/components/explorer/RiskScanner";
import { cn } from "@/lib/cn";

type Tab = "radar" | "live" | "catalog" | "scanner";

export default function Page() {
  const [tab, setTab] = useState<Tab>("radar");

  return (
    <AppShell>
      <div className="space-y-4 min-w-0">
        {/* Tab switcher */}
        <div className="relative grid grid-cols-4 gap-1 p-1 rounded-xl border border-white/5 bg-bg-1/60 max-w-2xl">
          <TabButton active={tab === "radar"}   Icon={Radar}    label="Nexus Radar"   onClick={() => setTab("radar")} />
          <TabButton active={tab === "live"}    Icon={Activity} label="Live Feed"     onClick={() => setTab("live")} />
          <TabButton active={tab === "catalog"} Icon={Layers}   label="Catalog"       onClick={() => setTab("catalog")} />
          <TabButton active={tab === "scanner"} Icon={Shield}   label="Risk Scanner"  onClick={() => setTab("scanner")} />
        </div>

        <AnimatePresence mode="wait">
          {tab === "radar" && (
            <motion.div key="radar" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>
              <NexusRadar />
            </motion.div>
          )}
          {tab === "live" && (
            <motion.div key="live" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>
              <LiveFeed />
            </motion.div>
          )}
          {tab === "catalog" && (
            <motion.div key="catalog" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>
              <PoolsCatalog />
            </motion.div>
          )}
          {tab === "scanner" && (
            <motion.div key="scanner" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>
              <RiskScanner />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}

function TabButton({
  active, Icon, label, onClick,
}: {
  active:  boolean;
  Icon:    typeof Radar;
  label:   string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 flex items-center justify-center gap-1.5 py-2 rounded-lg transition-colors min-w-0",
        active ? "text-cyan" : "text-ink-3 hover:text-ink-2",
      )}
    >
      {active && (
        <motion.span
          layoutId="explorer-tab"
          className="absolute inset-0 rounded-lg bg-cyan/[0.08] border border-cyan/25 shadow-[0_0_24px_-8px_rgba(0,232,255,0.5)]"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      <Icon className="w-3.5 h-3.5 relative" />
      <span className="font-mono text-[10px] sm:text-[11px] tracking-widest uppercase relative truncate">
        {label}
      </span>
    </button>
  );
}
