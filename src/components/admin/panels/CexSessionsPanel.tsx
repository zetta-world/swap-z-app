"use client";

import TerminalPanel from "../TerminalPanel";
import { useAdminStats } from "../useAdminStats";

export default function CexSessionsPanel() {
  const state = useAdminStats();

  return (
    <TerminalPanel
      id="cex-sessions"
      title="CEX SESSIONS"
      subtitle="active autopilot per exchange"
      icon="⊞"
      source="supabase/autopilot_sessions"
    >
      {state.status === "loading" && (
        <div className="adm-shimmer" style={{ height: 80 }} />
      )}
      {state.status === "error" && (
        <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{state.message}</div>
      )}
      {state.status === "ok" && (() => {
        const byEx = state.data.cex.byExchange;
        const keys = Object.keys(byEx).sort();
        if (keys.length === 0) {
          return (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>
              No autopilot sessions recorded yet.
            </div>
          );
        }
        return (
          <table className="adm-table">
            <thead>
              <tr>
                <th>EXCHANGE</th>
                <th>TOTAL</th>
                <th>ACTIVE</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((ex) => {
                const { total, active } = byEx[ex];
                return (
                  <tr key={ex}>
                    <td style={{ color: "var(--adm-cyan)", letterSpacing: "0.08em" }}>
                      {ex.toUpperCase()}
                    </td>
                    <td>{total}</td>
                    <td>
                      {active > 0
                        ? <span style={{ color: "var(--adm-green)" }}>{active}</span>
                        : <span style={{ color: "var(--adm-ink-3)" }}>0</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })()}
    </TerminalPanel>
  );
}
