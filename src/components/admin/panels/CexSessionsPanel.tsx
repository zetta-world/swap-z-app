"use client";

import TerminalPanel from "../TerminalPanel";
import { useAdminStats } from "../useAdminStats";
import AvisoDeFonte from "../AvisoDeFonte";

export default function CexSessionsPanel() {
  const state = useAdminStats();

  return (
    <TerminalPanel
      id="cex-sessions"
      title="CEX SESSIONS"
      subtitle="active autopilot per exchange"
      icon="⊞"
      source="supabase/autopilot_sessions"
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
        const m = state.data.cex.byExchange;
        // ⚠️ Leitura que falhou NÃO é "nenhuma sessão": esconderia uma sessão ATIVA (P1-16).
        if (m.value == null) return <AvisoDeFonte m={m} rotulo="sessões" />;
        const byEx = m.value;
        const keys = Object.keys(byEx).sort();
        if (keys.length === 0) {
          return (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 13 }}>
              No autopilot sessions recorded yet.
            </div>
          );
        }
        return (
          <>
          {m.state !== "ok" && <AvisoDeFonte m={m} rotulo="sessões" />}
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
          </>
        );
      })()}
    </TerminalPanel>
  );
}
