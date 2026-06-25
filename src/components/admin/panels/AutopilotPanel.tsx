"use client";

import TerminalPanel from "../TerminalPanel";
import { useAdminStats } from "../useAdminStats";

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function AutopilotPanel() {
  const state = useAdminStats();

  return (
    <TerminalPanel
      id="autopilot-activity"
      title="AUTOPILOT"
      subtitle="sessions · runs · pnl today"
      icon="⊛"
      source="supabase/autopilot_*"
    >
      {state.status === "loading" && (
        <div className="adm-shimmer" style={{ height: 80 }} />
      )}
      {state.status === "error" && (
        <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{state.message}</div>
      )}
      {state.status === "ok" && (() => {
        const ap = state.data.autopilot;
        const pnlColor = ap.pnlToday >= 0 ? "green" : "red";
        return (
          <>
            <div className="adm-stat">
              <span className="adm-stat-label">TOTAL SESSIONS</span>
              <span className="adm-stat-value">{ap.sessions.toLocaleString()}</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-label">ACTIVE NOW</span>
              <span className={`adm-stat-value ${ap.sessionsActive > 0 ? "green" : ""}`}>
                {ap.sessionsActive.toLocaleString()}
              </span>
              <span className="adm-stat-sub">
                / {ap.sessions} total
              </span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-label">TOTAL RUNS</span>
              <span className="adm-stat-value cyan">{ap.totalRuns.toLocaleString()}</span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-label">PNL TODAY</span>
              <span className={`adm-stat-value ${pnlColor}`}>
                {ap.pnlToday >= 0 ? "+" : ""}${fmt(ap.pnlToday)}
              </span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat-label">NOTIONAL VOLUME</span>
              <span className="adm-stat-value amber">${fmt(ap.volumeTotal, 0)}</span>
              <span className="adm-stat-sub">all-time</span>
            </div>
          </>
        );
      })()}
    </TerminalPanel>
  );
}
