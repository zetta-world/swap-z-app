"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminConfirm } from "../useAdminConfirm";

type TierResult = {
  wallet:     string;
  tierCache:  { tier: string; source: string; checked_at: string; expires_at: string } | null;
  user:       { wallet_chain: string; created_at: string; last_seen_at: string } | null;
};

type Tier = "free" | "pro" | "trader" | "pilot";
const TIERS: Tier[] = ["free", "pro", "trader", "pilot"];
const TIER_COLOR: Record<Tier, string> = {
  free:   "var(--adm-ink-2)",
  pro:    "var(--adm-gold)",
  trader: "var(--adm-violet)",
  pilot:  "var(--adm-cyan)",
};

export default function TierControlPanel() {
  const [query,    setQuery]    = useState("");
  const [result,   setResult]   = useState<TierResult | null>(null);
  const [err,      setErr]      = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [mutating, setMutating] = useState(false);
  const [msg,      setMsg]      = useState<string | null>(null);
  const { confirm, modal: confirmModal } = useAdminConfirm();

  async function lookup() {
    if (!query.trim()) return;
    setLoading(true); setErr(null); setResult(null); setMsg(null);
    try {
      const res = await fetch(`/admin/api/tier?wallet=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setResult(json);
    } catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  }

  async function mutate(action: "grant" | "revoke", tier: Tier) {
    if (!result) return;
    const verb = action === "grant" ? "GRANT" : "REVOKE";
    const ok = await confirm(
      `${verb} tier "${tier.toUpperCase()}" for ${result.wallet}? This writes to tier_cache and is recorded in the audit log.`,
      action === "revoke",
    );
    if (!ok) return;
    setMutating(true); setMsg(null); setErr(null);
    try {
      const res = await fetch("/admin/api/tier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: result.wallet, tier, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setMsg(`${action === "grant" ? "✓ Granted" : "✓ Revoked"} ${tier} for ${result.wallet.slice(0, 8)}…`);
      // Re-lookup to refresh
      await lookup();
    } catch (e) { setErr(String(e)); }
    finally { setMutating(false); }
  }

  return (
    <TerminalPanel
      id="tier-control"
      title="TIER CONTROL"
      subtitle="grant · revoke · inspect"
      icon="⊗"
      source="supabase/tier_cache"
    >
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input
          className="adm-input"
          placeholder="wallet address…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
          spellCheck={false}
        />
        <button
          className="adm-toggle"
          onClick={lookup}
          disabled={loading}
          style={{ flexShrink: 0, minWidth: 60 }}
        >
          {loading ? "…" : "LOOK UP"}
        </button>
      </div>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ color: "var(--adm-green)", fontSize: 10, marginBottom: 8 }}>{msg}</div>}

      {result && (
        <>
          <div className="adm-stat">
            <span className="adm-stat-label">WALLET</span>
            <span style={{ fontSize: 9, color: "var(--adm-cyan)", fontFamily: "monospace", wordBreak: "break-all" }}>
              {result.wallet}
            </span>
          </div>
          {result.user && (
            <>
              <div className="adm-stat">
                <span className="adm-stat-label">CHAIN</span>
                <span className="adm-stat-value" style={{ fontSize: 11 }}>{result.user.wallet_chain.toUpperCase()}</span>
              </div>
              <div className="adm-stat">
                <span className="adm-stat-label">LAST SEEN</span>
                <span style={{ fontSize: 9, color: "var(--adm-ink-2)" }}>
                  {new Date(result.user.last_seen_at).toLocaleString()}
                </span>
              </div>
            </>
          )}
          <div className="adm-stat">
            <span className="adm-stat-label">CURRENT TIER</span>
            <span
              className="adm-stat-value"
              style={{ color: TIER_COLOR[(result.tierCache?.tier ?? "free") as Tier] ?? "var(--adm-ink)" }}
            >
              {(result.tierCache?.tier ?? "free").toUpperCase()}
            </span>
            {result.tierCache && (
              <span className="adm-stat-sub">{result.tierCache.source}</span>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.2em", marginBottom: 6 }}>
              GRANT TIER
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {TIERS.filter((t) => t !== "free").map((tier) => (
                <button
                  key={tier}
                  className="adm-toggle"
                  onClick={() => mutate("grant", tier)}
                  disabled={mutating}
                  style={{
                    color: TIER_COLOR[tier],
                    borderColor: `color-mix(in srgb, ${TIER_COLOR[tier]} 30%, transparent)`,
                  }}
                >
                  {tier.toUpperCase()}
                </button>
              ))}
              <button
                className="adm-toggle danger"
                onClick={() => mutate("revoke", result.tierCache?.tier as Tier ?? "free")}
                disabled={mutating || !result.tierCache}
              >
                REVOKE
              </button>
            </div>
          </div>
        </>
      )}
      {confirmModal}
    </TerminalPanel>
  );
}
