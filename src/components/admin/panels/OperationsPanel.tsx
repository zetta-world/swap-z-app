"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Position = {
  base: string; pair: string; base_amount: number; cost_usd: number;
  entry_price: number; status: string; exit_order_id: string | null;
  entry_ts: string; exchange_id: string;
};
type Run = {
  ran_at: string; symbol: string | null; side: string | null;
  order_type: string | null; notional_usd: number | null;
  status: string; reason: string | null; exchange_id: string;
};
type Ops = { positions: Position[]; runs: Run[]; openExposure: number };

function runColor(s: string): string {
  if (s === "fired" || s === "settled")  return "var(--adm-green)";
  if (s === "errored")                    return "var(--adm-red)";
  if (s === "rejected" || s === "skipped") return "var(--adm-gold)";
  return "var(--adm-ink-2)";
}

export default function OperationsPanel() {
  const [data, setData] = useState<Ops | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"positions" | "runs">("positions");
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/operations");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 60_000 : 30_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  return (
    <TerminalPanel id="live-ops" title="LIVE OPS" subtitle="open positions · run feed" icon="⊠" source="supabase/autopilot_positions+runs">
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        {(["positions", "runs"] as const).map((t) => (
          <button key={t} className={`adm-toggle ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {data && (
          <span style={{ fontSize: 9, color: "var(--adm-ink-3)" }}>
            exposure <span style={{ color: "var(--adm-ink)", fontVariantNumeric: "tabular-nums" }}>${Math.round(data.openExposure).toLocaleString()}</span>
          </span>
        )}
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && tab === "positions" && (
        data.positions.length === 0 ? (
          <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No open autopilot positions.</div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>ASSET</th><th>QTY</th><th>COST</th><th>ENTRY</th><th>STATUS</th></tr></thead>
            <tbody>
              {data.positions.map((p, i) => (
                <tr key={i}>
                  <td style={{ color: "var(--adm-ink)" }}>{p.base}<span style={{ color: "var(--adm-ink-4)", fontSize: 8 }}> {p.exchange_id}</span></td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(p.base_amount)}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>${Math.round(Number(p.cost_usd)).toLocaleString()}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>${Number(p.entry_price)}</td>
                  <td style={{ color: p.status === "exit_armed" ? "var(--adm-gold)" : "var(--adm-green)" }}>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {data && tab === "runs" && (
        <div className="adm-scroll" style={{ maxHeight: 280 }}>
          {data.runs.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No autopilot runs yet.</div>
          ) : data.runs.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9, alignItems: "center" }}>
              <span style={{ color: "var(--adm-ink-3)", flexShrink: 0, whiteSpace: "nowrap" }}>{new Date(r.ran_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              {r.side && <span style={{ color: r.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", flexShrink: 0, width: 28 }}>{r.side}</span>}
              <span style={{ color: "var(--adm-ink)", flexShrink: 0, width: 64, fontFamily: "monospace" }}>{r.symbol ?? "—"}</span>
              <span style={{ color: runColor(r.status), flexShrink: 0, width: 56 }}>{r.status}</span>
              <span style={{ color: "var(--adm-ink-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason ?? (r.notional_usd != null ? `$${Math.round(r.notional_usd)}` : "")}</span>
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}
