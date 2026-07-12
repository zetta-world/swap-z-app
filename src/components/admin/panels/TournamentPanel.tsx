"use client";

import { useCallback, useEffect, useState } from "react";
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
  sufficientSample: boolean;
};
type TT = { agents: Agent[]; minSample: number; fetchedAt: string };

const MEDAL = ["🥇", "🥈", "🥉"];
const kindMeta: Record<string, { label: string; color: string }> = {
  agent: { label: "AGENTE", color: "var(--adm-gold)" },
  model: { label: "MODELO", color: "var(--adm-cyan)" },
  other: { label: "—",      color: "var(--adm-ink-3)" },
};
const pct = (n: number | null, d = 2) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);
const netColor = (n: number | null) => (n == null ? "var(--adm-ink-3)" : n >= 0 ? "var(--adm-green)" : "var(--adm-red)");

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: color ?? "var(--adm-ink)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 7, color: "var(--adm-ink-4)", letterSpacing: "0.08em" }}>{label}</div>
    </div>
  );
}

function Sparkline({ curve, h = 22 }: { curve: number[]; h?: number }) {
  if (!curve || curve.length < 2) return null;
  const w = 100; // viewBox width; SVG scales to container
  const min = Math.min(100, ...curve), max = Math.max(100, ...curve);
  const range = max - min || 1;
  const x = (i: number) => (i / (curve.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / range) * (h - 2) - 1;
  const pts = curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = curve[curve.length - 1] >= 100;
  const color = up ? "var(--adm-green)" : "var(--adm-red)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }} role="img" aria-label="curva de patrimônio">
      <line x1={0} y1={y(100)} x2={w} y2={y(100)} stroke="var(--adm-border)" strokeDasharray="2 2" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Form({ form }: { form: string[] }) {
  if (form.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {form.map((r, i) => (
        <span key={i} title={r === "W" ? "win" : "loss"} style={{
          width: 6, height: 6, borderRadius: 2,
          background: r === "W" ? "var(--adm-green)" : "var(--adm-red)", opacity: 0.35 + (i / form.length) * 0.65,
        }} />
      ))}
    </div>
  );
}

export default function TournamentPanel() {
  const [data, setData] = useState<TT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
  const maxAbs = Math.max(0.5, ...ranked.map((a) => Math.abs(a.expectancyNet ?? 0)));
  const champ = ranked[0];

  return (
    <TerminalPanel id="tournament" title="TOURNAMENT" subtitle="ranking por expectancy líquida · pós-taxas" icon="♛" source="supabase/zion_suggestions">
      {loading && <div className="adm-shimmer" style={{ height: 160 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && (
        <div>
          {/* ── CHAMPION spotlight ─────────────────────────────────────── */}
          {champ && (
            <div style={{
              position: "relative", borderRadius: 10, padding: "10px 12px", marginBottom: 10,
              background: "linear-gradient(135deg, color-mix(in srgb, var(--adm-gold) 12%, transparent), transparent 70%)",
              border: "1px solid color-mix(in srgb, var(--adm-gold) 40%, transparent)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 22 }}>👑</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 8, color: "var(--adm-gold)", letterSpacing: "0.12em" }}>LÍDER DO TORNEIO</div>
                  <div style={{ fontSize: 13, color: "var(--adm-ink)", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{champ.name}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 22, color: netColor(champ.expectancyNet), fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{pct(champ.expectancyNet)}</div>
                  <div style={{ fontSize: 7, color: "var(--adm-ink-4)", letterSpacing: "0.08em" }}>LÍQ / TRADE</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, marginTop: 8 }}>
                <Metric label="WIN%" value={champ.winRate == null ? "—" : `${(champ.winRate * 100).toFixed(0)}%`} />
                <Metric label="PROFIT F." value={champ.profitFactor == null ? "—" : champ.profitFactor.toFixed(2)} color={champ.profitFactor != null && champ.profitFactor >= 1 ? "var(--adm-green)" : "var(--adm-red)"} />
                <Metric label="R:R" value={champ.avgRR == null ? "—" : champ.avgRR.toFixed(2)} />
                <Metric label="GANHO MÉD" value={pct(champ.avgWin)} color="var(--adm-green)" />
                <Metric label="PERDA MÉD" value={pct(champ.avgLoss)} color="var(--adm-red)" />
              </div>
              {champ.curve.length > 1 && (
                <div style={{ marginTop: 8 }}>
                  <Sparkline curve={champ.curve} h={34} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "var(--adm-ink-4)", marginTop: 2 }}>
                    <span>curva de patrimônio · base 100</span>
                    <span style={{ color: netColor(champ.curve[champ.curve.length - 1] - 100) }}>→ {champ.curve[champ.curve.length - 1].toFixed(0)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {ranked.length === 0 && (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10, marginBottom: 8 }}>
              Nenhum agente com trade resolvido ainda — o torneio preenche a cada tick.
            </div>
          )}

          {/* ── Ranked rows ────────────────────────────────────────────── */}
          {ranked.map((a, i) => {
            const decided = a.wins + a.losses;
            const barW = Math.round((Math.abs(a.expectancyNet ?? 0) / maxAbs) * 100);
            const pos = (a.expectancyNet ?? 0) >= 0;
            const km = kindMeta[a.kind] ?? kindMeta.other;
            return (
              <div key={a.source} style={{ padding: "8px 2px", borderBottom: "1px solid var(--adm-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 13, width: 24, textAlign: "center", flexShrink: 0 }}>{MEDAL[i] ?? `#${i + 1}`}</span>
                  <span style={{ fontSize: 11, color: "var(--adm-ink)", fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                  <span style={{ fontSize: 7, color: km.color, border: `1px solid color-mix(in srgb, ${km.color} 30%, transparent)`, borderRadius: 3, padding: "1px 4px", letterSpacing: "0.06em", flexShrink: 0 }}>{km.label}</span>
                  <span style={{ fontSize: 15, color: netColor(a.expectancyNet), fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 56, textAlign: "right" }}>{pct(a.expectancyNet)}</span>
                </div>

                {/* expectancy bar (centered zero) */}
                <div style={{ display: "flex", alignItems: "center", height: 5, marginBottom: 5, marginLeft: 32 }}>
                  <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                    {!pos && <div style={{ width: `${barW}%`, height: 4, borderRadius: 2, background: "var(--adm-red)", opacity: 0.7 }} />}
                  </div>
                  <div style={{ width: 1, height: 8, background: "var(--adm-border)" }} />
                  <div style={{ flex: 1 }}>
                    {pos && <div style={{ width: `${barW}%`, height: 4, borderRadius: 2, background: "var(--adm-green)", opacity: 0.7 }} />}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 32, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 8, color: "var(--adm-ink-3)" }}>WR {a.winRate == null ? "—" : `${(a.winRate * 100).toFixed(0)}%`}</span>
                  <span style={{ fontSize: 8, color: a.profitFactor != null && a.profitFactor >= 1 ? "var(--adm-green)" : "var(--adm-ink-3)" }}>PF {a.profitFactor == null ? "—" : a.profitFactor.toFixed(2)}</span>
                  <span style={{ fontSize: 8, color: "var(--adm-ink-3)" }}>R:R {a.avgRR == null ? "—" : a.avgRR.toFixed(2)}</span>
                  <span style={{ fontSize: 8, color: "var(--adm-green)" }}>{pct(a.avgWin)}</span>
                  <span style={{ fontSize: 8, color: "var(--adm-red)" }}>{pct(a.avgLoss)}</span>
                  {a.calibration != null && (
                    <span style={{ fontSize: 8, color: a.calibration >= 0 ? "var(--adm-green)" : "var(--adm-gold)" }} title="acerto real − confiança declarada">
                      {a.calibration >= 0 ? "✓ calibrado" : "⚠ superconfiante"} {a.calibration >= 0 ? "+" : ""}{a.calibration.toFixed(0)}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  <Form form={a.form} />
                </div>

                {/* sample progress toward MIN_SAMPLE */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 32, marginTop: 4 }}>
                  <div style={{ flex: 1, height: 3, background: "var(--adm-bg-raise)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${a.sampleProgress * 100}%`, height: "100%", background: a.sufficientSample ? "var(--adm-cyan)" : "var(--adm-gold)", opacity: 0.8 }} />
                  </div>
                  <span style={{ fontSize: 7, color: a.sufficientSample ? "var(--adm-cyan)" : "var(--adm-gold)", flexShrink: 0 }}>
                    {decided}/{data.minSample} {a.sufficientSample ? "✓ confiável" : "amostra"} · {a.open} abertos · {a.expired} exp
                  </span>
                </div>

                {a.curve.length > 1 && (
                  <div style={{ marginLeft: 32, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1 }}><Sparkline curve={a.curve} h={18} /></div>
                    <span style={{ fontSize: 7, color: netColor(a.curve[a.curve.length - 1] - 100), flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>→{a.curve[a.curve.length - 1].toFixed(0)}</span>
                  </div>
                )}
              </div>
            );
          })}

          {waiting.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", letterSpacing: "0.06em", marginBottom: 4 }}>AGUARDANDO RESOLUÇÃO (sem decididos)</div>
              {waiting.map((a) => (
                <div key={a.source} style={{ display: "flex", gap: 8, fontSize: 9, padding: "2px 0", alignItems: "center" }}>
                  <span style={{ color: (kindMeta[a.kind] ?? kindMeta.other).color, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
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
