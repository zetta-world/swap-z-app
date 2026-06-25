"use client";

import TerminalPanel from "../TerminalPanel";
import { useAdminStats } from "../useAdminStats";

const TIER_ORDER = ["free", "pro", "trader", "pilot"];
const TIER_COLOR: Record<string, string> = {
  free:   "var(--adm-ink-2)",
  pro:    "var(--adm-gold)",
  trader: "var(--adm-violet)",
  pilot:  "var(--adm-cyan)",
};

export default function TierDistPanel() {
  const state = useAdminStats();

  return (
    <TerminalPanel
      id="tier-dist"
      title="TIER MATRIX"
      subtitle="distribution across all plans"
      icon="⊕"
      source="supabase/tier_cache"
      secondsAgo={state.status === "ok" ? state.secondsAgo : undefined}
      refreshing={state.status === "ok" ? state.refreshing : undefined}
      onRefresh={state.status === "ok" || state.status === "error" ? state.refresh : undefined}
    >
      {state.status === "loading" && (
        <div className="adm-shimmer" style={{ height: 80 }} />
      )}
      {state.status === "error" && (
        <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{state.message}</div>
      )}
      {state.status === "ok" && (() => {
        const dist = state.data.tiers.distribution;
        const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
        return (
          <>
            {TIER_ORDER.map((tier) => {
              const count = dist[tier] ?? 0;
              const pct   = Math.round(count / total * 100);
              const color = TIER_COLOR[tier] ?? "var(--adm-ink)";
              return (
                <div key={tier} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color }}>
                      {tier}
                    </span>
                    <span style={{ fontSize: 10, color, fontVariantNumeric: "tabular-nums" }}>
                      {count.toLocaleString()} <span style={{ color: "var(--adm-ink-3)", fontSize: 8 }}>({pct}%)</span>
                    </span>
                  </div>
                  <div style={{ height: 3, background: "var(--adm-border)", borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: color,
                        borderRadius: 2,
                        transition: "width 600ms ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 8, color: "var(--adm-ink-3)", marginTop: 8 }}>
              Recent wallets only — tier_cache rows with unexpired entries.
            </div>
          </>
        );
      })()}
    </TerminalPanel>
  );
}
