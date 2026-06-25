"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock, Unlock, KeyRound, CheckCircle2, AlertTriangle, Trash2, ExternalLink, Eye, EyeOff, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  hasKeystore, listExchanges, getFingerprint,
  unlockKeystore, saveCredentials, removeExchange, forgetEverything,
} from "@/lib/cex/keystore";
import {
  CEX_META, SUPPORTED_CEX_IDS, type CexId, type CexCredentials, type CexBalance,
} from "@/lib/cex/types";
import { useT, t as tImp } from "@/lib/i18n";
import { useConfirm } from "@/components/ui/ConfirmModal";
import { compactNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

type CexFormState = Record<CexId, {
  apiKey:     string;
  apiSecret:  string;
  passphrase: string;
}>;

const EMPTY_FORM: CexFormState = Object.fromEntries(
  SUPPORTED_CEX_IDS.map((id) => [id, { apiKey: "", apiSecret: "", passphrase: "" }]),
) as CexFormState;

const EMPTY_STATE: Record<CexId, CexState> = Object.fromEntries(
  SUPPORTED_CEX_IDS.map((id) => [id, { status: "idle" }]),
) as Record<CexId, CexState>;

interface CexState {
  status:   "idle" | "testing" | "connected" | "failed";
  totalUsd?: number;
  topAsset?: string;
  error?:    string;
  /** Sanitized upstream error message — surfaces actionable detail
   *  beneath the localized headline (e.g. the actual Binance error). */
  detail?:   string;
  fetchedAt?: number;
}

/**
 * Settings panel for managing CEX API connections. The threat model is laid
 * out in `src/lib/cex/keystore.ts` — TL;DR: keys live encrypted in this
 * browser's localStorage; the user provides the passphrase; Z-SWAP servers
 * never persist them.
 */
export default function CexSettings() {
  const t = useT();
  const { confirm, modal: confirmModal } = useConfirm();
  const [vaultExists,   setVaultExists]   = useState(false);
  const [unlocked,      setUnlocked]      = useState(false);
  const [passphrase,    setPassphrase]    = useState("");
  const [showPwd,       setShowPwd]       = useState(false);
  const [form,          setForm]          = useState<CexFormState>(EMPTY_FORM);
  const [presentList,   setPresentList]   = useState<CexId[]>([]);
  const [fingerprint,   setFingerprint]   = useState<string | undefined>();
  const [busy,          setBusy]          = useState(false);
  const [perExchange,   setPerExchange]   = useState<Record<CexId, CexState>>(EMPTY_STATE);

  // Hydrate vault presence from localStorage
  useEffect(() => {
    setVaultExists(hasKeystore());
    setPresentList(listExchanges());
    setFingerprint(getFingerprint());
  }, []);

  const onUnlock = async () => {
    setBusy(true);
    try {
      const creds = await unlockKeystore(passphrase);
      const nextForm = { ...EMPTY_FORM };
      for (const [id, c] of Object.entries(creds)) {
        if (c) nextForm[id as CexId] = {
          apiKey:     c.apiKey,
          apiSecret:  c.apiSecret,
          passphrase: c.passphrase ?? "",
        };
      }
      setForm(nextForm);
      setUnlocked(true);
      toast.success(t("cex.vaultUnlockedToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  const onSave = async (id: CexId) => {
    const cred = form[id];
    if (!cred.apiKey || !cred.apiSecret) {
      toast.error(t("cex.keysRequired"));
      return;
    }
    if (CEX_META[id].needsPassphrase && !cred.passphrase) {
      toast.error(t("cex.errPassReqGeneric", { label: CEX_META[id].label }));
      return;
    }
    if (!unlocked && passphrase.length < 8) {
      toast.error(t("cex.passphraseSetFirst"));
      return;
    }
    setBusy(true);
    try {
      const next: Partial<Record<CexId, CexCredentials>> = {
        [id]: {
          apiKey:    cred.apiKey,
          apiSecret: cred.apiSecret,
          passphrase: CEX_META[id].needsPassphrase ? cred.passphrase : undefined,
          readOnly:  true,
        },
      };
      await saveCredentials(passphrase, next);
      setVaultExists(true);
      setUnlocked(true);
      setPresentList(listExchanges());
      setFingerprint(getFingerprint());
      toast.success(t("cex.settingsSavedToast", { label: CEX_META[id].label }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async (id: CexId) => {
    const cred = form[id];
    if (!cred.apiKey || !cred.apiSecret) {
      toast.error(t("cex.fillKeysFirst"));
      return;
    }
    setPerExchange((s) => ({ ...s, [id]: { status: "testing" } }));
    try {
      const res = await fetch("/api/cex/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({
          exchange:   id,
          apiKey:     cred.apiKey,
          apiSecret:  cred.apiSecret,
          passphrase: CEX_META[id].needsPassphrase ? cred.passphrase : undefined,
          withUsd:    true,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        balances?: CexBalance[];
        totalUsd?: number;
        error?:    string;
        detail?:   string;
      };
      if (!res.ok || !body.ok) {
        setPerExchange((s) => ({
          ...s,
          [id]: {
            status: "failed",
            error:  body.error ?? `HTTP ${res.status}`,
            detail: body.detail,
            fetchedAt: Date.now(),
          },
        }));
        toast.error(`${CEX_META[id].label}: ${humanError(body.error ?? `HTTP ${res.status}`)}`);
        return;
      }
      const topAsset = (body.balances ?? [])[0]?.asset;
      setPerExchange((s) => ({
        ...s,
        [id]: {
          status:    "connected",
          totalUsd:  body.totalUsd,
          topAsset,
          fetchedAt: Date.now(),
        },
      }));
      toast.success(t("cex.settingsConnectedToast", { label: CEX_META[id].label }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPerExchange((s) => ({ ...s, [id]: { status: "failed", error: msg, fetchedAt: Date.now() } }));
      toast.error(`${CEX_META[id].label}: ${msg}`);
    }
  };

  const onDisconnect = async (id: CexId) => {
    if (!passphrase) {
      toast.error(t("cex.passphraseSetFirst"));
      return;
    }
    setBusy(true);
    try {
      await removeExchange(passphrase, id);
      setPresentList(listExchanges());
      setFingerprint(getFingerprint());
      setVaultExists(hasKeystore());
      setForm((f) => ({ ...f, [id]: { apiKey: "", apiSecret: "", passphrase: "" } }));
      setPerExchange((s) => ({ ...s, [id]: { status: "idle" } }));
      toast.success(t("cex.settingsDisconnectedToast", { label: CEX_META[id].label }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  };

  const onForgetAll = async () => {
    if (!await confirm(t("cex.forgetConfirm"))) return;
    forgetEverything();
    setVaultExists(false);
    setUnlocked(false);
    setPresentList([]);
    setFingerprint(undefined);
    setForm(EMPTY_FORM);
    setPassphrase("");
    setPerExchange(EMPTY_STATE);
    toast.success(t("cex.forgetToast"));
  };

  const showUnlockPrompt = vaultExists && !unlocked;
  const supportedIds: readonly CexId[] = SUPPORTED_CEX_IDS;

  return (
    <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 sm:p-6 space-y-4">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-gold" />
            <span className="section-label">{t("cex.settingsTitle")}</span>
          </div>
          <p className="font-sans text-xs text-ink-3 leading-relaxed max-w-xl">
            {t("cex.settingsBody")}
          </p>
        </div>
        {vaultExists && (
          <button
            type="button"
            onClick={onForgetAll}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-red/30 bg-red/[0.04] text-red hover:bg-red/[0.08] font-mono text-[10px] tracking-widest uppercase"
          >
            <Trash2 className="w-3 h-3" />
            {t("cex.forgetAll")}
          </button>
        )}
      </header>

      {/* Unlock prompt OR passphrase entry */}
      <div className="rounded-xl border border-white/5 bg-bg-1/30 p-3.5 space-y-2.5">
        <div className="flex items-center gap-2">
          {showUnlockPrompt
            ? <Lock     className="w-3.5 h-3.5 text-gold" />
            : <Unlock   className="w-3.5 h-3.5 text-green" />}
          <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
            {showUnlockPrompt ? t("cex.vaultLocked")
              : vaultExists ? t("cex.vaultUnlocked")
              : t("cex.setPassphrase")}
          </span>
          {fingerprint && (
            <span className="font-mono text-[9px] text-ink-4 truncate">
              · {fingerprint}
            </span>
          )}
        </div>
        <div className="flex gap-2 min-w-0">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/8 focus-within:border-gold/30 min-w-0">
            <input
              type={showPwd ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("cex.passphraseShortHint")}
              autoComplete="new-password"
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
          {showUnlockPrompt && (
            <button
              type="button"
              onClick={onUnlock}
              disabled={busy || passphrase.length < 8}
              className="btn btn-primary text-xs px-4 disabled:opacity-50"
            >
              {t("common.unlock")}
            </button>
          )}
        </div>
        <p className="font-mono text-[10px] text-ink-4 leading-relaxed">
          {t("cex.pbkdf2Hint")}
        </p>
      </div>

      {/* Exchanges */}
      <div className="space-y-3">
        {supportedIds.map((id) => (
          <ExchangeCard
            key={id}
            id={id}
            connected={presentList.includes(id)}
            state={perExchange[id]}
            form={form[id]}
            onChange={(patch) => setForm((f) => ({ ...f, [id]: { ...f[id], ...patch } }))}
            onSave={() => onSave(id)}
            onTest={() => onTest(id)}
            onDisconnect={() => onDisconnect(id)}
            disabled={showUnlockPrompt || busy}
            showPwd={showPwd}
          />
        ))}
      </div>

      {/* Foot note */}
      <div className="rounded-xl border border-cyan/15 bg-cyan/[0.04] p-3 flex items-start gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan mt-0.5 flex-shrink-0" />
        <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
          {t("cex.securityFooter")}
        </p>
      </div>
      {confirmModal}
    </section>
  );
}

// ─── Per-exchange card ─────────────────────────────────────────────────

function ExchangeCard({
  id, connected, state, form, onChange, onSave, onTest, onDisconnect, disabled, showPwd,
}: {
  id:         CexId;
  connected:  boolean;
  state:      CexState;
  form:       { apiKey: string; apiSecret: string; passphrase: string };
  onChange:   (p: Partial<{ apiKey: string; apiSecret: string; passphrase: string }>) => void;
  onSave:     () => void;
  onTest:     () => void;
  onDisconnect: () => void;
  disabled:   boolean;
  showPwd:    boolean;
}) {
  const meta = CEX_META[id];
  const t = useT();
  const [open, setOpen] = useState(false);

  const StatusIcon =
    state.status === "connected" ? CheckCircle2  :
    state.status === "failed"    ? AlertTriangle :
                                    Lock;
  const statusTone =
    state.status === "connected" ? "text-green"   :
    state.status === "failed"    ? "text-red"     :
    connected                    ? "text-cyan"    :
                                    "text-ink-3";

  return (
    <motion.div
      layout
      className={cn(
        "rounded-xl border bg-bg-1/30 overflow-hidden",
        connected ? "border-cyan/20" : "border-white/5",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors min-w-0"
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center font-display font-extrabold text-xs flex-shrink-0"
          style={{ background: `${meta.color}1A`, color: meta.color, border: `1px solid ${meta.color}55` }}
        >
          {id.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="font-display font-bold text-sm text-ink">{meta.label}</div>
          <div className="font-mono text-[10px] text-ink-3 truncate">
            {connected
              ? state.status === "connected" && state.totalUsd !== undefined
                ? t("cex.onBooks", { total: compactNumber(state.totalUsd) })
                : t("common.connected")
              : t("common.notConnected")}
          </div>
        </div>
        <span className={cn("inline-flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase", statusTone)}>
          <StatusIcon className={cn("w-3 h-3", state.status === "testing" && "animate-spin")} />
          {state.status === "testing"   ? t("cex.statusTesting")
            : state.status === "connected" ? t("cex.statusOnline")
            : state.status === "failed"    ? t("cex.statusFailedShort")
            : connected                     ? t("cex.statusSaved")
            :                                 t("cex.statusOff")}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{    opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-white/5"
          >
            <div className="p-4 space-y-3">
              <Field
                label={t("cex.apiKey")}
                value={form.apiKey}
                onChange={(v) => onChange({ apiKey: v })}
                placeholder={t("cex.keyPlaceholderApi", { label: meta.label })}
                disabled={disabled}
              />
              <Field
                label={t("cex.apiSecret")}
                value={form.apiSecret}
                onChange={(v) => onChange({ apiSecret: v })}
                placeholder={t("cex.keyPlaceholderSecret", { label: meta.label })}
                disabled={disabled}
                secret={!showPwd}
              />
              {meta.needsPassphrase && (
                <Field
                  label={t("cex.okxPassphraseLabel", { label: meta.label })}
                  value={form.passphrase}
                  onChange={(v) => onChange({ passphrase: v })}
                  placeholder={t("cex.keyPlaceholderPass", { label: meta.label })}
                  disabled={disabled}
                  secret={!showPwd}
                />
              )}

              {state.error && (
                <div className="rounded-md border border-red/20 bg-red/[0.04] px-2.5 py-2 font-mono text-[10px] text-red space-y-1">
                  <div>{humanError(state.error)}</div>
                  {state.detail && (
                    <div className="text-red/70 leading-relaxed break-words">
                      {state.detail}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={onTest}
                  disabled={disabled || !form.apiKey || !form.apiSecret}
                  className="btn btn-secondary text-xs px-3 disabled:opacity-50"
                >
                  {t("cex.testConnection")}
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={disabled || !form.apiKey || !form.apiSecret}
                  className="btn btn-primary text-xs px-3 disabled:opacity-50"
                >
                  {t("cex.saveEncrypted")}
                </button>
                {connected && (
                  <button
                    type="button"
                    onClick={onDisconnect}
                    className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-red/90 hover:text-red tracking-widest uppercase"
                  >
                    <Trash2 className="w-3 h-3" />
                    {t("common.disconnect")}
                  </button>
                )}
              </div>

              <a
                href={meta.keysDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan/80 hover:text-cyan tracking-widest uppercase"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                {t("cex.howToCreateKey")}
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Field({
  label, value, onChange, placeholder, disabled, secret = false,
}: {
  label:       string;
  value:       string;
  onChange:    (v: string) => void;
  placeholder: string;
  disabled:    boolean;
  secret?:     boolean;
}) {
  return (
    <label className="block min-w-0">
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">{label}</div>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/8 focus:border-cyan/30 outline-none text-sm font-mono text-ink placeholder:text-ink-4 disabled:opacity-50"
      />
    </label>
  );
}

function humanError(code: string): string {
  switch (code) {
    case "auth_failed":          return tImp("cex.errAuthFailed");
    case "timestamp_drift":      return tImp("cex.errTimestampDrift");
    case "ip_not_whitelisted":   return tImp("cex.errIpWhitelist");
    case "permission_denied":    return tImp("cex.errPermDenied");
    case "region_blocked":       return tImp("cex.errRegionBlocked");
    case "timeout":              return tImp("cex.errTimeout");
    case "rate_limited":         return tImp("cex.errRateLimit");
    case "upstream_failed":      return tImp("cex.errUpstreamFailed");
    default:
      if (code.startsWith("passphrase_required_for_")) {
        const ex = code.slice("passphrase_required_for_".length);
        return tImp("cex.errPassReqGeneric", { label: ex.toUpperCase() });
      }
      return code;
  }
}
