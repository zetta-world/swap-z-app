"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Recent = {
  symbol: string; side: string; status: string;
  outcome_pct: number | null; probability: number | null;
  regime: string | null; created_at: string;
};
type BT = {
  total: number; open: number; resolved: number; wins: number; losses: number; neutral: number;
  winRate: number | null; avgOutcome: number | null;
  byRegime: Record<string, { wins: number; losses: number }>;
  recent: Recent[];
};

function statusColor(s: string): string {
  if (s === "win" || s === "hit_target") return "var(--adm-green)";
  if (s === "loss" || s === "hit_stop")  return "var(--adm-red)";
  if (s === "open")                       return "var(--adm-ink-3)";
  return "var(--adm-gold)"; // neutral / expired
}

export default function BacktestPanel() {
  const [data, setData] = useState<BT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"stats" | "feed">("stats");
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/backtest");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 180_000 : 120_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  return (
    <TerminalPanel id="backtest" title="BACKTEST" subtitle="ZION win-rate · expectancy" icon="◇" source="supabase/zion_suggestions">
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["stats", "feed"] as const).map((t) => (
          <button key={t} className={`adm-toggle ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && tab === "stats" && (
        <div>
          {/* Headline */}
          <div className="adm-stat" style={{ padding: "6px 0" }}>
            <span style={{ fontSize: 9, color: "var(--adm-ink-3)", flex: 1 }}>WIN RATE</span>
            <span style={{ fontSize: 18, color: data.winRate == null ? "var(--adm-ink-3)" : data.winRate >= 0.5 ? "var(--adm-green)" : "var(--adm-gold)", fontVariantNumeric: "tabular-nums" }}>
              {data.winRate == null ? "—" : `${(data.winRate * 100).toFixed(1)}%`}
            </span>
          </div>
          <div className="adm-stat" style={{ padding: "4px 0" }}>
            <span style={{ fontSize: 9, color: "var(--adm-ink-3)", flex: 1 }}>AVG OUTCOME (resolved)</span>
            <span style={{ fontSize: 12, color: (data.avgOutcome ?? 0) >= 0 ? "var(--adm-green)" : "var(--adm-red)", fontVariantNumeric: "tabular-nums" }}>
              {data.avgOutcome == null ? "—" : `${data.avgOutcome >= 0 ? "+" : ""}${data.avgOutcome.toFixed(2)}%`}
            </span>
          </div>
          <table className="adm-table" style={{ marginTop: 8 }}>
            <tbody>
              <tr><td style={{ color: "var(--adm-green)" }}>wins</td><td>{data.wins}</td>
                  <td style={{ color: "var(--adm-red)" }}>losses</td><td>{data.losses}</td></tr>
              <tr><td style={{ color: "var(--adm-gold)" }}>neutral</td><td>{data.neutral}</td>
                  <td style={{ color: "var(--adm-ink-3)" }}>open</td><td>{data.open}</td></tr>
            </tbody>
          </table>

          {Object.keys(data.byRegime).length > 0 && (
            <table className="adm-table" style={{ marginTop: 10 }}>
              <thead><tr><th>REGIME</th><th>WINS</th><th>LOSSES</th><th>RATE</th></tr></thead>
              <tbody>
                {Object.entries(data.byRegime).map(([rg, v]) => {
                  const dec = v.wins + v.losses;
                  return (
                    <tr key={rg}>
                      <td style={{ color: "var(--adm-cyan)" }}>{rg}</td>
                      <td>{v.wins}</td><td>{v.losses}</td>
                      <td>{dec > 0 ? `${((v.wins / dec) * 100).toFixed(0)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && tab === "feed" && (
        <div className="adm-scroll" style={{ maxHeight: 280 }}>
          {data.recent.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No suggestions yet — the flywheel logs every 30 min.</div>
          ) : data.recent.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9, alignItems: "center" }}>
              <span style={{ color: "var(--adm-ink-3)", flexShrink: 0, whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <span style={{ color: r.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", flexShrink: 0, width: 30 }}>{r.side}</span>
              <span style={{ color: "var(--adm-ink)", flexShrink: 0, width: 48, fontFamily: "monospace" }}>{r.symbol}</span>
              <span style={{ color: statusColor(r.status), flex: 1 }}>{r.status}</span>
              <span style={{ color: "var(--adm-ink-3)", flexShrink: 0 }}>{r.probability != null ? `${r.probability}%` : ""}</span>
              <span style={{ color: (r.outcome_pct ?? 0) >= 0 ? "var(--adm-green)" : "var(--adm-red)", flexShrink: 0, width: 52, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.outcome_pct == null ? "" : `${r.outcome_pct >= 0 ? "+" : ""}${r.outcome_pct.toFixed(1)}%`}
              </span>
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}
