"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * CUSTO DE IA — extraído do painel de finanças em 30/07.
 *
 * Vivia como um terço de um card com sub-abas. Mas é o número que aposentou o
 * assento Anthropic, é o que os kill-switches em CONTROLES governam e é o que o
 * watchdog vigia com teto diário. Um custo com essa importância operacional não
 * pode depender de alguém lembrar de clicar numa sub-aba.
 */

type Model = { model: string; today: number; week: number; month: number; all: number; calls: number };
type Fin = {
  ai: {
    today: number; week: number; month: number; year: number; all: number;
    calls: { today: number; week: number; month: number; year: number; all: number };
    bySource: Record<string, number>;
    models: Model[];
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
    daily: Array<{ date: string; cost: number }>;
    monthProjection: number;
  };
};

const usd  = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;
const usd4 = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const compact = (m: string) => m.replace(/^claude-/, "").replace(/-\d{8}$/, "");

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 7, color: "var(--adm-ink-4)", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 11, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Bars({ daily }: { daily: Array<{ date: string; cost: number }> }) {
  if (!daily?.length) return <div style={{ fontSize: 9, color: "var(--adm-ink-3)" }}>sem gasto registrado</div>;
  const max = Math.max(...daily.map((d) => d.cost), 0.0001);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 34, marginTop: 4 }}>
      {daily.slice(-14).map((d) => (
        <div key={d.date} title={`${d.date}: ${usd4(d.cost)}`}
          style={{
            flex: 1, height: `${Math.max(2, (d.cost / max) * 100)}%`, borderRadius: 1,
            background: d.cost > 0 ? "var(--adm-gold)" : "var(--adm-border)", opacity: 0.75,
          }} />
      ))}
    </div>
  );
}

export default function AiCostPanel() {
  const [d, setD] = useState<Fin | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/finance");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setErr(null);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 300_000); return () => clearInterval(t); }, [load]);

  return (
    <TerminalPanel id="ai-cost" title="CUSTO DE IA" subtitle="gasto por modelo · projeção do mês" icon="💸" source="platform_events/zion_analysis">
      {loading && <div className="adm-shimmer" style={{ height: 80 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{err}</div>}

      {d && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Stat label="HOJE"    value={usd4(d.ai.today)} color="var(--adm-gold)" />
            <Stat label="7 DIAS"  value={usd4(d.ai.week)}  color="var(--adm-ink)" />
            <Stat label="MÊS"     value={usd4(d.ai.month)} color="var(--adm-ink)" />
            <Stat label="PROJ. MÊS" value={usd4(d.ai.monthProjection)} color="var(--adm-gold)" />
          </div>

          <div className="adm-category">Gasto diário · 14 dias</div>
          <Bars daily={d.ai.daily} />

          <div className="adm-category" style={{ marginTop: 12 }}>Por modelo</div>
          {/* Esta ressalva não é rodapé — é o que impede a leitura errada. Já
              houve um caso de "gasto" alto de um modelo em crédito de trial. */}
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginBottom: 6, lineHeight: 1.5 }}>
            ≈ ESTIMATIVA: tokens medidos × tarifa pública. NÃO é a fatura. Um modelo em
            crédito de trial aparece com &quot;gasto&quot; sem sair dinheiro da conta.
          </div>
          {d.ai.models.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>nenhuma chamada ainda</div>
          ) : (
            <table className="adm-table" style={{ fontSize: 9 }}>
              <thead><tr>
                <th style={{ textAlign: "left" }}>MODELO</th>
                <th style={{ textAlign: "right" }}>HOJE</th>
                <th style={{ textAlign: "right" }}>MÊS</th>
                <th style={{ textAlign: "right" }}>TOTAL</th>
                <th style={{ textAlign: "right" }}>CHAMADAS</th>
              </tr></thead>
              <tbody>
                {d.ai.models.map((m) => (
                  <tr key={m.model}>
                    <td style={{ color: "var(--adm-violet)", fontFamily: "monospace" }}>{compact(m.model)}</td>
                    <td style={{ textAlign: "right", color: m.today > 0 ? "var(--adm-gold)" : "var(--adm-ink-3)" }}>{usd4(m.today)}</td>
                    <td style={{ textAlign: "right" }}>{usd4(m.month)}</td>
                    <td style={{ textAlign: "right", color: "var(--adm-ink)" }}>{usd(m.all)}</td>
                    <td style={{ textAlign: "right", color: "var(--adm-ink-3)" }}>{m.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 8, fontStyle: "italic", lineHeight: 1.6 }}>
            Quem liga e desliga cada consumidor está em CONTROLES · o teto que dispara alerta
            está no watchdog · a subtração contra a receita está em MARGEM.
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
