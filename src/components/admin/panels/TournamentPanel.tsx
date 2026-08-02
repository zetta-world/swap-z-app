"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { sampleLabel, shouldTint, NOISE_THRESHOLD } from "@/lib/admin/sample";
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
  // Ficha da mesa (src/lib/zion/desks.ts) — COMO opera, ONDE, com que cérebro.
  style: string | null; venue: string | null; direction: string | null;
  brain: string | null; model: string | null; tests: string | null;
  who: string | null; horizonHours: number | null; status: string | null;
  curve: number[];
  paperCurve: number[]; paperClosed: number;
  sufficientSample: boolean;
};
type Fallen = { name: string; decided: number; net: number | null; cause: string };
type TT = { agents: Agent[]; valhalla?: Fallen[]; graveyard?: Fallen[]; minSample: number; fetchedAt: string };

const PAPER_MATURE = 8;
// A separação que faltava: day trade e swing não se medem com a mesma régua,
// então o ranking passa a ser POR ESTILO em vez de uma tabela só.
const STYLE_ORDER = ["scalp", "day", "swing", "position", "event"] as const;
const STYLE_LABEL: Record<string, string> = {
  scalp: "SCALP · ciclos de minutos", day: "DAY TRADE · fecha no dia",
  swing: "SWING · dias", position: "POSIÇÃO · semanas", event: "EVENTO · só com gatilho",
};
const DIR_LABEL: Record<string, string> = {
  long_only: "long-only · acumula USDT", long_short: "long+short · direcional",
  market_neutral: "market-neutral · hedgeada",
};
const DIR_COLOR: Record<string, string> = {
  long_only: "var(--adm-gold)", market_neutral: "var(--adm-green)", long_short: "var(--adm-ink-3)",
};
const MEDAL = ["🥇", "🥈", "🥉"];
const kindColor = (kind: string) =>
  kind === "agent" ? "var(--adm-gold)" : kind === "model" ? "var(--adm-cyan)"
  : kind === "desk" ? "var(--adm-green)" : kind === "oracle" ? "var(--adm-purple, #b48cff)"
  : kind === "strat" ? "var(--adm-gold)"
  : kind === "retired" ? "var(--adm-ink-4)" : "var(--adm-ink-3)";
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

const PERIODS: { label: string; days: number | null }[] = [
  { label: "24H", days: 1 },
  { label: "7D",  days: 7 },
  { label: "30D", days: 30 },
  { label: "TUDO", days: null },
];

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
  // Default 7d: the live round mixes config eras, and a lifetime average
  // buries whether the last fix worked. TUDO stays one tap away.
  const [days, setDays] = useState<number | null>(7);
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/tournament${days ? `?days=${days}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [days]);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 180_000 : 120_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  const ranked = (data?.agents ?? []).filter((a) => a.resolved > 0);
  const waiting = (data?.agents ?? []).filter((a) => a.resolved === 0);

  return (
    <TerminalPanel id="tournament" title="TOURNAMENT" subtitle="① COMPARA mesas — unidade: % líquido POR TRADE" icon="♛" source="supabase/zion_suggestions">
      {loading && <div className="adm-shimmer" style={{ height: 120 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {/* Janela de tempo — sem isso, a era nova fica diluída na antiga. */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {PERIODS.map((p) => (
          <button key={p.label}
            className={`adm-toggle ${days === p.days ? "active" : ""}`}
            style={{ fontSize: 8, padding: "2px 6px" }}
            onClick={() => { setDays(p.days); setLoading(true); }}>
            {p.label}
          </button>
        ))}
        <span style={{ fontSize: 7, color: "var(--adm-ink-4)" }}>
          por data do CARD (a config que o gerou)
        </span>
      </div>

      {data && (
        <div>
          {ranked.length === 0 && (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10, marginBottom: 8 }}>
              Nenhum agente com trade resolvido ainda — o torneio preenche a cada tick.
            </div>
          )}

          {/* "outros" fecha a conta: uma mesa sem ficha no registro não pode
              sumir da tela só por não estar catalogada. */}
          {[...STYLE_ORDER, "outros"].map((style) => {
          const group = style === "outros"
            ? ranked.filter((a) => !a.style || !STYLE_ORDER.includes(a.style as typeof STYLE_ORDER[number]))
            : ranked.filter((a) => a.style === style);
          if (group.length === 0) return null;
          const dir = group[0]?.direction ?? "";
          return (
          <div key={style} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "var(--adm-ink-4)", marginBottom: 3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "var(--adm-cyan)" }}>{STYLE_LABEL[style] ?? "SEM FICHA · registrar em desks.ts"}</span>
              <span style={{ color: DIR_COLOR[dir] ?? "var(--adm-ink-4)" }}>{DIR_LABEL[dir] ?? ""}</span>
            </div>
          <table className="adm-table">
            <thead><tr><th style={{ width: 26 }}></th><th>AGENTE</th><th>LÍQ./TRADE</th><th>WR</th><th>PF</th><th>DEC</th></tr></thead>
            <tbody>
              {group.map((a, i) => {
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
                          {(a.who || a.tests) && (
                            <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255 255 255 / 0.02)", borderLeft: "2px solid var(--adm-gold)", borderRadius: 2 }}>
                              {a.who && <div style={{ fontSize: 9, color: "var(--adm-ink-2)", fontStyle: "italic" }}>{a.who}</div>}
                              {a.tests && <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 3 }}>TESTA: {a.tests}</div>}
                              <div style={{ fontSize: 8, color: "var(--adm-ink-3)", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <span>praça: {a.venue === "cex" ? "CEX" : a.venue === "dex" ? "DEX" : a.venue === "both" ? "CEX+DEX" : "—"}</span>
                                <span>cérebro: {a.brain === "none" ? "mecânico (sem IA)" : a.model ?? "IA"}</span>
                                {a.horizonHours != null && <span>horizonte: {a.horizonHours}h</span>}
                              </div>
                            </div>
                          )}
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
          </div>
          );
          })}

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

          {((data.valhalla ?? data.graveyard)?.length ?? 0) > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--adm-gold-dim, rgba(212 175 55 / 0.25))" }}>
              <div style={{ fontSize: 8, color: "var(--adm-gold)", letterSpacing: "0.12em", marginBottom: 6 }}>
                ᚠ VALHALLA ᚱ — guerreiros direcionais que tombaram (rodada arquivada · aguardam Ragnarök)
              </div>
              {(data.valhalla ?? data.graveyard)!.map((g, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 9, padding: "3px 0", alignItems: "center" }}>
                  <span style={{ flexShrink: 0, color: "var(--adm-gold)" }}>⚔︎</span>
                  <span style={{ color: "var(--adm-ink-2)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {g.name}
                  </span>
                  <span style={{ color: "var(--adm-ink-4)", fontStyle: "italic", flexShrink: 0 }}>“{g.cause}”</span>
                  {/* A AMOSTRA AO LADO DO NÚMERO (01/08). Antes estes cinco
                      apareciam com o mesmo peso visual — e por trás deles havia
                      3, 5, 2, 14 e 268 trades. SAGA "lucrou" com UM trade certo;
                      VÖLVA·Kimi aparece no positivo com ZERO ganhos. Sem o `n`,
                      ruído tem a mesma cara de resultado. */}
                  <span style={{ color: "var(--adm-ink-4)", flexShrink: 0, width: 74, textAlign: "right", fontSize: 8 }}>
                    {sampleLabel(g.decided)}
                  </span>
                  <span style={{
                    // Abaixo do limiar o número sai em CINZA: continua legível,
                    // mas sem a autoridade que a cor empresta. Pintar de verde um
                    // +1,19% vindo de três trades é o mesmo erro do selo de
                    // segurança que era constante — confiança sem garantia.
                    color: shouldTint(g.decided) ? netColor(g.net) : "var(--adm-ink-4)",
                    flexShrink: 0, width: 52, textAlign: "right",
                  }}>{pct(g.net)}</span>
                </div>
              ))}
              <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 6, fontStyle: "italic" }}>
                ᚼ não morreram — festejam em Valhalla à espera de novo mandato. O veredito foi sobre <b>prever direção</b>; a próxima saga é <b>escolher a estratégia do momento</b>. Abaixo de {NOISE_THRESHOLD} decididos o número sai em cinza: é <b>ruído</b>, não resultado.
              </div>
            </div>
          )}
        </div>
      )}
    </TerminalPanel>
  );
}
