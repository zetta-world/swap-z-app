"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CloudCog, Shield, AlertTriangle, Loader2, Power, PowerOff,
  CheckCircle2, Clock, ChevronDown, ChevronUp, LogIn,
} from "lucide-react";
import { toast } from "sonner";
import { useWalletAuth } from "@/lib/auth/client";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface SessionStatus {
  is_active:        boolean;
  market_type:      string;
  risk_mode:        string;
  max_trade_usd:    number;
  max_trades_per_day: number;
  expires_at:       string;
  trades_today:     number;
  last_scan_at:     string | null;
  last_error:       string | null;
  frozen_until_day: string | null;
}

interface RunRow {
  id:           string;
  ran_at:       string;
  symbol:       string | null;
  side:         string | null;
  status:       string;
  reason:       string | null;
  notional_usd: number | null;
}

interface Props {
  exchangeId:       CexId;
  credentials:      CexCredentials;
  riskMode:         "conservador" | "moderado" | "agressivo";
  marketType:       "spot" | "futures" | "margin";
  maxTradeUsd:      number;
  dailyLossStopUsd: number;
  maxTradesPerDay:  number;
  allowedSymbols:   string[];
  lang:             string;
}

type Backend = "loading" | "unconfigured" | "auth_required" | "ready";

export default function BackgroundAutopilotPanel({
  exchangeId, credentials, riskMode, marketType,
  maxTradeUsd, dailyLossStopUsd, maxTradesPerDay, allowedSymbols, lang,
}: Props) {
  const t = useT();
  const { signIn, pending: authPending } = useWalletAuth();

  const [backend,  setBackend]  = useState<Backend>("loading");
  const [status,   setStatus]   = useState<SessionStatus | null>(null);
  const [runs,     setRuns]     = useState<RunRow[]>([]);
  const [busy,     setBusy]     = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/autopilot/session?exchangeId=${exchangeId}`);
      if (res.status === 401) { setBackend("auth_required"); setStatus(null); return; }
      if (res.status === 503) { setBackend("unconfigured");  setStatus(null); return; }
      const body = await res.json() as { ok: boolean; status: SessionStatus | null; runs?: RunRow[] };
      setBackend("ready");
      setStatus(body.status);
      setRuns(body.runs ?? []);
    } catch {
      setBackend("unconfigured");
    }
  }, [exchangeId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const arm = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/autopilot/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchangeId, riskMode, marketType,
          maxTradeUsd, dailyLossStopUsd, maxTradesPerDay,
          allowedSymbols, lang, ttlHours: 24,
          apiKey:     credentials.apiKey,
          apiSecret:  credentials.apiSecret,
          passphrase: credentials.passphrase,
        }),
      });
      const body = await res.json() as { ok: boolean; error?: string; autoFires?: boolean };
      if (res.status === 401) { setBackend("auth_required"); return; }
      if (!res.ok || !body.ok) { toast.error(t("bgAutopilot.activateFail", { error: body.error ?? res.status })); return; }
      toast.success(
        body.autoFires
          ? t("bgAutopilot.activatedSpot")
          : t("bgAutopilot.activatedAnalysis", { marketType }),
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("bgAutopilot.networkFail"));
    } finally {
      setBusy(false);
    }
  }, [exchangeId, riskMode, marketType, maxTradeUsd, dailyLossStopUsd, maxTradesPerDay, allowedSymbols, lang, credentials, refresh, t]);

  const disarm = useCallback(async () => {
    if (!confirm(t("bgAutopilot.disarmConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/autopilot/session?exchangeId=${exchangeId}`, { method: "DELETE" });
      if (res.ok) { toast.success(t("bgAutopilot.deactivated")); await refresh(); }
      else toast.error(t("bgAutopilot.deactivateFail"));
    } finally {
      setBusy(false);
    }
  }, [exchangeId, refresh, t]);

  // ── Backend states that block everything else ──
  if (backend === "loading") {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 text-ink-4 animate-spin" />
        <span className="font-mono text-[10px] text-ink-4">{t("bgAutopilot.checking")}</span>
      </div>
    );
  }
  if (backend === "unconfigured") {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2 mb-1">
          <CloudCog className="w-3.5 h-3.5 text-ink-4" />
          <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("bgAutopilot.title")}</span>
        </div>
        <p className="font-mono text-[10px] text-ink-4 leading-relaxed">
          {t("bgAutopilot.unavailable")}
        </p>
      </div>
    );
  }

  const isArmed = !!status?.is_active;

  return (
    <div className={cn(
      "rounded-xl border p-3 space-y-2.5",
      isArmed ? "border-green/30 bg-green/[0.04]" : "border-purple-500/20 bg-purple-500/[0.03]",
    )}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          <CloudCog className={cn("w-3.5 h-3.5", isArmed ? "text-green" : "text-purple-400")} />
          <span className="font-mono text-[10px] tracking-widest uppercase font-bold text-ink-2">
            {t("bgAutopilot.title")}
          </span>
          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300 tracking-widest uppercase">
            {t("bgAutopilot.beta")}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isArmed
            ? <span className="font-mono text-[9px] text-green tracking-widest uppercase inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {t("bgAutopilot.active")}</span>
            : <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">{t("bgAutopilot.inactive")}</span>}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-ink-4" /> : <ChevronDown className="w-3.5 h-3.5 text-ink-4" />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-2.5"
          >
            {/* Armed status */}
            {isArmed && status && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label={t("bgAutopilot.tradesToday")} value={`${status.trades_today}/${status.max_trades_per_day}`} />
                  <Stat label={t("bgAutopilot.perTrade")} value={`$${status.max_trade_usd}`} />
                  <Stat label={t("bgAutopilot.market")} value={status.market_type} />
                </div>
                <div className="font-mono text-[9px] text-ink-4 space-y-0.5">
                  <div className="inline-flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {t("bgAutopilot.expires", { time: new Date(status.expires_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })}
                  </div>
                  {status.last_scan_at && (
                    <div>{t("bgAutopilot.lastScan", { time: new Date(status.last_scan_at).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit" }) })}</div>
                  )}
                  {status.frozen_until_day && (
                    <div className="text-red">{t("bgAutopilot.frozen")}</div>
                  )}
                  {status.last_error && (
                    <div className="text-gold break-words">{t("bgAutopilot.warning", { error: status.last_error })}</div>
                  )}
                  {status.market_type !== "spot" && (
                    <div className="text-gold">
                      {t("bgAutopilot.analysisOnly", { marketType: status.market_type })}
                    </div>
                  )}
                </div>

                {runs.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowRuns((v) => !v)}
                      className="font-mono text-[9px] text-ink-3 hover:text-ink-2 tracking-widest uppercase inline-flex items-center gap-1"
                    >
                      {showRuns ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                      {t("bgAutopilot.recentActivity", { n: runs.length })}
                    </button>
                    {showRuns && (
                      <div className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                        {runs.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 font-mono text-[9px] text-ink-3 tabular-nums">
                            <span className="text-ink-4">{new Date(r.ran_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                            <RunBadge status={r.status} />
                            <span className="truncate">
                              {r.symbol ? `${(r.side ?? "").toUpperCase()} ${r.symbol}` : (r.reason ?? r.status)}
                              {r.notional_usd ? ` · $${r.notional_usd.toFixed(2)}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={disarm}
                  disabled={busy}
                  className="w-full py-2 rounded-lg border border-red/30 bg-red/[0.06] text-red hover:bg-red/[0.12] font-display font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
                  {t("bgAutopilot.deactivateBtn")}
                </button>
              </div>
            )}

            {/* Not armed — consent + activate */}
            {!isArmed && (
              <div className="space-y-2.5">
                <p
                  className="font-mono text-[10px] text-ink-3 leading-relaxed [&_b]:text-ink-2"
                  dangerouslySetInnerHTML={{ __html: t("bgAutopilot.keepsRunning") }}
                />

                {/* Security consent */}
                <div className="rounded-md border border-gold/30 bg-gold/[0.05] p-2 space-y-1.5">
                  <div className="font-mono text-[9px] text-gold tracking-widest uppercase inline-flex items-center gap-1">
                    <Shield className="w-3 h-3" /> {t("bgAutopilot.securityHeading")}
                  </div>
                  <ul className="font-mono text-[9px] text-ink-3 leading-relaxed space-y-1 list-disc pl-3.5 [&_b]:text-ink-2">
                    <li dangerouslySetInnerHTML={{ __html: t("bgAutopilot.securityBullet1") }} />
                    <li dangerouslySetInnerHTML={{ __html: t("bgAutopilot.securityBullet2") }} />
                    <li dangerouslySetInnerHTML={{ __html: t("bgAutopilot.securityBullet3") }} />
                    <li>{t("bgAutopilot.securityBullet4")}</li>
                  </ul>
                </div>

                {backend === "auth_required" ? (
                  <button
                    type="button"
                    onClick={() => void signIn()}
                    disabled={authPending}
                    className="w-full py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-500 font-display font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {authPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                    {t("bgAutopilot.signInToActivate")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={arm}
                    disabled={busy || allowedSymbols.length === 0}
                    className="w-full py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-500 font-display font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                    {t("bgAutopilot.activate24h")}
                  </button>
                )}

                {marketType !== "spot" && (
                  <p className="font-mono text-[9px] text-gold leading-relaxed inline-flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    {t("bgAutopilot.marketTypeNote", { marketType })}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-bg-1/30 py-1.5">
      <div className="font-mono text-[8px] text-ink-4 tracking-widest uppercase">{label}</div>
      <div className="font-display font-bold text-xs text-ink mt-0.5">{value}</div>
    </div>
  );
}

function RunBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    fired:      "text-green border-green/30",
    rejected:   "text-gold border-gold/30",
    errored:    "text-red border-red/30",
    skipped:    "text-ink-4 border-white/10",
    scan_empty: "text-ink-4 border-white/10",
    scan_error: "text-red border-red/30",
  };
  return (
    <span className={cn("px-1 py-0.5 rounded border tracking-widest uppercase text-[8px] flex-shrink-0", map[status] ?? "text-ink-4 border-white/10")}>
      {status}
    </span>
  );
}
