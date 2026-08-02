"use client";

import { useCallback, useEffect, useState } from "react";
import { DESKS } from "@/lib/zion/desks";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Recent = {
  symbol: string; side: string; status: string;
  outcome_pct: number | null; probability: number | null;
  regime: string | null; created_at: string;
};
type BT = {
  total: number; open: number; resolved: number; wins: number; losses: number; neutral: number;
  expired?: number;
  winRate: number | null; avgOutcome: number | null;
  expectancy: number | null; expectancyNet?: number | null;
  sufficientSample?: boolean; signalRate?: number | null;
  avgWin: number | null; avgLoss: number | null;
  profitFactor: number | null; avgRR: number | null;
  byRegime: Record<string, { wins: number; losses: number }>;
  recent: Recent[];
};

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "6px 8px" }}>
      <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 14, color, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function statusColor(s: string): string {
  if (s === "win" || s === "hit_target") return "var(--adm-green)";
  if (s === "loss" || s === "hit_stop")  return "var(--adm-red)";
  if (s === "open")                       return "var(--adm-ink-3)";
  return "var(--adm-gold)"; // neutral / expired
}

// Filtro por mesa — ler a MESMA manchete de uma mesa só, em vez de tudo
// misturado. Os valores espelham a coluna `source` de `zion_suggestions`.
//
// ⚠️ CORREÇÃO 01/08 — ESTA LISTA ERA SÓ DE MORTOS.
//
// Ela estava escrita à mão com `A·ZION†`, `B·FERRARI`, `MISTRAL`, `DEEPSEEK`,
// `KIMI` e `GROK` — TODOS aposentados em 28/07. Nenhuma das mesas vivas
// (VÖLUNDR, SKAÐI, MÍMIR, FREYJA, ULLR) aparecia. Enquanto isso o número no
// topo do painel já era das mesas novas: manchete de hoje, filtro de um mês
// atrás. O dono abriu o painel, viu os dois juntos e não conseguiu dizer o que
// estava sendo medido — com razão.
//
// Agora sai de `DESKS`, a mesma fonte que o cron e o Ragnarök usam. Mesa nova
// aparece aqui sozinha; mesa aposentada migra para o grupo de arquivo sem
// ninguém precisar lembrar de editar dois arquivos.
const LIVE_SOURCES = DESKS.filter((d) => d.status === "live")
  .map((d) => ({ value: d.source, label: `${d.sigil} ${d.name}` }));
const ARCHIVED_SOURCES = DESKS.filter((d) => d.status === "valhalla")
  .map((d) => ({ value: d.source, label: `${d.name}†` }));

const SOURCES: { value: string; label: string }[] = [
  { value: "", label: "ALL" },
  ...LIVE_SOURCES,
  ...ARCHIVED_SOURCES,
];

const PERIODS: { label: string; days: number | null }[] = [
  { label: "24H", days: 1 },
  { label: "7D",  days: 7 },
  { label: "30D", days: 30 },
  { label: "TUDO", days: null },
];

export default function BacktestPanel() {
  const [data, setData] = useState<BT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"stats" | "feed">("stats");
  const [source, setSource] = useState("");
  // Default 7d — a lifetime headline can't show whether the last fix worked.
  const [days, setDays] = useState<number | null>(7);
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (source) qs.set("source", source);
      if (days) qs.set("days", String(days));
      const res = await fetch(`/admin/api/backtest${qs.toString() ? `?${qs}` : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [source, days]);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 180_000 : 120_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  return (
    <TerminalPanel id="backtest" title="BACKTEST" subtitle="ZION win-rate · expectancy" icon="◇" source="supabase/zion_suggestions">
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {(["stats", "feed"] as const).map((t) => (
          <button key={t} className={`adm-toggle ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {/* Janela de tempo (27/07) — a rodada viva acumula ERAS de config; sem
          recorte, uma correção nova some na média da era anterior. */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        {PERIODS.map((p) => (
          <button key={p.label}
            className={`adm-toggle ${days === p.days ? "active" : ""}`}
            style={{ fontSize: 8, padding: "2px 6px" }}
            onClick={() => { setDays(p.days); setLoading(true); }}>
            {p.label}
          </button>
        ))}
        <span style={{ fontSize: 7, color: "var(--adm-ink-4)" }}>por data do CARD</span>
      </div>
      {/* Agent filter — same stats, one agent at a time (R2.4). */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {SOURCES.map((s) => (
          <button key={s.value}
            className={`adm-toggle ${source === s.value ? "active" : ""}`}
            style={{ fontSize: 8, padding: "2px 6px" }}
            onClick={() => { setSource(s.value); setLoading(true); }}>
            {s.label}
          </button>
        ))}
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && tab === "stats" && (
        <div>
          {/* Headline: NET EXPECTANCY — the true edge AFTER fees + slippage
              (bakes in win-rate × size of wins vs losses, minus round-trip
              cost). A 50% win-rate with R:R<1, or a thin gross edge eaten by
              fees, is still negative. Gross shown beside it for reference. */}
          {(() => {
            const net = data.expectancyNet ?? data.expectancy;
            return (
              <div className="adm-stat" style={{ padding: "6px 0" }}>
                <span style={{ fontSize: 9, color: "var(--adm-ink-3)", flex: 1 }}>
                  NET EXPECTANCY / TRADE
                  {data.expectancy != null && data.expectancyNet != null && (
                    <span style={{ color: "var(--adm-ink-3)", opacity: 0.7 }}>{"  "}(gross {data.expectancy >= 0 ? "+" : ""}{data.expectancy.toFixed(2)}%)</span>
                  )}
                </span>
                <span style={{ fontSize: 18, color: net == null ? "var(--adm-ink-3)" : net >= 0 ? "var(--adm-green)" : "var(--adm-red)", fontVariantNumeric: "tabular-nums" }}>
                  {net == null ? "—" : `${net >= 0 ? "+" : ""}${net.toFixed(2)}%`}
                </span>
              </div>
            );
          })()}
          {/* Sample-size honesty: below the noise floor, the edge isn't
              trustworthy yet — flag it instead of letting a lucky 12-trade run
              read as signal (P1.5). */}
          {data.sufficientSample === false && (
            <div style={{ fontSize: 8, color: "var(--adm-gold)", letterSpacing: "0.04em", marginBottom: 4 }}>
              ⚠ AMOSTRA PEQUENA — {data.wins + data.losses} trades decididos, ainda ruído estatístico
            </div>
          )}
          <div style={{ display: "flex", gap: 8, margin: "6px 0 4px" }}>
            <Mini label="AVG R:R"        value={data.avgRR == null ? "—" : data.avgRR.toFixed(2)}
                  color={data.avgRR == null ? "var(--adm-ink-3)" : data.avgRR >= 1.5 ? "var(--adm-green)" : data.avgRR >= 1 ? "var(--adm-gold)" : "var(--adm-red)"} />
            <Mini label="PROFIT FACTOR"  value={data.profitFactor == null ? (data.losses === 0 && data.wins > 0 ? "∞" : "—") : data.profitFactor.toFixed(2)}
                  color={data.profitFactor == null ? "var(--adm-ink-3)" : data.profitFactor >= 1 ? "var(--adm-green)" : "var(--adm-red)"} />
            <Mini label="WIN RATE"       value={data.winRate == null ? "—" : `${(data.winRate * 100).toFixed(0)}%`}
                  color="var(--adm-ink)" />
          </div>
          <div className="adm-stat" style={{ padding: "4px 0" }}>
            <span style={{ fontSize: 9, color: "var(--adm-ink-3)", flex: 1 }}>AVG WIN / AVG LOSS</span>
            <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: "var(--adm-green)" }}>{data.avgWin == null ? "—" : `+${data.avgWin.toFixed(2)}%`}</span>
              <span style={{ color: "var(--adm-ink-3)" }}> / </span>
              <span style={{ color: "var(--adm-red)" }}>{data.avgLoss == null ? "—" : `${data.avgLoss.toFixed(2)}%`}</span>
            </span>
          </div>
          <table className="adm-table" style={{ marginTop: 8 }}>
            <tbody>
              <tr><td style={{ color: "var(--adm-green)" }}>wins</td><td>{data.wins}</td>
                  <td style={{ color: "var(--adm-red)" }}>losses</td><td>{data.losses}</td></tr>
              <tr><td style={{ color: "var(--adm-gold)" }}>expired</td><td>{data.expired ?? data.neutral}</td>
                  <td style={{ color: "var(--adm-ink-3)" }}>open</td><td>{data.open}</td></tr>
            </tbody>
          </table>

          {Object.keys(data.byRegime).length > 0 && (
            <table className="adm-table" style={{ marginTop: 10 }}>
              <thead><tr><th>REGIME</th><th>WINS</th><th>LOSSES</th><th>RATE</th></tr></thead>
              <tbody>
                {Object.entries(data.byRegime).map(([rg, v]) => {
                  const dec = v.wins + v.losses;
                  return (
                    <tr key={rg}>
                      <td style={{ color: "var(--adm-cyan)" }}>{rg}</td>
                      <td>{v.wins}</td><td>{v.losses}</td>
                      <td>{dec > 0 ? `${((v.wins / dec) * 100).toFixed(0)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && tab === "feed" && (
        <div className="adm-scroll" style={{ maxHeight: 280 }}>
          {data.recent.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No suggestions yet — the flywheel logs every 30 min.</div>
          ) : data.recent.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9, alignItems: "center" }}>
              <span style={{ color: "var(--adm-ink-3)", flexShrink: 0, whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <span style={{ color: r.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", flexShrink: 0, width: 30 }}>{r.side}</span>
              <span style={{ color: "var(--adm-ink)", flexShrink: 0, width: 48, fontFamily: "monospace" }}>{r.symbol}</span>
              <span style={{ color: statusColor(r.status), flex: 1 }}>{r.status}</span>
              <span style={{ color: "var(--adm-ink-3)", flexShrink: 0 }}>{r.probability != null ? `${r.probability}%` : ""}</span>
              <span style={{ color: (r.outcome_pct ?? 0) >= 0 ? "var(--adm-green)" : "var(--adm-red)", flexShrink: 0, width: 52, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.outcome_pct == null ? "" : `${r.outcome_pct >= 0 ? "+" : ""}${r.outcome_pct.toFixed(1)}%`}
              </span>
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}
