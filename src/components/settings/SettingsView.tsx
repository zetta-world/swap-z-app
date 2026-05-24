"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Settings as SettingsIcon, Shield, Bell, Globe, EyeOff, Zap, Brain, KeyRound } from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import CexSettings from "./CexSettings";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export default function SettingsView() {
  const { mode, setMode, lang, setLang } = useUI();
  const { mevProtect, privacyMode, slippageBps, setMev, setPrivacy, setSlippage } = useSwap();
  const [zionMode, setZionMode] = useState<"conservative" | "advanced" | "institutional">("advanced");
  const t = useT();

  const modeLabels: Record<"standard" | "pro" | "privacy", MessageKey> = {
    standard: "settings.appModeStandard",
    pro:      "settings.appModePro",
    privacy:  "settings.appModePrivacy",
  };
  const zionLabels: Record<"conservative" | "advanced" | "institutional", MessageKey> = {
    conservative:  "settings.zionModeConservative",
    advanced:      "settings.zionModeAdvanced",
    institutional: "settings.zionModeInstitutional",
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-[420px] h-[420px] rounded-full bg-cyan/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <SettingsIcon className="w-4 h-4 text-cyan" />
            <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">{t("settings.title")}</span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
            {t("settings.pageTitleA")} <span className="text-grad-aurora">{t("settings.pageTitleHL")}</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
            {t("settings.pageBody")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Mode + Language */}
          <Group title={t("settings.groupAppearance")} Icon={Globe}>
            <Field label={t("settings.uiMode")}>
              <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-bg-2 border border-white/10">
                {(["standard", "pro", "privacy"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "py-2 rounded-md font-mono text-[10px] tracking-widest uppercase",
                      mode === m ? "bg-cyan/15 text-cyan" : "text-ink-3 hover:text-ink-2",
                    )}
                  >
                    {t(modeLabels[m])}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t("settings.langLabel")}>
              <div className="grid grid-cols-4 gap-1.5 p-1 rounded-lg bg-bg-2 border border-white/10">
                {(["en", "pt", "es", "zh"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={cn(
                      "py-2 rounded-md font-mono text-[10px] tracking-widest uppercase",
                      lang === l ? "bg-cyan/15 text-cyan" : "text-ink-3 hover:text-ink-2",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>
          </Group>

          {/* Execution defaults */}
          <Group title={t("settings.groupExecution")} Icon={Zap}>
            <Field label={t("settings.defaultSlippage", { pct: (slippageBps / 100).toFixed(2) })}>
              <input
                type="range"
                min={5}
                max={500}
                step={5}
                value={slippageBps}
                onChange={(e) => setSlippage(parseInt(e.target.value, 10))}
                className="range-slider w-full"
              />
              <div className="flex justify-between font-mono text-[9px] text-ink-3 tracking-widest uppercase mt-1">
                <span>0.05%</span>
                <span>2.50%</span>
                <span>5.00%</span>
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
          </Group>

          {/* ZION */}
          <Group title={t("settings.groupZion")} Icon={Brain}>
            <p className="font-sans text-xs text-ink-3 leading-relaxed">
              {t("settings.zionModeBody")}
            </p>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-bg-2 border border-white/10">
              {(["conservative", "advanced", "institutional"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setZionMode(m)}
                  className={cn(
                    "py-2 rounded-md font-mono text-[10px] tracking-widest uppercase",
                    zionMode === m ? "bg-gold/15 text-gold" : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {t(zionLabels[m])}
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-gold/15 bg-gold/[0.04] p-3 flex gap-2.5">
              <Brain className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
              <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
                {t("settings.zionCostNote")}
              </p>
            </div>
          </Group>

          {/* Notifications */}
          <Group title={t("settings.groupNotifications")} Icon={Bell}>
            <Toggle label={t("settings.notifPriceAlerts")} description={t("settings.notifPriceAlertsDesc")} value={true}  onChange={() => {}} tone="cyan" />
            <Toggle label={t("settings.notifLiquidity")}   description={t("settings.notifLiquidityDesc")}   value={true}  onChange={() => {}} tone="violet" />
            <Toggle label={t("settings.notifGovernance")}  description={t("settings.notifGovernanceDesc")}  value={false} onChange={() => {}} tone="gold" />
            <Toggle label={t("settings.notifFills")}       description={t("settings.notifFillsDesc")}       value={true}  onChange={() => {}} tone="green" />
          </Group>

          {/* RPC */}
          <Group title={t("settings.groupRpc")} Icon={KeyRound}>
            <p className="font-sans text-xs text-ink-3 leading-relaxed">
              {t("settings.rpcBody")}
            </p>
            {[
              { chain: "Ethereum", placeholder: "https://eth-mainnet.g.alchemy.com/v2/…" },
              { chain: "BSC",      placeholder: "https://bsc-dataseed.binance.org" },
              { chain: "Solana",   placeholder: "https://api.mainnet-beta.solana.com" },
            ].map((r) => (
              <Field key={r.chain} label={r.chain}>
                <input
                  placeholder={r.placeholder}
                  className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-ink-2 outline-none focus:border-cyan/30 placeholder:text-ink-4"
                />
              </Field>
            ))}
          </Group>

          {/* Security */}
          <Group title={t("settings.groupSecurity")} Icon={Shield}>
            <Toggle label={t("settings.confirmEverySwap")} description={t("settings.confirmEverySwapDesc")} value={true}  onChange={() => {}} tone="green" />
            <Toggle label={t("settings.blockUnverified")}  description={t("settings.blockUnverifiedDesc")}  value={false} onChange={() => {}} tone="red" />
            <Toggle label={t("settings.highRiskGate")}     description={t("settings.highRiskGateDesc")}     value={true}  onChange={() => {}} tone="gold" />
            <Toggle label={t("settings.encryptedCache")}   description={t("settings.encryptedCacheDesc")}   value={true}  onChange={() => {}} tone="cyan" />
          </Group>
        </div>

        {/* CEX connections — keys live encrypted in this browser only */}
        <div className="mt-5">
          <CexSettings />
        </div>

        <p className="font-mono text-[10px] text-ink-4 text-center mt-6">
          {t("settings.saveSettings")}
        </p>
      </div>
    </div>
  );
}

function Group({ title, Icon, children }: { title: string; Icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 glass-pane p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-cyan" />
        </div>
        <span className="font-display font-bold text-sm text-ink">{title}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function Toggle({ label, description, value, onChange, tone }: { label: string; description: string; value: boolean; onChange: (v: boolean) => void; tone: "green" | "cyan" | "gold" | "violet" | "red" }) {
  const cfg = {
    green:  "bg-green",  cyan:   "bg-cyan",   gold:   "bg-gold",
    violet: "bg-violet", red:    "bg-red",
  }[tone];
  return (
    <div className="flex items-start gap-3 py-1">
      <button
        onClick={() => onChange(!value)}
        className={cn(
          "relative w-9 h-5 rounded-full transition-colors flex-shrink-0",
          value ? cfg : "bg-white/10",
        )}
      >
        <span className={cn(
          "absolute top-0.5 w-4 h-4 rounded-full bg-ink shadow-card transition-transform",
          value ? "translate-x-4" : "translate-x-0.5",
        )} />
      </button>
      <div className="flex-1">
        <div className="font-display font-bold text-xs text-ink">{label}</div>
        <div className="font-sans text-[11px] text-ink-3 leading-relaxed">{description}</div>
      </div>
    </div>
  );
}

// avoid unused import warning
void EyeOff;
