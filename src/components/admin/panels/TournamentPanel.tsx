"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Agent = {
  source: string; name: string; kind: string;
  total: number; open: number; resolved: number;
  wins: number; losses: number; expired: number;
  winRate: number | null;
  expectancy: number | null; expectancyNet: number | null;
  avgWin: number | null; avgLoss: number | null;
  profitFactor: number | null; avgRR: number | null;
  avgConfidence: number | null; calibration: number | null;
  form: string[]; sampleProgress: number;
  curve: number[];
  paperCurve: number[]; paperClosed: number;
  sufficientSample: boolean;
};
type TT = { agents: Agent[]; minSample: number; fetchedAt: string };

const PAPER_MATURE = 8;
const MEDAL = ["🥇", "🥈", "🥉"];
const kindColor = (kind: string) =>
  kind === "agent" ? "var(--adm-gold)" : kind === "model" ? "var(--adm-cyan)" : "var(--adm-ink-3)";
const pct = (n: number | null, d = 2) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);
const netColor = (n: number | null) => (n == null ? "var(--adm-ink-3)" : n >= 0 ? "var(--adm-green)" : "var(--adm-red)");

function Sparkline({ curve, h = 20 }: { curve: number[]; h?: number }) {
  if (!curve || curve.length < 2) return null;
  const w = 100, min = Math.min(100, ...curve), max = Math.max(100, ...curve), range = max - min || 1;
  const pts = curve.map((v, i) => `${((i / (curve.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 2) - 1).toFixed(1)}`).join(" ");
  const color = curve[curve.length - 1] >= 100 ? "var(--adm-green)" : "var(--adm-red)";
  const baseY = h - ((100 - min) / range) * (h - 2) - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }} role="img" aria-label="curva de patrimônio">
      <line x1={0} y1={baseY} x2={w} y2={baseY} stroke="var(--adm-border)" strokeDasharray="2 2" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 7, color: "var(--adm-ink-4)", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 10, color: color ?? "var(--adm-ink-2)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

export default function TournamentPanel() {
  const [data, setData] = useState<TT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/tournament");
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

  const ranked = (data?.agents ?? []).filter((a) => a.resolved > 0);
  const waiting = (data?.agents ?? []).filter((a) => a.resolved === 0);

  return (
    <TerminalPanel id="tournament" title="TOURNAMENT" subtitle="ranking por expectancy líquida · toque na linha p/ detalhes" icon="♛" source="supabase/zion_suggestions">
      {loading && <div className="adm-shimmer" style={{ height: 120 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && (
        <div>
          {ranked.length === 0 && (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10, marginBottom: 8 }}>
              Nenhum agente com trade resolvido ainda — o torneio preenche a cada tick.
            </div>
          )}

          <table className="adm-table">
            <thead><tr><th style={{ width: 26 }}></th><th>AGENTE</th><th>LÍQ./TRADE</th><th>WR</th><th>PF</th><th>DEC</th></tr></thead>
            <tbody>
              {ranked.map((a, i) => {
                const decided = a.wins + a.losses;
                const isOpen = open === a.source;
                return (
                  <Fragment key={a.source}>
                    <tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : a.source)}>
                      <td>{MEDAL[i] ?? `#${i + 1}`}</td>
                      <td style={{ color: kindColor(a.kind), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{a.name}</td>
                      <td style={{ color: netColor(a.expectancyNet), fontVariantNumeric: "tabular-nums" }}>{pct(a.expectancyNet)}</td>
                      <td>{a.winRate == null ? "—" : `${(a.winRate * 100).toFixed(0)}%`}</td>
                      <td style={{ color: a.profitFactor != null && a.profitFactor >= 1 ? "var(--adm-green)" : undefined }}>{a.profitFactor == null ? "—" : a.profitFactor.toFixed(2)}</td>
                      <td style={{ color: a.sufficientSample ? "var(--adm-cyan)" : "var(--adm-gold)" }} title={a.sufficientSample ? "amostra confiável" : `abaixo de ${data.minSample} decididos`}>
                        {decided}{a.sufficientSample ? "" : "⚠"} {isOpen ? "▲" : "▼"}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ padding: "8px 4px 10px", background: "var(--adm-bg-raise)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
                            <Stat label="GANHO MÉD" value={pct(a.avgWin)} color="var(--adm-green)" />
                            <Stat label="PERDA MÉD" value={pct(a.avgLoss)} color="var(--adm-red)" />
                            <Stat label="R:R PLANEJADO" value={a.avgRR == null ? "—" : a.avgRR.toFixed(2)} />
                            <Stat label="CALIBRAÇÃO" value={a.calibration == null ? "—" : `${a.calibration >= 0 ? "✓ ok" : "⚠ superconf."} ${a.calibration >= 0 ? "+" : ""}${a.calibration.toFixed(0)}`}
                                  color={a.calibration != null && a.calibration < 0 ? "var(--adm-gold)" : "var(--adm-green)"} />
                            <Stat label="ABERTOS" value={String(a.open)} />
                            <Stat label="EXPIRADOS" value={String(a.expired)} />
                            <Stat label="AMOSTRA" value={`${decided}/${data.minSample}`} color={a.sufficientSample ? "var(--adm-cyan)" : "var(--adm-gold)"} />
                            <Stat label="FORMA (últimos)" value={a.form.length ? a.form.join("") : "—"} />
                          </div>
                          {a.curve.length > 1 && (
                            <div style={{ display: "grid", gridTemplateColumns: a.paperClosed >= PAPER_MATURE ? "1fr 1fr" : "1fr", gap: 8 }}>
                              <div>
                                <Sparkline curve={a.curve} />
                                <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 2 }}>sinal · flywheel → <span style={{ color: netColor(a.curve[a.curve.length - 1] - 100) }}>{a.curve[a.curve.length - 1].toFixed(0)}</span></div>
                              </div>
                              {a.paperClosed >= PAPER_MATURE && (
                                <div>
                                  <Sparkline curve={a.paperCurve} />
                                  <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 2 }}>paper · gate.io → <span style={{ color: netColor(a.paperCurve[a.paperCurve.length - 1] - 100) }}>{a.paperCurve[a.paperCurve.length - 1].toFixed(0)}</span></div>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>

          {waiting.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", letterSpacing: "0.06em", marginBottom: 4 }}>AGUARDANDO RESOLUÇÃO (sem decididos)</div>
              {waiting.map((a) => (
                <div key={a.source} style={{ display: "flex", gap: 8, fontSize: 9, padding: "2px 0", alignItems: "center" }}>
                  <span style={{ color: kindColor(a.kind), flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                  <span style={{ color: "var(--adm-ink-3)", flexShrink: 0 }}>{a.open} abertos · {a.total} total</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </TerminalPanel>
  );
}
