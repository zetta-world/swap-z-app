"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Row = { event_type: string; metadata: Record<string, unknown> | null; created_at: string };
type Logs = {
  errors24h: number; security24h: number; high24h: number;
  topKinds: { kind: string; count: number }[];
  recent: Row[];
};

function sevColor(sev: unknown): string {
  return sev === "high" ? "var(--adm-red)" : sev === "med" ? "var(--adm-gold)" : "var(--adm-ink-3)";
}

export default function LogsSecurityPanel() {
  const [data, setData] = useState<Logs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "feed">("overview");
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/logs");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 90_000 : 45_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  useEffect(() => {
    if (!realtime) return;
    return realtime.subscribe((scope) => { if (scope === "events") load(); });
  }, [realtime, load]);

  return (
    <TerminalPanel id="logs-security" title="LOGS & SECURITY" subtitle="errors · abuse · intrusion attempts" icon="⚠" source="supabase/platform_events">
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
            <Stat label="ERRORS 24H" value={data.errors24h} color="var(--adm-gold)" />
            <Stat label="SECURITY 24H" value={data.security24h} color="var(--adm-cyan)" />
            <Stat label="HIGH SEV" value={data.high24h} color={data.high24h > 0 ? "var(--adm-red)" : "var(--adm-ink-3)"} />
          </div>
          {data.topKinds.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No errors or security events in 24h. ✓</div>
          ) : (
            <table className="adm-table">
              <thead><tr><th>KIND</th><th>24H</th></tr></thead>
              <tbody>
                {data.topKinds.map(({ kind, count }) => (
                  <tr key={kind}><td style={{ color: "var(--adm-ink-2)", fontFamily: "monospace" }}>{kind}</td><td>{count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && tab === "feed" && (
        <div className="adm-scroll" style={{ maxHeight: 300 }}>
          {data.recent.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>Nothing logged yet.</div>
          ) : data.recent.map((r, i) => {
            const m = r.metadata ?? {};
            const kind = String(m.kind ?? m.where ?? r.event_type);
            const detail = String(m.message ?? m.reason ?? m.route ?? m.symbol ?? "");
            return (
              <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9, alignItems: "center" }}>
                <span style={{ color: "var(--adm-ink-3)", flexShrink: 0, whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleTimeString()}</span>
                <span style={{ color: r.event_type === "error" ? "var(--adm-gold)" : "var(--adm-cyan)", flexShrink: 0, width: 52 }}>{r.event_type}</span>
                <span style={{ color: sevColor(m.severity), flexShrink: 0, width: 8 }} title={String(m.severity ?? "")}>●</span>
                <span style={{ color: "var(--adm-ink-2)", flexShrink: 0, fontFamily: "monospace", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kind}</span>
                <span style={{ color: "var(--adm-ink-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
              </div>
            );
          })}
        </div>
      )}
    </TerminalPanel>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 20, color, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
    </div>
  );
}
