"use client";

import { useCallback, useEffect, useState } from "react";
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
const usdc = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(0)}`);
const pctS = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
const col = (n: number) => (n >= 0 ? "var(--adm-green)" : "var(--adm-red)");

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
  const w = 100, min = Math.min(100, ...curve), max = Math.max(100, ...curve), range = max - min || 1;
  const pts = curve.map((v, i) => `${((i / (curve.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 2) - 1).toFixed(1)}`).join(" ");
  const up = curve[curve.length - 1] >= 100, color = up ? "var(--adm-green)" : "var(--adm-red)";
  const baseY = h - ((100 - min) / range) * (h - 2) - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }} role="img" aria-label="curva de patrimônio">
      <line x1={0} y1={baseY} x2={w} y2={baseY} stroke="var(--adm-border)" strokeDasharray="2 2" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
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
  const champ = rows[0];
  const totalRet = data && data.totals.startingUsd > 0 ? (data.totals.equity / data.totals.startingUsd - 1) * 100 : 0;

  return (
    <TerminalPanel id="paper" title="PAPER · GATE.IO" subtitle="torneio ao nível de portfólio · $1000/agente" icon="📈" source="supabase/paper_accounts">
      {loading && <div className="adm-shimmer" style={{ height: 160 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && (
        <div>
          {/* Totals */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 78, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 7px" }}>
              <div style={{ fontSize: 8, color: "var(--adm-ink-3)" }}>PATRIMÔNIO</div>
              <div style={{ fontSize: 15, color: "var(--adm-cyan)" }}>{usd(data.totals.equity)}</div>
              <div style={{ fontSize: 9, color: col(totalRet) }}>{pctS(totalRet)}</div>
            </div>
            <Metric label="REALIZADO" value={usdc(data.totals.realizedPnl)} color={col(data.totals.realizedPnl)} />
            <Metric label="FECHADOS" value={String(data.totals.closedTrades)} />
            <Metric label="ABERTAS" value={String(data.totals.openPositions)} />
            <Metric label="EXPOSIÇÃO" value={usd(data.totals.exposure)} />
          </div>

          {/* Champion */}
          {champ && (
            <div style={{ borderRadius: 10, padding: "10px 12px", marginBottom: 10,
              background: "linear-gradient(135deg, color-mix(in srgb, var(--adm-gold) 12%, transparent), transparent 70%)",
              border: "1px solid color-mix(in srgb, var(--adm-gold) 40%, transparent)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 22 }}>👑</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 8, color: "var(--adm-gold)", letterSpacing: "0.12em" }}>MELHOR CARTEIRA</div>
                  <div style={{ fontSize: 13, color: "var(--adm-ink)", fontWeight: 700 }}>{champ.label}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, color: "var(--adm-ink)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{usd(champ.equity)}</div>
                  <div style={{ fontSize: 10, color: col(champ.returnPct) }}>{pctS(champ.returnPct)}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, marginTop: 8 }}>
                <Metric label="WIN%" value={champ.winRate == null ? "—" : `${champ.winRate.toFixed(0)}%`} />
                <Metric label="PROFIT F." value={champ.profitFactor == null ? "—" : champ.profitFactor.toFixed(2)} color={champ.profitFactor != null && champ.profitFactor >= 1 ? "var(--adm-green)" : "var(--adm-red)"} />
                <Metric label="REAL." value={usdc(champ.realizedPnl)} color={col(champ.realizedPnl)} />
                <Metric label="N-REAL." value={usdc(champ.unrealizedPnl)} color={col(champ.unrealizedPnl)} />
                <Metric label="FECH." value={String(champ.closedTrades)} />
              </div>
              {champ.curve.length > 1 && (
                <div style={{ marginTop: 8 }}>
                  <Sparkline curve={champ.curve} h={32} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "var(--adm-ink-4)", marginTop: 2 }}>
                    <span>curva de patrimônio realizada · base 100</span>
                    <span style={{ color: col(champ.curve[champ.curve.length - 1] - 100) }}>→{champ.curve[champ.curve.length - 1].toFixed(0)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ranked wallets */}
          {rows.map((r, i) => {
            const flat = r.closedTrades === 0 && r.openPositions === 0;
            const isOpen = open === r.source;
            return (
              <div key={r.source} style={{ padding: "7px 2px", borderBottom: "1px solid var(--adm-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: r.openBook.length ? "pointer" : "default" }}
                     onClick={() => r.openBook.length && setOpen(isOpen ? null : r.source)}>
                  <span style={{ fontSize: 12, width: 22, textAlign: "center", flexShrink: 0 }}>{MEDAL[i] ?? `#${i + 1}`}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "var(--adm-ink)", fontWeight: 600 }}>{r.label}</div>
                    <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 1 }}>
                      {r.closedTrades} fech · {r.openPositions} abertas · exp {usd(r.exposure)}
                      {r.winRate != null && <span> · WR {r.winRate.toFixed(0)}% · PF {r.profitFactor == null ? "—" : r.profitFactor.toFixed(2)}</span>}
                      {r.openBook.length > 0 && <span style={{ color: "var(--adm-cyan)" }}> · {isOpen ? "▲" : "▼"} livro</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--adm-ink)", fontVariantNumeric: "tabular-nums" }}>{usd(r.equity)}</div>
                    <div style={{ fontSize: 9, color: flat ? "var(--adm-ink-4)" : col(r.returnPct) }}>{flat ? "—" : pctS(r.returnPct)}</div>
                  </div>
                </div>

                {r.curve.length > 1 && (
                  <div style={{ marginLeft: 30, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1 }}><Sparkline curve={r.curve} h={16} /></div>
                    <span style={{ fontSize: 7, color: col(r.curve[r.curve.length - 1] - 100), flexShrink: 0 }}>→{r.curve[r.curve.length - 1].toFixed(0)}</span>
                  </div>
                )}

                {isOpen && r.openBook.length > 0 && (
                  <div style={{ marginLeft: 30, marginTop: 4 }}>
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
              </div>
            );
          })}

          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 6 }}>
            Fills no preço vivo da Gate.io · equity = capital + P&L realizado + não-realizado (mark-to-market) · a curva realizada surge conforme as posições fecham.
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
