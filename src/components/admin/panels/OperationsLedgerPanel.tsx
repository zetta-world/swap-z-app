"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Recent = {
  wallet_address: string | null; kind: string; pair: string | null; side: string | null;
  volume_usd: number | null; pnl_usd: number | null; status: string; created_at: string;
};
type Ledger = {
  total: number; totalVolume: number; totalPnl: number;
  byKind: Record<string, { count: number; volume: number; pnl: number }>;
  recent: Recent[];
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export default function OperationsLedgerPanel() {
  const [data, setData] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "feed">("overview");
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/ledger");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 120_000 : 60_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  return (
    <TerminalPanel id="ops-ledger" title="OPERATIONS" subtitle="every client trade · volume · P&L" icon="≣" source="supabase/operations">
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["overview", "feed"] as const).map((t) => (
          <button key={t} className={`adm-toggle ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && tab === "overview" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Stat label="OPERATIONS" value={String(data.total)} color="var(--adm-cyan)" />
            <Stat label="VOLUME" value={usd(data.totalVolume)} color="var(--adm-ink)" />
            <Stat label="REALIZED P&L" value={`${data.totalPnl >= 0 ? "+" : ""}${usd(data.totalPnl)}`} color={data.totalPnl >= 0 ? "var(--adm-green)" : "var(--adm-red)"} />
          </div>
          {Object.keys(data.byKind).length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No operations recorded yet.</div>
          ) : (
            <table className="adm-table">
              <thead><tr><th>KIND</th><th>N</th><th>VOLUME</th><th>P&L</th></tr></thead>
              <tbody>
                {Object.entries(data.byKind).sort((a, b) => b[1].count - a[1].count).map(([kind, v]) => (
                  <tr key={kind}>
                    <td style={{ color: "var(--adm-cyan)", fontFamily: "monospace" }}>{kind}</td>
                    <td>{v.count}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{usd(v.volume)}</td>
                    <td style={{ color: v.pnl >= 0 ? "var(--adm-green)" : "var(--adm-red)", fontVariantNumeric: "tabular-nums" }}>{v.pnl >= 0 ? "+" : ""}{usd(v.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && tab === "feed" && (
        <div className="adm-scroll" style={{ maxHeight: 300 }}>
          {data.recent.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No operations yet.</div>
          ) : data.recent.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9, alignItems: "center" }}>
              <span style={{ color: "var(--adm-ink-3)", flexShrink: 0, whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <span style={{ color: "var(--adm-ink-4)", flexShrink: 0, width: 52, fontFamily: "monospace" }}>{r.wallet_address ? `${r.wallet_address.slice(0, 6)}…` : "—"}</span>
              {r.side && <span style={{ color: r.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", flexShrink: 0, width: 26 }}>{r.side}</span>}
              <span style={{ color: "var(--adm-ink)", flexShrink: 0, width: 76, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.pair ?? r.kind}</span>
              <span style={{ color: "var(--adm-ink-3)", flex: 1, fontVariantNumeric: "tabular-nums" }}>{r.volume_usd != null ? usd(r.volume_usd) : ""}</span>
              <span style={{ color: (r.pnl_usd ?? 0) >= 0 ? "var(--adm-green)" : "var(--adm-red)", flexShrink: 0, width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.pnl_usd == null ? "" : `${r.pnl_usd >= 0 ? "+" : ""}${usd(r.pnl_usd)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 15, color, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
    </div>
  );
}
