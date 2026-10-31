"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";
import { corDoPnl } from "@/lib/admin/cor-resultado";
import { mensagemDeFalha } from "@/lib/admin/metrica";

/** `null` = a fonte daquele número NÃO foi lida (ver `falhas`). Tela: "—", nunca 0. */
type N = number | null;
type Command = {
  falhas?: string[];
  users: N; active24h: N; volume24h: N; pnlAll: N; aiCost24h: N;
  autopilot: { activeSessions: N; pnlToday: N; openPositions: N; exposure: N };
  backtest: { winRate: number | null; decided: N };
  alerts: { highSecurity24h: N; staleCrons: string[] };
};

const usd = (n: N) => n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
const num = (n: N) => n == null ? "—" : String(n);
const sinal = (n: N) => n == null ? "—" : `${n >= 0 ? "+" : ""}${usd(n)}`;
/** ⚠️ Zero e nulo eram VERDES aqui. Ver `corDoPnl`. */
const pnlColor = (n: number | null | undefined) => corDoPnl(n);

export default function CommandPanel() {
  const [d, setD] = useState<Command | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/command");
      const json = await res.json().catch(() => null);
      if (!res.ok) { setD(null); setError(mensagemDeFalha(res.status, json)); return; }
      setD(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 45_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  const hasAlerts = !!d && ((d.alerts.highSecurity24h ?? 0) > 0 || d.alerts.staleCrons.length > 0);
  // ⚠️ Sem ler tudo, NADA é declarado limpo: "ALL CLEAR" exige `falhas` vazio.
  const incompleto = !!d && (d.falhas?.length ?? 0) > 0;
  const corFaixa = hasAlerts ? "var(--adm-red)" : incompleto ? "var(--adm-amber)" : "var(--adm-green)";

  return (
    <TerminalPanel id="command" title="COMMAND" subtitle="the whole company at a glance" icon="◆" source="all workspaces">
      {loading && <div className="adm-shimmer" style={{ height: 140 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 13 }}>{error}</div>}

      {d && (
        <div>
          {/* Status strip */}
          <div role={hasAlerts || incompleto ? "alert" : undefined} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "6px 10px", borderRadius: 6, background: hasAlerts ? "var(--adm-glow-red)" : "var(--adm-bg-raise)", border: `1px solid ${hasAlerts || incompleto ? corFaixa : "var(--adm-border)"}` }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: corFaixa }} />
            <span style={{ fontSize: 13, color: corFaixa, letterSpacing: "0.08em", flex: 1 }}>
              {[
                (d.alerts.highSecurity24h ?? 0) > 0 ? `${d.alerts.highSecurity24h} high-sev security` : "",
                d.alerts.staleCrons.length > 0 ? `stale cron: ${d.alerts.staleCrons.join(", ")}` : "",
                incompleto ? `DADOS INCOMPLETOS — não li: ${d.falhas!.join(", ")}` : "",
              ].filter(Boolean).join(" · ") || "ALL CLEAR"}
            </span>
          </div>

          {/* KPI grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Kpi label="USERS" value={num(d.users)} sub={`${num(d.active24h)} active 24h`} color="var(--adm-cyan)" />
            <Kpi label="VOLUME 24H" value={usd(d.volume24h)} sub="all operations" color="var(--adm-ink)" />
            <Kpi label="AUTOPILOT P&L TODAY" value={sinal(d.autopilot.pnlToday)} sub={`${num(d.autopilot.activeSessions)} active sessions`} color={pnlColor(d.autopilot.pnlToday)} />
            <Kpi label="REALIZED P&L (ALL)" value={sinal(d.pnlAll)} sub="every operation" color={pnlColor(d.pnlAll)} />
            <Kpi label="OPEN EXPOSURE" value={usd(d.autopilot.exposure)} sub={`${num(d.autopilot.openPositions)} positions`} color="var(--adm-gold)" />
            <Kpi label="ZION WIN-RATE" value={d.backtest.winRate == null ? "—" : `${(d.backtest.winRate * 100).toFixed(0)}%`} sub={`${num(d.backtest.decided)} decided`} color="var(--adm-violet)" />
            <Kpi label="AI COST 24H" value={d.aiCost24h == null ? "—" : `$${d.aiCost24h.toFixed(2)}`} sub="Claude usage" color="var(--adm-amber)" />
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "var(--adm-ink-3)", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ fontSize: 22, color, fontVariantNumeric: "tabular-nums", marginTop: 3, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 3 }}>{sub}</div>
    </div>
  );
}
