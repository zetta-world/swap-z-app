"use client";

import TerminalPanel from "../TerminalPanel";
import { useAdminStats } from "../useAdminStats";
import StatMetrica from "../StatMetrica";
import AvisoDeFonte from "../AvisoDeFonte";

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
      secondsAgo={state.status === "ok" ? state.secondsAgo : undefined}
      refreshing={state.status === "ok" ? state.refreshing : undefined}
      onRefresh={state.status === "ok" || state.status === "error" ? state.refresh : undefined}
    >
      {state.status === "loading" && (
        <div className="adm-shimmer" style={{ height: 80 }} />
      )}
      {state.status === "error" && (
        <div style={{ color: "var(--adm-red)", fontSize: 13 }}>{state.message}</div>
      )}
      {state.status === "ok" && (() => {
        const ap = state.data.autopilot;
        const pnl = ap.pnlToday.value;
        const ativas = ap.sessionsActive.value;
        return (
          <>
            <AvisoDeFonte m={ap.sessions} rotulo="sessões" />
            <StatMetrica rotulo="TOTAL SESSIONS" m={ap.sessions} formatar={(v) => v.toLocaleString()} />
            <StatMetrica rotulo="ACTIVE NOW" m={ap.sessionsActive} formatar={(v) => v.toLocaleString()}
              cor={ativas != null && ativas > 0 ? "green" : ""}
              sub={ap.sessions.value != null ? `/ ${ap.sessions.value} total` : undefined} />
            <StatMetrica rotulo="TOTAL RUNS" m={ap.totalRuns} formatar={(v) => v.toLocaleString()} cor="cyan" />
            <StatMetrica rotulo="PNL TODAY" m={ap.pnlToday} formatar={(v) => `${v >= 0 ? "+" : ""}$${fmt(v)}`}
              cor={pnl != null && pnl < 0 ? "red" : "green"} />
            <StatMetrica rotulo="NOTIONAL VOLUME" m={ap.volumeTotal} formatar={(v) => `$${fmt(v, 0)}`} cor="amber" sub="all-time" />
          </>
        );
      })()}
    </TerminalPanel>
  );
}
