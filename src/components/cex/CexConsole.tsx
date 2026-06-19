"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Lock, Unlock, Eye, EyeOff, KeyRound, ShieldAlert, Power,
  ArrowDownUp, ListOrdered, Wallet, Bot,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  hasKeystore, unlockKeystore, listExchanges,
} from "@/lib/cex/keystore";
import { CEX_META, SUPPORTED_CEX_IDS, type CexId, type CexCredentials } from "@/lib/cex/types";
import { useCexVault } from "@/lib/cex/vault";
import { useT } from "@/lib/i18n";
import CexTradePanel from "./CexTradePanel";
import WalletCexBridge from "./WalletCexBridge";
import CexOpenOrdersPanel from "./CexOpenOrdersPanel";
import ZionCexAutopilot from "./ZionCexAutopilot";
import { cn } from "@/lib/cn";

const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 minutes idle → re-lock

type ConsoleTab = "trade" | "orders" | "balance" | "zion";

const TABS: Array<{
  id:    ConsoleTab;
  label: string;
  Icon:  React.ComponentType<{ className?: string }>;
}> = [
  { id: "trade",   label: "Negociar", Icon: ArrowDownUp  },
  { id: "orders",  label: "Ordens",   Icon: ListOrdered  },
  { id: "balance", label: "Saldo",    Icon: Wallet       },
  { id: "zion",    label: "ZION",     Icon: Bot          },
];

/**
 * CEX Console — tabbed trading interface (Negociar / Ordens / Saldo / ZION).
 *
 * Real funds move here. The whole page is gated behind a vault unlock:
 *   1. User enters passphrase → keystore decrypts → credentials in memory
 *   2. Auto-lock after 10 minutes of no activity
 *   3. Explicit Lock button always visible in the top bar
 */
export default function CexConsole() {
  const searchParams = useSearchParams();
  const [prefill] = useState(() => ({
    symbol: searchParams?.get("symbol") || undefined,
    side:   (
      searchParams?.get("side") === "sell" ? "sell"
      : searchParams?.get("side") === "buy"  ? "buy"
      : undefined
    ) as ("buy" | "sell" | undefined),
  }));

  const t = useT();
  const [vaultExists, setVaultExists] = useState(false);
  const [connected,   setConnected]   = useState<CexId[]>([]);
  const [passphrase,  setPassphrase]  = useState("");
  const [showPwd,     setShowPwd]     = useState(false);
  const [unlocking,   setUnlocking]   = useState(false);
  const [creds,       setCreds]       = useState<Partial<Record<CexId, CexCredentials>> | null>(null);
  const [selectedId,  setSelectedId]  = useState<CexId | null>(null);
  const [activeTab,   setActiveTab]   = useState<ConsoleTab>("trade");

  const lastActivity = useRef<number>(Date.now());

  // Hydrate vault status (client-side localStorage)
  useEffect(() => {
    setVaultExists(hasKeystore());
    setConnected(listExchanges());
  }, []);

  // If the vault was already unlocked elsewhere (e.g. Portfolio page), skip
  // the password prompt and use the in-memory credentials directly.
  useEffect(() => {
    const active = useCexVault.getState().getActive();
    if (active && Object.keys(active).length > 0) {
      setCreds(active);
      useCexVault.getState().touch();
    }
  }, []);

  // Pick a default exchange once credentials land
  useEffect(() => {
    if (!creds) return;
    const ids = Object.keys(creds) as CexId[];
    if (ids.length > 0 && !selectedId) setSelectedId(ids[0]);
  }, [creds, selectedId]);

  // Auto-lock on idle
  useEffect(() => {
    if (!creds) return;
    const bump = () => { lastActivity.current = Date.now(); };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current > AUTO_LOCK_MS) {
        setCreds(null);
        useCexVault.getState().lock();
        setPassphrase("");
        setSelectedId(null);
        toast.info(t("cex.autoLocked"));
      }
    }, 30_000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      clearInterval(id);
    };
  }, [creds, t]);

  const onUnlock = async () => {
    setUnlocking(true);
    try {
      const decrypted = await unlockKeystore(passphrase);
      const ids = Object.keys(decrypted) as CexId[];
      if (ids.length === 0) {
        toast.error(t("cex.noVaultBody"));
        return;
      }
      setCreds(decrypted);
      useCexVault.getState().setUnlocked(decrypted);
      lastActivity.current = Date.now();
      toast.success(t("cex.vaultUnlockedToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlock failed.");
    } finally {
      setUnlocking(false);
    }
  };

  const onLock = () => {
    setCreds(null);
    useCexVault.getState().lock();
    setPassphrase("");
    setSelectedId(null);
    toast.success(t("cex.vaultLockedToast"));
  };

  // ─── No vault state ─────────────────────────────────────────────────
  if (!vaultExists) {
    return (
      <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
        <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-10 max-w-3xl mx-auto">
          <PageHeader />
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 rounded-2xl border border-gold/20 bg-gold/[0.04] p-6 text-center"
          >
            <KeyRound className="w-7 h-7 text-gold mx-auto mb-3" />
            <h2 className="font-display font-bold text-base text-ink mb-1">
              {t("cex.noVaultTitle")}
            </h2>
            <p className="font-sans text-sm text-ink-2 max-w-md mx-auto mb-4">
              {t("cex.noVaultBody")}
            </p>
            <Link href="/settings" className="btn btn-primary text-xs inline-flex items-center gap-1.5">
              <KeyRound className="w-3 h-3" />
              {t("cex.openSettings")}
            </Link>
          </motion.div>
        </div>
      </div>
    );
  }

  // ─── Locked state ───────────────────────────────────────────────────
  if (!creds) {
    return (
      <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
        <div className="absolute top-1/4 left-1/3 w-[420px] h-[420px] rounded-full bg-gold/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-10 max-w-3xl mx-auto">
          <PageHeader />
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 rounded-2xl border border-white/5 bg-bg-1/40 p-6 sm:p-8"
          >
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-4 h-4 text-gold" />
              <span className="font-mono text-[10px] text-gold tracking-widest uppercase">{t("cex.vaultLocked")}</span>
            </div>
            <h2 className="font-display font-bold text-lg text-ink mb-2">
              {t("cex.unlockTitle")}
            </h2>
            <p className="font-sans text-sm text-ink-2 max-w-xl mb-4">
              {t("cex.unlockBody")}
            </p>

            <div className="flex gap-2 max-w-md">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/8 focus-within:border-gold/30 min-w-0">
                <input
                  type={showPwd ? "text" : "password"}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void onUnlock(); }}
                  placeholder={t("cex.vaultPassphrasePlaceholder")}
                  autoFocus
                  autoComplete="current-password"
                  className="flex-1 min-w-0 bg-transparent outline-none text-sm font-mono text-ink placeholder:text-ink-4"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="text-ink-3 hover:text-ink-2"
                  aria-label={showPwd ? t("common.hide") : t("common.show")}
                >
                  {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="button"
                onClick={onUnlock}
                disabled={unlocking || passphrase.length < 8}
                className="btn btn-primary text-xs px-4 disabled:opacity-50"
              >
                {unlocking ? t("cex.unlockingShort") : t("common.unlock")}
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 sm:grid-cols-5 gap-2 max-w-2xl">
              {SUPPORTED_CEX_IDS.map((id) => {
                const meta    = CEX_META[id];
                const present = connected.includes(id);
                return (
                  <div
                    key={id}
                    className={cn(
                      "rounded-xl border p-2 text-center min-w-0",
                      present ? "border-cyan/20 bg-cyan/[0.04]" : "border-white/5 bg-bg-1/30 opacity-50",
                    )}
                  >
                    <div
                      className="w-6 h-6 rounded-md mx-auto mb-1 flex items-center justify-center font-display font-extrabold text-[11px]"
                      style={{ background: `${meta.color}1A`, color: meta.color, border: `1px solid ${meta.color}55` }}
                    >
                      {id.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="font-mono text-[9px] text-ink-3 tracking-wider uppercase truncate">
                      {meta.label.replace(" Advanced", "").replace(" (Huobi)", "")}
                    </div>
                    <div className="font-mono text-[9px] mt-0.5 truncate" style={{ color: present ? "#27D49B" : "var(--ink-4, #666)" }}>
                      {present ? t("cex.readyShort") : t("cex.statusOff")}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // ─── Unlocked: tabbed trading console ───────────────────────────────
  const availableIds = Object.keys(creds) as CexId[];
  const activeCreds  = selectedId ? creds[selectedId] ?? null : null;

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto">

        {/* ── Sticky top bar: exchange pills + lock ─────────────────── */}
        <div className="sticky top-0 z-20 bg-bg/90 backdrop-blur-md border-b border-white/5">
          <div className="px-4 sm:px-6 pt-3 pb-0">

            {/* Exchange row */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1 pb-2 min-w-0">
                {availableIds.map((id) => {
                  const meta  = CEX_META[id];
                  const isSel = selectedId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelectedId(id)}
                      className={cn(
                        "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-display font-bold text-xs tracking-wide transition-all whitespace-nowrap",
                        isSel
                          ? "border-cyan/40 bg-cyan/[0.10] text-cyan"
                          : "border-white/10 bg-bg-1/40 text-ink-2 hover:text-ink hover:border-white/20",
                      )}
                    >
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center font-display font-extrabold text-[9px] flex-shrink-0"
                        style={{ background: `${meta.color}22`, color: meta.color }}
                      >
                        {id.slice(0, 1).toUpperCase()}
                      </div>
                      {meta.label.replace(" Advanced", "").replace(" (Huobi)", "")}
                    </button>
                  );
                })}
              </div>

              {/* Lock */}
              <button
                type="button"
                onClick={onLock}
                className="flex-shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-full border border-red/30 bg-red/[0.04] text-red hover:bg-red/[0.08] font-mono text-[10px] tracking-widest uppercase transition-colors mb-2"
              >
                <Power className="w-3 h-3" />
                <span className="hidden sm:inline">{t("cex.lockVault")}</span>
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex">
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2.5 font-mono text-[10px] tracking-widest uppercase transition-all border-b-2 -mb-px",
                    activeTab === id
                      ? "border-cyan text-cyan"
                      : "border-transparent text-ink-3 hover:text-ink-2 hover:border-white/10",
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Tab content ───────────────────────────────────────────── */}
        <div className="px-4 sm:px-6 py-5">

          {/* Real-funds warning — compact strip in the Trade tab only */}
          {activeTab === "trade" && (
            <div className="mb-4 rounded-xl border border-red/20 bg-red/[0.04] px-3 py-2 flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-red flex-shrink-0" />
              <p className="font-mono text-[10px] text-ink-2 leading-relaxed">{t("cex.realFundsWarning")}</p>
            </div>
          )}

          {selectedId && activeCreds ? (
            <>
              {activeTab === "trade" && (
                <CexTradePanel
                  key={selectedId}
                  exchangeId={selectedId}
                  credentials={activeCreds}
                  initialSymbol={prefill.symbol}
                  initialSide={prefill.side}
                />
              )}
              {activeTab === "orders" && (
                <CexOpenOrdersPanel
                  key={`orders-${selectedId}`}
                  exchangeId={selectedId}
                  credentials={activeCreds}
                />
              )}
              {activeTab === "balance" && (
                <WalletCexBridge
                  key={`bridge-${selectedId}`}
                  exchangeId={selectedId}
                  credentials={activeCreds}
                />
              )}
              {activeTab === "zion" && (
                <ZionCexAutopilot
                  key={`zion-${selectedId}`}
                  exchangeId={selectedId}
                  credentials={activeCreds}
                />
              )}
            </>
          ) : (
            <div className="py-20 text-center">
              <p className="font-mono text-sm text-ink-3">Selecione uma exchange para começar</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page header (shown only in locked / no-vault states) ──────────────

function PageHeader() {
  const t = useT();
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center gap-2 mb-2">
        <Unlock className="w-4 h-4 text-cyan" />
        <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">
          {t("cex.consoleEyebrow")}
        </span>
      </div>
      <h1 className="font-display font-extrabold text-[clamp(1.6rem,4vw,2.4rem)] leading-[1.05] tracking-[-0.02em] text-ink">
        {t("cex.consoleTitle1")} <span className="text-grad-aurora">{t("cex.consoleTitleHL")}</span> {t("cex.consoleTitle2")}
      </h1>
      <p className="font-sans text-sm text-ink-2/95 leading-relaxed mt-2 max-w-2xl">
        {t("cex.consoleBody")}
      </p>
    </motion.div>
  );
}
