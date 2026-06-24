"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe, Zap, Brain, Bell, Shield, KeyRound, Banknote,
} from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import CexSettings from "./CexSettings";
import AutopilotPanel from "./AutopilotPanel";
import { useT, type MessageKey } from "@/lib/i18n";
import { useTierAccent } from "@/components/tier/TierAccentProvider";
import { cn } from "@/lib/cn";

// ─── Tab registry ─────────────────────────────────────────────────────────

const TABS = [
  { id: "appearance",    Icon: Globe,     labelKey: "settings.groupAppearance" },
  { id: "execution",     Icon: Zap,       labelKey: "settings.groupExecution"  },
  { id: "zion",          Icon: Brain,     labelKey: "settings.groupZion"       },
  { id: "notifications", Icon: Bell,      labelKey: "settings.groupNotifications" },
  { id: "security",      Icon: Shield,    labelKey: "settings.groupSecurity"   },
  { id: "rpc",           Icon: KeyRound,  labelKey: "settings.groupRpc"        },
  { id: "cex",           Icon: Banknote,  labelKey: "nav.cex"                  },
] as const;

type TabId = typeof TABS[number]["id"];

// ─── Page ─────────────────────────────────────────────────────────────────

export default function SettingsView() {
  const [active, setActive] = useState<TabId>("appearance");
  const { accentColor, glowColor } = useTierAccent();
  const t = useT();

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-[420px] h-[420px] rounded-full blur-3xl pointer-events-none"
           style={{ background: `color-mix(in srgb, ${accentColor} 8%, transparent)` }} />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-5xl mx-auto">

        {/* Page header */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: accentColor }}>
              {t("settings.title")}
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.2rem)] leading-[0.98] tracking-tight text-ink">
            {t("settings.pageTitleA")}{" "}
            <span className="text-grad-aurora">{t("settings.pageTitleHL")}</span>
          </h1>
          <p className="font-sans text-sm text-ink-2 mt-2 max-w-xl">{t("settings.pageBody")}</p>
        </motion.div>

        {/* Layout: tab rail + panel */}
        <div className="flex flex-col lg:flex-row gap-5">

          {/* ── Tab rail ──────────────────────────────────────────────── */}
          {/* Mobile: horizontal scroll pill bar */}
          <nav
            className="flex lg:hidden gap-1 overflow-x-auto no-scrollbar pb-1"
            aria-label="Settings sections"
          >
            {TABS.map(({ id, Icon, labelKey }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase whitespace-nowrap transition-all flex-shrink-0 border",
                    isActive
                      ? "text-bg border-transparent"
                      : "bg-white/[0.03] border-white/[0.08] text-ink-3 hover:text-ink-2 hover:bg-white/[0.06]",
                  )}
                  style={isActive ? {
                    background: `linear-gradient(135deg, ${accentColor} 0%, color-mix(in srgb, ${accentColor} 70%, #7c3aed) 100%)`,
                    boxShadow: `0 0 18px -4px ${glowColor}`,
                  } : undefined}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  {t(labelKey as MessageKey)}
                </button>
              );
            })}
          </nav>

          {/* Desktop: vertical sidebar rail */}
          <nav
            className="hidden lg:flex flex-col gap-0.5 w-52 flex-shrink-0"
            aria-label="Settings sections"
          >
            {TABS.map(({ id, Icon, labelKey }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={cn(
                    "relative flex items-center gap-3 px-3.5 py-3 rounded-xl font-sans text-sm text-left transition-all border",
                    isActive
                      ? "text-ink border-transparent"
                      : "text-ink-3 border-transparent hover:text-ink-2 hover:bg-white/[0.03]",
                  )}
                  style={isActive ? {
                    background: `color-mix(in srgb, ${accentColor} 11%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentColor} 28%, transparent)`,
                  } : undefined}
                >
                  {isActive && (
                    <motion.span
                      layoutId="settings-active-bar"
                      className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
                      style={{ background: accentColor, boxShadow: `0 0 10px -1px ${glowColor}` }}
                    />
                  )}
                  <Icon
                    className="w-4 h-4 flex-shrink-0"
                    style={isActive ? { color: accentColor } : undefined}
                  />
                  <span className="flex-1 truncate">{t(labelKey as MessageKey)}</span>
                </button>
              );
            })}
          </nav>

          {/* ── Tab panels ────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {active === "appearance"    && <AppearancePanel />}
                {active === "execution"     && <ExecutionPanel />}
                {active === "zion"          && <ZionPanel />}
                {active === "notifications" && <NotificationsPanel />}
                {active === "security"      && <SecurityPanel />}
                {active === "rpc"           && <RpcPanel />}
                {active === "cex"           && <CexPanel />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-8">{t("settings.saveSettings")}</p>
      </div>
    </div>
  );
}

// ─── Tab panels ───────────────────────────────────────────────────────────

function AppearancePanel() {
  const { mode, setMode, lang, setLang } = useUI();
  const t = useT();

  const modeLabels: Record<"standard" | "pro" | "privacy", MessageKey> = {
    standard: "settings.appModeStandard",
    pro:      "settings.appModePro",
    privacy:  "settings.appModePrivacy",
  };

  return (
    <PanelCard title={t("settings.groupAppearance")} Icon={Globe}>
      <Field label={t("settings.uiMode")}>
        <Seg
          options={["standard", "pro", "privacy"] as const}
          value={mode}
          onChange={setMode}
          label={(m) => t(modeLabels[m])}
          tone="cyan"
        />
      </Field>
      <Field label={t("settings.langLabel")}>
        <Seg
          options={["en", "pt", "es", "zh"] as const}
          value={lang}
          onChange={setLang}
          label={(l) => l.toUpperCase()}
          tone="cyan"
        />
      </Field>
    </PanelCard>
  );
}

function ExecutionPanel() {
  const { mevProtect, privacyMode, slippageBps, setMev, setPrivacy, setSlippage } = useSwap();
  const t = useT();

  return (
    <PanelCard title={t("settings.groupExecution")} Icon={Zap}>
      <Field label={t("settings.defaultSlippage", { pct: (slippageBps / 100).toFixed(2) })}>
        <input
          type="range" min={5} max={500} step={5} value={slippageBps}
          onChange={(e) => setSlippage(parseInt(e.target.value, 10))}
          className="range-slider w-full"
        />
        <div className="flex justify-between font-mono text-[9px] text-ink-3 tracking-widest uppercase mt-1">
          <span>0.05%</span><span>2.50%</span><span>5.00%</span>
        </div>
      </Field>
      <Toggle
        label={t("settings.mevProtectionTitle")}
        description={t("settings.mevProtectionDesc")}
        value={mevProtect}
        onChange={setMev}
        tone="green"
      />
      <Toggle
        label={t("settings.privacyModeTitle")}
        description={t("settings.privacyModeDesc")}
        value={privacyMode}
        onChange={setPrivacy}
        tone="gold"
      />
    </PanelCard>
  );
}

function ZionPanel() {
  const [zionMode, setZionMode] = useState<"conservative" | "advanced" | "institutional">("advanced");
  const t = useT();

  const zionLabels: Record<"conservative" | "advanced" | "institutional", MessageKey> = {
    conservative:  "settings.zionModeConservative",
    advanced:      "settings.zionModeAdvanced",
    institutional: "settings.zionModeInstitutional",
  };

  return (
    <div className="space-y-4">
      <PanelCard title={t("settings.groupZion")} Icon={Brain}>
        <p className="font-sans text-xs text-ink-3 leading-relaxed">{t("settings.zionModeBody")}</p>
        <Field label="Modo de operação">
          <Seg
            options={["conservative", "advanced", "institutional"] as const}
            value={zionMode}
            onChange={setZionMode}
            label={(m) => t(zionLabels[m])}
            tone="gold"
          />
        </Field>
        <div className="rounded-xl border border-gold/15 bg-gold/[0.04] p-3 flex gap-2.5">
          <Brain className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">{t("settings.zionCostNote")}</p>
        </div>
      </PanelCard>
      <AutopilotPanel />
    </div>
  );
}

function NotificationsPanel() {
  const t = useT();
  return (
    <PanelCard title={t("settings.groupNotifications")} Icon={Bell}>
      <Toggle label={t("settings.notifPriceAlerts")} description={t("settings.notifPriceAlertsDesc")} value={true}  onChange={() => {}} tone="cyan" />
      <Toggle label={t("settings.notifLiquidity")}   description={t("settings.notifLiquidityDesc")}   value={true}  onChange={() => {}} tone="violet" />
      <Toggle label={t("settings.notifGovernance")}  description={t("settings.notifGovernanceDesc")}  value={false} onChange={() => {}} tone="gold" />
      <Toggle label={t("settings.notifFills")}       description={t("settings.notifFillsDesc")}       value={true}  onChange={() => {}} tone="green" />
    </PanelCard>
  );
}

function SecurityPanel() {
  const t = useT();
  return (
    <PanelCard title={t("settings.groupSecurity")} Icon={Shield}>
      <Toggle label={t("settings.confirmEverySwap")} description={t("settings.confirmEverySwapDesc")} value={true}  onChange={() => {}} tone="green" />
      <Toggle label={t("settings.blockUnverified")}  description={t("settings.blockUnverifiedDesc")}  value={false} onChange={() => {}} tone="red" />
      <Toggle label={t("settings.highRiskGate")}     description={t("settings.highRiskGateDesc")}     value={true}  onChange={() => {}} tone="gold" />
      <Toggle label={t("settings.encryptedCache")}   description={t("settings.encryptedCacheDesc")}   value={true}  onChange={() => {}} tone="cyan" />
    </PanelCard>
  );
}

function RpcPanel() {
  const t = useT();
  return (
    <PanelCard title={t("settings.groupRpc")} Icon={KeyRound}>
      <p className="font-sans text-xs text-ink-3 leading-relaxed">{t("settings.rpcBody")}</p>
      {[
        { chain: "Ethereum", placeholder: "https://eth-mainnet.g.alchemy.com/v2/…" },
        { chain: "BSC",      placeholder: "https://bsc-dataseed.binance.org" },
        { chain: "Solana",   placeholder: "https://api.mainnet-beta.solana.com" },
      ].map((r) => (
        <Field key={r.chain} label={r.chain}>
          <input
            placeholder={r.placeholder}
            className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2.5 text-xs font-mono text-ink-2 outline-none focus:border-cyan/30 placeholder:text-ink-4 transition-colors"
          />
        </Field>
      ))}
    </PanelCard>
  );
}

function CexPanel() {
  return <CexSettings />;
}

// ─── Shared primitives ────────────────────────────────────────────────────

function PanelCard({
  title, Icon, children,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="god-card rounded-2xl border border-white/5 glass-pane p-5 space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-cyan" />
        </div>
        <span className="font-display font-bold text-base text-ink">{title}</span>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-2">{label}</div>
      {children}
    </div>
  );
}

// Proper segmented control with animated sliding pill
function Seg<T extends string>({
  options, value, onChange, label, tone,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => string;
  tone: "cyan" | "gold" | "violet";
}) {
  const activeIdx = options.indexOf(value);
  const pct = (100 / options.length) * activeIdx;
  const w   = 100 / options.length;

  const toneClasses = {
    cyan:   "text-cyan",
    gold:   "text-gold",
    violet: "text-violet",
  }[tone];
  const toneBg = {
    cyan:   "bg-cyan/[0.12] border-cyan/30",
    gold:   "bg-gold/[0.12] border-gold/30",
    violet: "bg-violet/[0.12] border-violet/30",
  }[tone];

  return (
    <div className="relative flex rounded-xl bg-bg-2 border border-white/[0.08] p-1 overflow-hidden">
      {/* Sliding pill */}
      <motion.span
        className={cn("absolute top-1 bottom-1 rounded-lg border transition-none", toneBg)}
        animate={{ left: `calc(${pct}% + 4px)`, width: `calc(${w}% - 8px)` }}
        transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.8 }}
      />
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "relative z-10 flex-1 py-2.5 font-mono text-[10px] tracking-widest uppercase rounded-lg transition-colors duration-150",
            value === opt ? toneClasses : "text-ink-4 hover:text-ink-3",
          )}
        >
          {label(opt)}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label, description, value, onChange, tone,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  tone: "green" | "cyan" | "gold" | "violet" | "red";
}) {
  const trackOn = {
    green: "bg-green",   cyan:   "bg-cyan",  gold: "bg-gold",
    violet: "bg-violet", red:    "bg-red",
  }[tone];

  return (
    <div className="flex items-start gap-3.5 py-1">
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        className={cn(
          "relative w-10 h-[22px] rounded-full flex-shrink-0 transition-colors duration-200",
          value ? trackOn : "bg-white/10",
        )}
      >
        <motion.span
          animate={{ x: value ? 20 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm"
          style={{ boxShadow: value ? "0 0 6px -1px rgba(0,0,0,0.4)" : undefined }}
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className="font-display font-bold text-[13px] text-ink leading-snug">{label}</div>
        <div className="font-sans text-[11px] text-ink-3 leading-relaxed mt-0.5">{description}</div>
      </div>
    </div>
  );
}
