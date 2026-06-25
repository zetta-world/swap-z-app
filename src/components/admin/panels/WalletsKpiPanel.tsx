"use client";

import TerminalPanel from "../TerminalPanel";
import { useAdminStats } from "../useAdminStats";

export default function WalletsKpiPanel() {
  const state = useAdminStats();

  const ts = state.status === "ok"
    ? new Date(state.data.fetchedAt).toLocaleTimeString()
    : undefined;

  return (
    <TerminalPanel
      id="wallets-kpi"
      title="WALLETS"
      subtitle="signups · active · chain split"
      icon="◈"
      source="supabase/users"
      fresh={ts}
    >
      {state.status === "loading" && (
        <>
          <div className="adm-shimmer" style={{ height: 14, width: "60%", marginBottom: 10 }} />
          <div className="adm-shimmer" style={{ height: 14, width: "45%", marginBottom: 10 }} />
          <div className="adm-shimmer" style={{ height: 14, width: "50%" }} />
        </>
      )}
      {state.status === "error" && (
        <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{state.message}</div>
      )}
      {state.status === "ok" && (() => {
        const { total, active7d, active30d, chainSplit } = state.data.wallets;
        const evm  = chainSplit["evm"]    ?? 0;
        const sol  = chainSplit["solana"] ?? 0;
        return (
          <>
            <div className="adm-stat">
              <span className="adm-stat-label">TOTAL SIGNUPS</span>
              <span className="adm-stat-value">{total.toLocaleString()}</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-label">ACTIVE 7D</span>
              <span className="adm-stat-value green">{active7d.toLocaleString()}</span>
              <span className="adm-stat-sub">{total > 0 ? `${Math.round(active7d / total * 100)}%` : "—"}</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-label">ACTIVE 30D</span>
              <span className="adm-stat-value green">{active30d.toLocaleString()}</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-label">EVM / SOLANA</span>
              <span className="adm-stat-value cyan">{evm.toLocaleString()}</span>
              <span className="adm-stat-sub">/ {sol.toLocaleString()}</span>
            </div>
          </>
        );
      })()}
    </TerminalPanel>
  );
}
