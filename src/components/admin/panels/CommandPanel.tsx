"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Command = {
  users: number; active24h: number; volume24h: number; pnlAll: number; aiCost24h: number;
  autopilot: { activeSessions: number; pnlToday: number; openPositions: number; exposure: number };
  backtest: { winRate: number | null; decided: number };
  alerts: { highSecurity24h: number; staleCrons: string[] };
};

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--adm-green)" : "var(--adm-red)");

export default function CommandPanel() {
  const [d, setD] = useState<Command | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/command");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 60_000 : 45_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  const hasAlerts = !!d && (d.alerts.highSecurity24h > 0 || d.alerts.staleCrons.length > 0);

  return (
    <TerminalPanel id="command" title="COMMAND" subtitle="the whole company at a glance" icon="◆" source="all workspaces">
      {loading && <div className="adm-shimmer" style={{ height: 140 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {d && (
        <div>
          {/* Status strip */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "6px 10px", borderRadius: 6, background: hasAlerts ? "var(--adm-glow-red)" : "var(--adm-bg-raise)", border: `1px solid ${hasAlerts ? "var(--adm-red)" : "var(--adm-border)"}` }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: hasAlerts ? "var(--adm-red)" : "var(--adm-green)" }} />
            <span style={{ fontSize: 10, color: hasAlerts ? "var(--adm-red)" : "var(--adm-green)", letterSpacing: "0.08em", flex: 1 }}>
              {hasAlerts
                ? [d.alerts.highSecurity24h > 0 ? `${d.alerts.highSecurity24h} high-sev security` : "", d.alerts.staleCrons.length > 0 ? `stale cron: ${d.alerts.staleCrons.join(", ")}` : ""].filter(Boolean).join(" · ")
                : "ALL CLEAR"}
            </span>
          </div>

          {/* KPI grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Kpi label="USERS" value={String(d.users)} sub={`${d.active24h} active 24h`} color="var(--adm-cyan)" />
            <Kpi label="VOLUME 24H" value={usd(d.volume24h)} sub="all operations" color="var(--adm-ink)" />
            <Kpi label="AUTOPILOT P&L TODAY" value={`${d.autopilot.pnlToday >= 0 ? "+" : ""}${usd(d.autopilot.pnlToday)}`} sub={`${d.autopilot.activeSessions} active sessions`} color={pnlColor(d.autopilot.pnlToday)} />
            <Kpi label="REALIZED P&L (ALL)" value={`${d.pnlAll >= 0 ? "+" : ""}${usd(d.pnlAll)}`} sub="every operation" color={pnlColor(d.pnlAll)} />
            <Kpi label="OPEN EXPOSURE" value={usd(d.autopilot.exposure)} sub={`${d.autopilot.openPositions} positions`} color="var(--adm-gold)" />
            <Kpi label="ZION WIN-RATE" value={d.backtest.winRate == null ? "—" : `${(d.backtest.winRate * 100).toFixed(0)}%`} sub={`${d.backtest.decided} decided`} color="var(--adm-violet)" />
            <Kpi label="AI COST 24H" value={`$${d.aiCost24h.toFixed(2)}`} sub="Claude usage" color="var(--adm-amber)" />
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ fontSize: 22, color, fontVariantNumeric: "tabular-nums", marginTop: 3, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 3 }}>{sub}</div>
    </div>
  );
}
