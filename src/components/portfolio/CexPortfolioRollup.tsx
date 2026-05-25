"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Banknote, Lock, Unlock, Eye, EyeOff, RefreshCw, KeyRound, AlertCircle, Power,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  hasKeystore, listExchanges, unlockKeystore,
} from "@/lib/cex/keystore";
import {
  CEX_META, type CexId, type CexBalance, type CexCredentials,
} from "@/lib/cex/types";
import { compactNumber } from "@/lib/format";
import { useT, t as tImp } from "@/lib/i18n";
import { cn } from "@/lib/cn";

const AUTO_LOCK_MS = 10 * 60 * 1000;

interface ExchangeRollup {
  status:    "idle" | "loading" | "loaded" | "failed";
  totalUsd:  number;
  balances:  CexBalance[];
  error?:    string;
  fetchedAt?: number;
}

/**
 * Aggregates CEX balances from every connected exchange into a single
 * portfolio rollup card. Runs entirely client-side — the user unlocks the
 * vault once, the in-memory credentials drive parallel /api/cex/balance
 * calls, and the result aggregates into a total $ + per-exchange breakdown.
 *
 * Auto-locks after 10 minutes of no user activity. Visit /cex to trade.
 */
export default function CexPortfolioRollup() {
  const t = useT();
  const [vaultExists, setVaultExists] = useState(false);
  const [connected,   setConnected]   = useState<CexId[]>([]);
  const [passphrase,  setPassphrase]  = useState("");
  const [showPwd,     setShowPwd]     = useState(false);
  const [unlocking,   setUnlocking]   = useState(false);
  const [creds,       setCreds]       = useState<Partial<Record<CexId, CexCredentials>> | null>(null);
  const [rollups,     setRollups]     = useState<Record<CexId, ExchangeRollup>>({} as Record<CexId, ExchangeRollup>);
  const lastActivity = useRef<number>(Date.now());

  useEffect(() => {
    setVaultExists(hasKeystore());
    setConnected(listExchanges());
  }, []);

  // Auto-lock after idle
  useEffect(() => {
    if (!creds) return;
    const bump = () => { lastActivity.current = Date.now(); };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current > AUTO_LOCK_MS) {
        setCreds(null);
        setPassphrase("");
        setRollups({} as Record<CexId, ExchangeRollup>);
        toast.info(t("portfolio.autoLockedToast"));
      }
    }, 30_000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      clearInterval(id);
    };
  }, [creds, t]);

  const loadOne = useCallback(async (id: CexId, c: CexCredentials) => {
    setRollups((r) => ({ ...r, [id]: { ...(r[id] ?? { status: "idle", totalUsd: 0, balances: [] }), status: "loading" } }));
    try {
      const res = await fetch("/api/cex/balance", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exchange:   id,
          apiKey:     c.apiKey,
          apiSecret:  c.apiSecret,
          passphrase: c.passphrase,
          withUsd:    true,
        }),
      });
      const body = await res.json() as { ok: boolean; balances?: CexBalance[]; totalUsd?: number; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRollups((r) => ({
        ...r,
        [id]: {
          status:    "loaded",
          totalUsd:  body.totalUsd ?? 0,
          balances:  body.balances ?? [],
          fetchedAt: Date.now(),
        },
      }));
    } catch (e) {
      setRollups((r) => ({
        ...r,
        [id]: {
          status:   "failed",
          totalUsd: 0,
          balances: [],
          error:    e instanceof Error ? e.message : String(e),
          fetchedAt: Date.now(),
        },
      }));
    }
  }, []);

  const loadAll = useCallback(async () => {
    if (!creds) return;
    await Promise.all(
      (Object.entries(creds) as [CexId, CexCredentials][]).map(([id, c]) => loadOne(id, c)),
    );
  }, [creds, loadOne]);

  // After unlock, kick off the parallel load
  useEffect(() => {
    if (creds) void loadAll();
  }, [creds, loadAll]);

  const onUnlock = async () => {
    setUnlocking(true);
    try {
      const decrypted = await unlockKeystore(passphrase);
      if (Object.keys(decrypted).length === 0) {
        toast.error(t("portfolio.noVaultBody"));
        return;
      }
      setCreds(decrypted);
      lastActivity.current = Date.now();
      toast.success(t("portfolio.unlockToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setUnlocking(false);
    }
  };

  const onLock = () => {
    setCreds(null);
    setPassphrase("");
    setRollups({} as Record<CexId, ExchangeRollup>);
    toast.success(t("portfolio.lockToast"));
  };

  const totalCexUsd = useMemo(() => {
    let sum = 0;
    for (const r of Object.values(rollups)) sum += r.totalUsd ?? 0;
    return sum;
  }, [rollups]);

  // ─── No vault ──────────────────────────────────────────────────────
  if (!vaultExists) {
    return (
      <SectionShell>
        <Header />
        <div className="rounded-xl border border-gold/15 bg-gold/[0.04] p-4 flex items-start gap-2.5">
          <KeyRound className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-display font-bold text-sm text-ink">
              {t("portfolio.noVaultTitle")}
            </div>
            <p className="font-sans text-xs text-ink-2 leading-relaxed mt-1 max-w-xl">
              {t("portfolio.noVaultBody")}
            </p>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 mt-2 font-mono text-[10px] text-cyan hover:underline tracking-widest uppercase"
            >
              {t("portfolio.openSettings")}
            </Link>
          </div>
        </div>
      </SectionShell>
    );
  }

  // ─── Locked ────────────────────────────────────────────────────────
  if (!creds) {
    return (
      <SectionShell>
        <Header />
        <div className="rounded-xl border border-white/5 bg-bg-1/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="w-3.5 h-3.5 text-gold" />
            <span className="font-mono text-[10px] text-gold tracking-widest uppercase">{t("portfolio.vaultLocked")}</span>
            <span className="font-mono text-[10px] text-ink-3 ml-auto">
              {connected.length === 1
                ? t("portfolio.vaultExchangesSavedSingular")
                : t("portfolio.vaultExchangesSavedPlural", { n: connected.length })}
            </span>
          </div>
          <p className="font-sans text-xs text-ink-2 leading-relaxed mb-3">
            {t("portfolio.unlockBody")}
          </p>
          <div className="flex gap-2 max-w-md">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/8 focus-within:border-gold/30 min-w-0">
              <input
                type={showPwd ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void onUnlock(); }}
                placeholder={t("cex.vaultPassphrasePlaceholder")}
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
        </div>
      </SectionShell>
    );
  }

  // ─── Unlocked: render rollup ──────────────────────────────────────
  return (
    <SectionShell>
      <Header>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-cyan/20 bg-cyan/[0.04] text-cyan hover:bg-cyan/[0.08] font-mono text-[10px] tracking-widest uppercase"
        >
          <RefreshCw className="w-3 h-3" />
          {t("portfolio.refreshShort")}
        </button>
        <button
          type="button"
          onClick={onLock}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-red/30 bg-red/[0.04] text-red hover:bg-red/[0.08] font-mono text-[10px] tracking-widest uppercase"
        >
          <Power className="w-3 h-3" />
          {t("portfolio.lockShort")}
        </button>
      </Header>

      {/* Total */}
      <div className="rounded-xl border border-cyan/20 bg-cyan/[0.04] p-3 flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-mono text-[10px] text-cyan tracking-widest uppercase">
          {t("portfolio.totalAcross", {
            n: Object.keys(creds).length,
            label: Object.keys(creds).length === 1 ? t("portfolio.exchange") : t("portfolio.exchanges"),
          })}
        </div>
        <div className="font-display font-extrabold text-xl text-ink tabular-nums">
          ${compactNumber(totalCexUsd)}
        </div>
      </div>

      {/* Per-exchange grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {(Object.entries(creds) as [CexId, CexCredentials][]).map(([id]) => {
          const meta = CEX_META[id];
          const r    = rollups[id] ?? { status: "idle" as const, totalUsd: 0, balances: [] };
          const topAssets = r.balances?.slice(0, 3) ?? [];

          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "rounded-xl border bg-bg-1/40 p-3 min-w-0",
                r.status === "loaded" ? "border-cyan/20" : "border-white/5",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center font-display font-extrabold text-[11px] flex-shrink-0"
                  style={{ background: `${meta.color}1A`, color: meta.color, border: `1px solid ${meta.color}55` }}
                >
                  {id.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-xs text-ink truncate">
                    {meta.label.replace(" (Huobi)", "").replace(" Advanced", "")}
                  </div>
                  <div className="font-mono text-[10px] text-ink-3 truncate">
                    {r.status === "loading"  && t("common.loading")}
                    {r.status === "loaded"   && (r.balances.length === 1
                      ? t("portfolio.assetsCountSingular")
                      : t("portfolio.assetsCountPlural", { n: r.balances.length }))}
                    {r.status === "failed"   && t("common.failed")}
                    {r.status === "idle"     && "—"}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-display font-bold text-sm text-ink tabular-nums">
                    {r.status === "loaded" ? `$${compactNumber(r.totalUsd)}` : "—"}
                  </div>
                </div>
              </div>

              {topAssets.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/5 flex flex-wrap gap-1">
                  {topAssets.map((b) => (
                    <span
                      key={b.asset}
                      className="font-mono text-[9px] text-ink-2 px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/5"
                    >
                      {b.asset} {compactNumber(b.total)}
                    </span>
                  ))}
                  {r.balances.length > topAssets.length && (
                    <span className="font-mono text-[9px] text-ink-3 tracking-wider">
                      {t("portfolio.moreAssets", { n: r.balances.length - topAssets.length })}
                    </span>
                  )}
                </div>
              )}

              {r.status === "failed" && r.error && (
                <div className="mt-2 pt-2 border-t border-white/5 font-mono text-[10px] text-red truncate">
                  {humanError(r.error)}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="mt-3 rounded-xl border border-white/5 bg-bg-1/30 p-2.5 flex items-start gap-2">
        <AlertCircle className="w-3 h-3 text-ink-3 flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          {t("portfolio.rollupFooter")}
        </p>
      </div>
    </SectionShell>
  );
}

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/5 glass-pane p-5 min-w-0">
      {children}
    </section>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Banknote className="w-4 h-4 text-cyan" />
          <span className="section-label">{t("portfolio.cexHeading")}</span>
        </div>
        <p className="font-sans text-xs text-ink-3 leading-relaxed max-w-2xl">
          {t("portfolio.cexBody")}
        </p>
      </div>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function humanError(code: string): string {
  switch (code) {
    case "auth_failed":          return tImp("cex.errAuthFailed");
    case "ip_not_whitelisted":   return tImp("cex.errIpWhitelist");
    case "permission_denied":    return tImp("cex.errPermDenied");
    case "timeout":              return tImp("cex.errTimeout");
    case "rate_limited":         return tImp("cex.errRateLimit");
    case "upstream_failed":      return tImp("cex.errUpstreamFailed");
    default:                     return code;
  }
}
