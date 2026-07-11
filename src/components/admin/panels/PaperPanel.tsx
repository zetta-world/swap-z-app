"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

/**
 * PAPER — the Gate.io simulation tournament at the PORTFOLIO level. Each agent
 * gets a virtual $1000 wallet that executes only ITS signals at the live Gate.io
 * price; the leaderboard answers "would this agent have MADE money?", not just
 * "was the signal right?".
 */

type Row = {
  source: string; label: string;
  startingUsd: number; cashUsd: number; equity: number;
  realizedPnl: number; unrealizedPnl: number; returnPct: number;
  wins: number; losses: number; winRate: number | null; openPositions: number;
};
type PR = { rows: Row[]; totals: { startingUsd: number; equity: number; openPositions: number }; fetchedAt: string };

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function PaperPanel() {
  const [data, setData] = useState<PR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/paper");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 60_000 : 90_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  const totalRet = data && data.totals.startingUsd > 0
    ? (data.totals.equity / data.totals.startingUsd - 1) * 100 : 0;

  return (
    <TerminalPanel id="paper" title="PAPER · GATE.IO" subtitle="torneio ao nível de portfólio · $1000/agente" icon="📈" source="supabase/paper_accounts">
      {loading && <div className="adm-shimmer" style={{ height: 140 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[
              { label: "PATRIMÔNIO", v: usd(data.totals.equity), sub: pct(totalRet), pos: totalRet >= 0 },
              { label: "CAPITAL 0", v: usd(data.totals.startingUsd) },
              { label: "POSIÇÕES", v: String(data.totals.openPositions) },
            ].map((tile) => (
              <div key={tile.label} style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "6px 8px" }}>
                <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{tile.label}</div>
                <div style={{ fontSize: 15, color: "var(--adm-cyan)", fontVariantNumeric: "tabular-nums" }}>{tile.v}</div>
                {tile.sub && <div style={{ fontSize: 9, color: tile.pos ? "var(--adm-green)" : "var(--adm-red)" }}>{tile.sub}</div>}
              </div>
            ))}
          </div>

          <table className="adm-table">
            <thead>
              <tr><th>AGENTE</th><th>PATRIMÔNIO</th><th>RETORNO</th><th>REAL.</th><th>N-REAL.</th><th>WIN</th><th>ABERTAS</th></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const flat = r.equity === r.startingUsd && r.openPositions === 0;
                return (
                  <tr key={r.source}>
                    <td style={{ color: "var(--adm-ink)" }}>{r.label}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{usd(r.equity)}</td>
                    <td style={{ color: flat ? "var(--adm-ink-4)" : r.returnPct >= 0 ? "var(--adm-green)" : "var(--adm-red)" }}>
                      {flat ? "—" : pct(r.returnPct)}
                    </td>
                    <td style={{ color: r.realizedPnl >= 0 ? "var(--adm-green)" : "var(--adm-red)" }}>{r.realizedPnl === 0 ? "—" : pct(r.realizedPnl / r.startingUsd * 100)}</td>
                    <td style={{ color: "var(--adm-ink-3)" }}>{r.unrealizedPnl === 0 ? "—" : usd(r.unrealizedPnl)}</td>
                    <td>{r.winRate == null ? "—" : `${r.winRate.toFixed(0)}% (${r.wins}/${r.wins + r.losses})`}</td>
                    <td style={{ color: "var(--adm-cyan)" }}>{r.openPositions}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 6 }}>
            Fills no preço vivo da Gate.io · P&L líquido de custo round-trip · agentes sem sinais (Kimi/Ferrari) ficam achatados até produzirem.
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
