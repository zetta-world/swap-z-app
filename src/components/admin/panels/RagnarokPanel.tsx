"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type Wallet = {
  source: string; name: string; who: string | null; brain: string | null;
  startingUsd: number; usdt: number; realizedPnl: number; growthPct: number;
  closedTrades: number; openPositions: number;
};
type Row = {
  playbook: string; trades: number; open: number; decided: number;
  wins: number; losses: number; winRate: number | null; netPerTrade: number | null;
};
type Desk = { source: string; name: string; brain: string | null; venue: string | null; variable: string | null; trades: number; open: number; decided: number; winRate: number | null; netPerTrade: number | null; byPlaybook: Row[] };
type BrainHealth = { ticks24h: number; ranCount: number; contaminated: boolean; lastFallback: string | null; note: string };
type RG = { wallets: Wallet[]; playbooks: Row[]; desks: Desk[]; note: string; brainHealth?: BrainHealth };

const PLAYBOOK_LABEL: Record<string, string> = {
  range_reversion: "RANGE · compra o suporte",
  trend_pullback: "PULLBACK · compra o recuo",
  capitulation_reversal: "REVERSÃO · exaustão no fundo",
  launch_shot: "LANÇAMENTO · pool recém-nascido",
};
const col = (n: number) => (n >= 0 ? "var(--adm-green)" : "var(--adm-red)");
const pct = (n: number | null, d = 2) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`);

const PERIODS: { label: string; days: number | null }[] = [
  { label: "24H", days: 1 }, { label: "7D", days: 7 }, { label: "30D", days: 30 }, { label: "TUDO", days: null },
];

export default function RagnarokPanel() {
  const [data, setData] = useState<RG | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<number | null>(7);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/ragnarok${days ? `?days=${days}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); const t = setInterval(load, 180_000); return () => clearInterval(t); }, [load]);

  return (
    <TerminalPanel id="ragnarok" title="RAGNARÖK" subtitle="acumulação de USDT · mecânico vs IA · qual estratégia paga" icon="ᚱ" source="zion_suggestions/strat_*">
      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {PERIODS.map((p) => (
          <button key={p.label} className={`adm-toggle ${days === p.days ? "active" : ""}`}
            style={{ fontSize: 8, padding: "2px 6px" }}
            onClick={() => { setDays(p.days); setLoading(true); }}>{p.label}</button>
        ))}
      </div>

      {data && (
        <div>
          {/* A RÉGUA: USDT na mão. É o mandato da mesa, então vem primeiro. */}
          <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "var(--adm-gold)", marginBottom: 5 }}>
            ᚠ USDT ACUMULADO — a régua desta mesa
          </div>
          {data.wallets.length === 0 && (
            <div style={{ fontSize: 10, color: "var(--adm-ink-3)", marginBottom: 10 }}>
              Carteiras ainda não abertas — elas surgem no primeiro tick com <code>pause_paper=false</code>.
            </div>
          )}
          {data.wallets.map((w) => (
            <div key={w.source} style={{ marginBottom: 8, padding: "6px 8px", background: "var(--adm-bg-raise)", borderRadius: 3,
              borderLeft: `2px solid ${w.brain === "none" ? "var(--adm-cyan)" : "var(--adm-gold)"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 10, color: "var(--adm-ink-2)" }}>
                  {w.name} <span style={{ fontSize: 7, color: "var(--adm-ink-4)" }}>{w.brain === "none" ? "· sem IA (controle)" : "· com IA"}</span>
                </span>
                <span style={{ fontSize: 12, color: col(w.realizedPnl), fontVariantNumeric: "tabular-nums" }}>
                  ${Math.round(w.usdt).toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span>partiu de ${Math.round(w.startingUsd).toLocaleString()}</span>
                <span style={{ color: col(w.growthPct) }}>{pct(w.growthPct, 1)}</span>
                <span>{w.closedTrades} fechados · {w.openPositions} abertos</span>
              </div>
              {w.who && <div style={{ fontSize: 7, color: "var(--adm-ink-4)", fontStyle: "italic", marginTop: 2 }}>{w.who}</div>}
            </div>
          ))}

          {/* QUAL ESTRATÉGIA PAGA — a pergunta que o funil antigo impedia de fazer. */}
          <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "var(--adm-cyan)", margin: "12px 0 4px" }}>
            ᛃ QUAL ESTRATÉGIA PAGA
          </div>
          {data.playbooks.length === 0 ? (
            <div style={{ fontSize: 9, color: "var(--adm-ink-3)" }}>Nenhum plano emitido ainda nesta janela.</div>
          ) : (
            <table className="adm-table" style={{ width: "100%", fontSize: 9 }}>
              <thead><tr>
                <th style={{ textAlign: "left" }}>PLAYBOOK</th><th>LÍQ./TRADE</th><th>WR</th><th>DEC</th><th>ABERTOS</th>
              </tr></thead>
              <tbody>
                {data.playbooks.map((p) => (
                  <tr key={p.playbook}>
                    <td style={{ color: "var(--adm-ink-2)" }}>{PLAYBOOK_LABEL[p.playbook] ?? p.playbook}</td>
                    <td style={{ color: p.netPerTrade == null ? "var(--adm-ink-3)" : col(p.netPerTrade), fontVariantNumeric: "tabular-nums" }}>{pct(p.netPerTrade)}</td>
                    <td>{p.winRate == null ? "—" : `${(p.winRate * 100).toFixed(0)}%`}</td>
                    <td style={{ textAlign: "center" }}>{p.decided}</td>
                    <td style={{ textAlign: "center", color: "var(--adm-ink-3)" }}>{p.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* SAÚDE DO CÉREBRO — vem ANTES do duelo de propósito: se a IA não
              decidiu, o duelo abaixo não significa nada e isso precisa ser lido
              primeiro, não descoberto depois. */}
          {data.brainHealth && data.brainHealth.ticks24h > 0 && (
            <div style={{
              fontSize: 8, lineHeight: 1.5, padding: "5px 8px", borderRadius: 3, marginTop: 12,
              color: data.brainHealth.contaminated ? "var(--adm-red)"
                : data.brainHealth.ranCount === data.brainHealth.ticks24h ? "var(--adm-ink-4)" : "var(--adm-amber)",
              background: data.brainHealth.contaminated ? "rgba(255 60 60 / 0.07)" : "transparent",
              borderLeft: `2px solid ${data.brainHealth.contaminated ? "var(--adm-red)" : "var(--adm-border)"}`,
            }}>
              {data.brainHealth.contaminated
                ? `🚨 EXPERIMENTO CONTAMINADO — a IA não decidiu em NENHUM tick nas últimas 24h. O MÍMIR está gravando o plano do VÖLUNDR sob o próprio nome, então o duelo abaixo compara o ferreiro com ele mesmo.${data.brainHealth.lastFallback ? ` Causa: ${data.brainHealth.lastFallback}.` : ""}`
                : data.brainHealth.note}
            </div>
          )}

          {/* MECÂNICO vs IA — o duelo do experimento. */}
          <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "var(--adm-cyan)", margin: "12px 0 4px" }}>
            ⚔︎ O DUELO — uma variável por mesa, mesmo seletor
          </div>
          {data.desks.map((d) => (
            <div key={d.source} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 8, fontSize: 9, alignItems: "baseline" }}>
                <span style={{ color: d.brain === "none" ? "var(--adm-cyan)" : "var(--adm-gold)", flex: 1 }}>{d.name}</span>
                <span style={{ color: d.netPerTrade == null ? "var(--adm-ink-3)" : col(d.netPerTrade), fontVariantNumeric: "tabular-nums" }}>{pct(d.netPerTrade)}</span>
                <span style={{ color: "var(--adm-ink-4)", width: 60, textAlign: "right" }}>{d.decided} dec.</span>
              </div>
              {d.variable && (
                <div style={{ fontSize: 7, color: "var(--adm-ink-4)", paddingLeft: 8 }}>{d.variable}</div>
              )}
              {d.byPlaybook.length > 0 && (
                <div style={{ fontSize: 7, color: "var(--adm-ink-4)", paddingLeft: 8, marginTop: 1 }}>
                  {d.byPlaybook.map((p) => `${(PLAYBOOK_LABEL[p.playbook] ?? p.playbook).split(" ")[0]} ${p.trades}×`).join(" · ")}
                </div>
              )}
            </div>
          ))}

          <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 10, fontStyle: "italic" }}>
            {data.note}
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
