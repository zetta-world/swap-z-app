"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type OpenPos = { symbol: string; side: string; costUsd: number; unrealized: number };
type Row = {
  source: string; label: string;
  startingUsd: number; cashUsd: number; equity: number;
  realizedPnl: number; unrealizedPnl: number; returnPct: number;
  wins: number; losses: number; winRate: number | null;
  avgWin: number | null; avgLoss: number | null; profitFactor: number | null;
  best: number | null; worst: number | null; closedTrades: number;
  openPositions: number; exposure: number; openBook: OpenPos[]; curve: number[];
};
type PR = { rows: Row[]; totals: { startingUsd: number; equity: number; realizedPnl: number; openPositions: number; exposure: number; closedTrades: number }; fetchedAt: string };

const MEDAL = ["🥇", "🥈", "🥉"];
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const usdc = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(0)}`);
const pctS = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
const col = (n: number) => (n >= 0 ? "var(--adm-green)" : "var(--adm-red)");

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

export default function PaperPanel() {
  const [data, setData] = useState<PR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
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

  const rows = data?.rows ?? [];
  const totalRet = data && data.totals.startingUsd > 0 ? (data.totals.equity / data.totals.startingUsd - 1) * 100 : 0;

  return (
    <TerminalPanel id="paper" title="PAPER · GATE.IO" subtitle="$1000/agente · toque na linha p/ detalhes" icon="📈" source="supabase/paper_accounts">
      {loading && <div className="adm-shimmer" style={{ height: 140 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[
              { label: "PATRIMÔNIO", v: usd(data.totals.equity), sub: pctS(totalRet, 2), subColor: col(totalRet) },
              { label: "REALIZADO", v: usdc(data.totals.realizedPnl), subColor: col(data.totals.realizedPnl) },
              { label: "ABERTAS", v: `${data.totals.openPositions}`, sub: `exp ${usd(data.totals.exposure)}` },
            ].map((t) => (
              <div key={t.label} style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 8px" }}>
                <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{t.label}</div>
                <div style={{ fontSize: 14, color: "var(--adm-cyan)", fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
                {t.sub && <div style={{ fontSize: 8, color: t.subColor ?? "var(--adm-ink-4)" }}>{t.sub}</div>}
              </div>
            ))}
          </div>

          <table className="adm-table">
            <thead><tr><th style={{ width: 26 }}></th><th>CARTEIRA</th><th>EQUITY</th><th>RET</th><th>WR</th><th>AB</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const flat = r.closedTrades === 0 && r.openPositions === 0;
                const isOpen = open === r.source;
                return (
                  <Fragment key={r.source}>
                    <tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : r.source)}>
                      <td>{MEDAL[i] ?? `#${i + 1}`}</td>
                      <td style={{ color: "var(--adm-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{r.label}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{usd(r.equity)}</td>
                      <td style={{ color: flat ? "var(--adm-ink-4)" : col(r.returnPct) }}>{flat ? "—" : pctS(r.returnPct)}</td>
                      <td>{r.winRate == null ? "—" : `${r.winRate.toFixed(0)}%`}</td>
                      <td style={{ color: "var(--adm-cyan)" }}>{r.openPositions} {isOpen ? "▲" : "▼"}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ padding: "8px 4px 10px", background: "var(--adm-bg-raise)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
                            <Stat label="REALIZADO" value={usdc(r.realizedPnl)} color={col(r.realizedPnl)} />
                            <Stat label="N-REALIZADO" value={usdc(r.unrealizedPnl)} color={col(r.unrealizedPnl)} />
                            <Stat label="PROFIT F." value={r.profitFactor == null ? "—" : r.profitFactor.toFixed(2)} color={r.profitFactor != null && r.profitFactor >= 1 ? "var(--adm-green)" : undefined} />
                            <Stat label="FECHADOS" value={String(r.closedTrades)} />
                            <Stat label="MELHOR" value={usdc(r.best)} color="var(--adm-green)" />
                            <Stat label="PIOR" value={usdc(r.worst)} color="var(--adm-red)" />
                            <Stat label="EXPOSIÇÃO" value={usd(r.exposure)} />
                            <Stat label="CAIXA" value={usd(r.cashUsd)} />
                          </div>
                          {r.curve.length > 1 && (
                            <div style={{ marginBottom: r.openBook.length ? 8 : 0 }}>
                              <Sparkline curve={r.curve} />
                              <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 2 }}>curva realizada · base 100 → <span style={{ color: col(r.curve[r.curve.length - 1] - 100) }}>{r.curve[r.curve.length - 1].toFixed(0)}</span></div>
                            </div>
                          )}
                          {r.openBook.length > 0 && (
                            <div>
                              <div style={{ fontSize: 7, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 3 }}>LIVRO ABERTO</div>
                              {r.openBook.map((p, j) => (
                                <div key={j} style={{ display: "flex", gap: 6, fontSize: 8, padding: "1px 0", alignItems: "center" }}>
                                  <span style={{ color: p.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", width: 26 }}>{p.side}</span>
                                  <span style={{ color: "var(--adm-ink-2)", flex: 1, fontFamily: "monospace" }}>{p.symbol}</span>
                                  <span style={{ color: "var(--adm-ink-4)" }}>{usd(p.costUsd)}</span>
                                  <span style={{ color: col(p.unrealized), width: 42, textAlign: "right" }}>{usdc(p.unrealized)}</span>
                                </div>
                              ))}
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
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 6 }}>
            Fills no preço vivo da Gate.io · equity = capital + realizado + não-realizado (mark-to-market).
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
