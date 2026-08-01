"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type Criterion = { id: string; name: string; pass: boolean; pending: boolean; detail: string; why: string };
type Desk = {
  source: string; name: string; criteria: Criterion[];
  passed: boolean; pending: number;
  usdt: number; startingUsd: number; decided: number;
};
type Report = { desks: Desk[]; anyPassed: boolean; verdict: string; measuredAt: string };

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function mark(c: Criterion): { icon: string; color: string } {
  if (c.pending) return { icon: "◌", color: "var(--adm-amber)" };
  return c.pass ? { icon: "✓", color: "var(--adm-green)" } : { icon: "✕", color: "var(--adm-red)" };
}

export default function LaunchGatePanel() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/launch-gate");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setErr(null);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 300_000); return () => clearInterval(t); }, [load]);

  return (
    <TerminalPanel
      id="launch-gate"
      title="BARRA DE LANÇAMENTO"
      subtitle="critério pré-registrado · 5 de 5 ou não vai"
      icon="🚦"
      source="docs/PLANO-BARRA-DE-LANCAMENTO.md"
    >
      <div style={{ fontSize: 8, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 8 }}>
        Registrado em 30/07, ANTES dos dados. Depois que o número aparece é humano demais
        racionalizar — a barra escrita antes é a defesa contra isso. Conjunção, não média:
        4 de 5 reprova. Pendente (◌) nunca conta como aprovado.
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 80 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{err}</div>}

      {data && (
        <div>
          <div style={{
            fontSize: 9, padding: "7px 9px", borderRadius: 3, marginBottom: 10, lineHeight: 1.5,
            color: data.verdict.startsWith("🟢") ? "var(--adm-green)"
              : data.verdict.startsWith("🟡") ? "var(--adm-amber)" : "var(--adm-red)",
            background: "var(--adm-bg-raise)",
          }}>
            {data.verdict}
          </div>

          {data.desks.map((d) => {
            const isOpen = open === d.source;
            const ok = d.criteria.filter((c) => c.pass && !c.pending).length;
            return (
              <div key={d.source} style={{ marginBottom: 6, borderLeft: `2px solid ${d.passed ? "var(--adm-green)" : "var(--adm-border)"}`, paddingLeft: 7 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer" }}
                     onClick={() => setOpen(isOpen ? null : d.source)}>
                  <span style={{ fontSize: 10, color: "var(--adm-ink-2)", flex: 1 }}>{d.name}</span>
                  <span style={{ fontSize: 9, color: d.passed ? "var(--adm-green)" : "var(--adm-ink-3)" }}>
                    {ok}/5
                  </span>
                  <span style={{ fontSize: 9, color: "var(--adm-ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {usd(d.usdt)}
                  </span>
                  <span style={{ fontSize: 7, color: "var(--adm-ink-4)" }}>{isOpen ? "▲" : "▼"}</span>
                </div>

                {d.criteria.map((c) => {
                  const m = mark(c);
                  return (
                    <div key={c.id} style={{ marginTop: 3 }}>
                      <div style={{ display: "flex", gap: 6, fontSize: 8 }}>
                        <span style={{ color: m.color, width: 9 }}>{m.icon}</span>
                        <span style={{ color: "var(--adm-ink-3)", flex: 1 }}>{c.name}</span>
                        <span style={{ color: m.color, textAlign: "right" }}>{c.detail}</span>
                      </div>
                      {isOpen && (
                        <div style={{ fontSize: 7, color: "var(--adm-ink-4)", paddingLeft: 15, fontStyle: "italic", lineHeight: 1.5 }}>
                          {c.why}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 10, fontStyle: "italic", lineHeight: 1.6 }}>
            Se nenhuma passar, a plataforma lança SEM as mesas de trade — o agregador entrega
            valor real sem prever nada: melhor execução (slippage retido é dinheiro retido),
            proteção (quem não perde num honeypot ganhou) e disciplina. Receita é assinatura,
            não taxa por volume: dá pra dizer &quot;hoje não opere&quot;. Quem vive de taxa não pode.
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
