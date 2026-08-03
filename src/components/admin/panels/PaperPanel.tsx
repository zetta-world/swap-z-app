"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type OpenPos = { symbol: string; side: string; costUsd: number; unrealized: number };
type RecentTrade = { symbol: string; side: string; pnlUsd: number; pnlPct: number | null; route: string | null; closedAt: string | null };
type Row = {
  source: string; label: string;
  startingUsd: number; cashUsd: number; equity: number;
  realizedPnl: number; unrealizedPnl: number; returnPct: number;
  wins: number; losses: number; winRate: number | null;
  avgWin: number | null; avgLoss: number | null; profitFactor: number | null;
  best: number | null; worst: number | null; closedTrades: number;
  openPositions: number; exposure: number; openBook: OpenPos[]; recentTrades: RecentTrade[]; curve: number[];
};
type PR = { rows: Row[]; totals: { startingUsd: number; equity: number; realizedPnl: number; openPositions: number; exposure: number; closedTrades: number }; fetchedAt: string };
type RepairState = {
  plan: Array<{ source: string; label: string; from: number; to: number; deltaUsd: number }>;
  last: { at: string; totalUsd: number } | null;
};

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
  const [repair, setRepair] = useState<RepairState | null>(null);
  const [repairing, setRepairing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/paper");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  // O plano de reparo é lido junto, mas NUNCA executado sozinho. Ver o
  // cabeçalho de `paper/reconcile.ts`: reparo automático transformaria o
  // detector de vazamento em encobridor de vazamento.
  const loadRepair = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/paper-repair");
      if (res.ok) setRepair(await res.json());
    } catch { /* seção some, o painel continua */ }
  }, []);

  useEffect(() => {
    load(); loadRepair();
    const t = setInterval(load, realtime?.status === "live" ? 60_000 : 90_000);
    return () => clearInterval(t);
  }, [load, loadRepair, realtime?.status]);

  async function runRepair() {
    setRepairing(true);
    try {
      const res = await fetch("/admin/api/paper-repair", { method: "POST" });
      if (res.ok) { await load(); await loadRepair(); }
    } catch { /* estado antigo permanece */ } finally { setRepairing(false); }
  }

  const rows = data?.rows ?? [];
  const totalRet = data && data.totals.startingUsd > 0 ? (data.totals.equity / data.totals.startingUsd - 1) * 100 : 0;

  return (
    <TerminalPanel id="paper" title="PAPER · GATE.IO" subtitle="③ SÓ AS CARTEIRAS, sem ranking — unidade: patrimônio em USDT" icon="📈" source="supabase/paper_accounts">
      {loading && <div className="adm-shimmer" style={{ height: 140 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {/* O ROMBO QUE SOBROU. O bug do débito-sem-posição foi corrigido em 01/08,
          mas correção não devolve dinheiro: uma mesa com $51 de $1.000 não abre
          posição nenhuma e some do experimento sem nada ficar vermelho. */}
      {repair && repair.plan.length > 0 && (
        <div style={{
          border: "1px solid var(--adm-red)", borderRadius: 4, padding: "7px 9px", marginBottom: 10,
          fontSize: 9, lineHeight: 1.6, color: "var(--adm-ink-3)",
        }}>
          <div style={{ color: "var(--adm-red)", fontWeight: 700, letterSpacing: "0.08em" }}>
            ⚠ {repair.plan.length} CARTEIRA(S) VIVA(S) COM CAIXA A MENOS —{" "}
            {usd(repair.plan.reduce((s, p) => s + p.deltaUsd, 0))} a devolver
          </div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", margin: "3px 0" }}>
            {repair.plan.slice(0, 6).map((p) => `${p.label}: ${usd(p.from)} → ${usd(p.to)}`).join(" · ")}
            {repair.plan.length > 6 && ` · +${repair.plan.length - 6}`}
          </div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>
            O caixa é o que decide se a mesa consegue abrir posição — abaixo do piso ela
            simplesmente para, sem erro e sem alerta. Isto devolve o capital ao valor que os
            trades justificam. Não é automático de propósito: se fosse, um vazamento NOVO
            seria zerado a cada rodada e o detector nunca mais acusaria nada.
          </div>
          <button className="adm-btn" style={{ marginTop: 6 }} onClick={runRepair} disabled={repairing}>
            {repairing ? "devolvendo…" : "↺ devolver o capital às carteiras vivas"}
          </button>
        </div>
      )}
      {repair && repair.plan.length === 0 && repair.last && (
        <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginBottom: 8 }}>
          ✓ caixa bate com os trades · último reparo {new Date(repair.last.at).toLocaleString("pt-BR")}{" "}
          ({usd(repair.last.totalUsd)} devolvidos) — desvio que aparecer daqui pra frente é vazamento NOVO
        </div>
      )}

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
                            <div style={{ marginBottom: (r.recentTrades ?? []).length ? 8 : 0 }}>
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
                          {(r.recentTrades ?? []).length > 0 && (
                            <div>
                              <div style={{ fontSize: 7, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 3 }}>ÚLTIMAS ORDENS</div>
                              {r.recentTrades.map((t, j) => (
                                <div key={j} style={{ display: "flex", gap: 6, fontSize: 8, padding: "1px 0", alignItems: "center" }}>
                                  <span style={{ color: t.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", width: 26 }}>{t.side}</span>
                                  <span style={{ color: "var(--adm-ink-2)", fontFamily: "monospace", width: 44 }}>{t.symbol}</span>
                                  <span style={{ color: "var(--adm-ink-4)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.route ?? "—"}</span>
                                  <span style={{ color: t.pnlPct == null ? "var(--adm-ink-4)" : col(t.pnlPct), width: 46, textAlign: "right" }}>{t.pnlPct == null ? "—" : pctS(t.pnlPct, 2)}</span>
                                  <span style={{ color: col(t.pnlUsd), width: 46, textAlign: "right" }}>{`${t.pnlUsd >= 0 ? "+" : "−"}$${Math.abs(t.pnlUsd).toFixed(2)}`}</span>
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
