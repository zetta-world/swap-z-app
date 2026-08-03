"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * A COORTE DO ARBITER — o painel que responde "está indo bem mesmo?".
 *
 * Os três gêmeos correm a MESMA estratégia com alavancagens diferentes, e essa
 * é a única variável entre eles. Um placar lado a lado responderia "o 5× rende
 * mais em %", que é verdade e é enganoso: o lucro por ciclo em dólar é o mesmo,
 * e o que muda é o capital no denominador — mais a liquidação, que o placar não
 * mostra porque ela ainda não aconteceu.
 *
 * Por isso as MARCAS vêm antes dos números, e não depois. Quando existe marca
 * fatal, o painel diz que o resultado não é legível como desempenho — o que é
 * diferente de dizer que a mesa deu prejuízo.
 */

type Flag = { id: string; level: "fatal" | "aviso" | "ok"; title: string; finding: string; meaning: string };
type Desk = {
  source: string; label: string; leverage: number; startingUsd: number;
  cycles: number; losses: number; realizedUsd: number; avgPnlUsd: number;
  marginPerCycleUsd: number; hoursLive: number; cashUsd: number | null;
};
type Data = {
  desks: Desk[]; flags: Flag[]; readable: boolean;
  gatePct: number; minSpreadPct: number | null; liquidations: number; legs: number;
  venues: Array<{ venue: string; compras: number; vendas: number; total: number }>;
  ranAt: string;
};

const COR: Record<Flag["level"], string> = {
  fatal: "var(--adm-red)", aviso: "var(--adm-amber)", ok: "var(--adm-ink-3)",
};
const ICONE: Record<Flag["level"], string> = { fatal: "✕", aviso: "⚠", ok: "·" };

export default function ArbiterCohortPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/arbiter-cohort");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setErr(null);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <TerminalPanel
      id="arbiter-cohort" title="COORTE DO ARBITER"
      subtitle="1× · 3× · 5× — mesma estratégia, uma variável só: a alavanca"
      icon="ᚼ" source="supabase/paper_positions"
    >
      {loading && <div className="adm-shimmer" style={{ height: 120 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{err}</div>}

      {d && (
        <div>
          {/* O VEREDITO PRIMEIRO. Um placar antes das marcas convidaria a ler o
              número como desempenho, que é exatamente o erro em questão. */}
          <div style={{
            border: `1px solid ${d.readable ? "var(--adm-green)" : "var(--adm-red)"}`,
            borderRadius: 4, padding: "7px 9px", marginBottom: 10,
            fontSize: 10, lineHeight: 1.6,
            color: d.readable ? "var(--adm-green)" : "var(--adm-red)",
          }}>
            {d.readable
              ? "✓ a coorte é legível — os números abaixo podem ser lidos como desempenho"
              : "✕ NÃO É LEGÍVEL COMO DESEMPENHO"}
            {!d.readable && (
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 3 }}>
                Isto não quer dizer que a mesa deu prejuízo — quer dizer que o lucro que ela
                mostra não foi medido contra o risco que ela corre. &quot;Não medido&quot; e &quot;ruim&quot;
                são coisas diferentes, e tratar as duas igual leva a desligar coisa boa e a
                confiar em coisa não verificada com o mesmo gesto.
              </div>
            )}
          </div>

          {d.flags.map((f) => (
            <div key={f.id} style={{ borderTop: "1px solid var(--adm-border)", padding: "5px 0", fontSize: 9, lineHeight: 1.6 }}>
              <div style={{ color: COR[f.level] }}>{ICONE[f.level]} {f.title}</div>
              <div style={{ fontSize: 8, color: "var(--adm-ink-3)", paddingLeft: 12 }}>{f.finding}</div>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", paddingLeft: 12, fontStyle: "italic" }}>{f.meaning}</div>
            </div>
          ))}

          <table className="adm-table" style={{ marginTop: 10 }}>
            <thead><tr><th>MESA</th><th>CICLOS</th><th>$/CICLO</th><th>MARGEM</th><th>REALIZADO</th><th>VIDA</th></tr></thead>
            <tbody>
              {d.desks.map((k) => (
                <tr key={k.source}>
                  <td style={{ color: "var(--adm-ink-2)" }}>{k.leverage}× {k.label}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {k.cycles}
                    {k.cycles > 0 && k.losses === 0 && (
                      <span style={{ color: "var(--adm-red)", fontSize: 7 }}> · 0 perdas</span>
                    )}
                  </td>
                  {/* A COLUNA QUE RESPONDE A PERGUNTA. Se ela for igual nos três,
                      a alavanca não está ganhando mais — está dividindo por menos. */}
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--adm-cyan)" }}>
                    ${k.avgPnlUsd.toFixed(3)}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--adm-ink-4)" }}>
                    ${k.marginPerCycleUsd.toFixed(0)}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: k.realizedUsd >= 0 ? "var(--adm-green)" : "var(--adm-red)" }}>
                    {k.realizedUsd >= 0 ? "+" : "−"}${Math.abs(k.realizedUsd).toFixed(2)}
                  </td>
                  <td style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>
                    {k.hoursLive < 48 ? `${k.hoursLive.toFixed(1)}h` : `${(k.hoursLive / 24).toFixed(0)}d`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ONDE está a concentração. A marca diz QUE existe; conferir na
              corretora exige saber qual. */}
          {d.venues.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 8, color: "var(--adm-ink-4)", lineHeight: 1.6 }}>
              <div style={{ color: "var(--adm-ink-3)" }}>pernas por venue ({d.legs} no total):</div>
              {d.venues.slice(0, 6).map((v) => (
                <div key={v.venue}>
                  · {v.venue}: {v.compras} compra(s) × {v.vendas} venda(s)
                  {" "}({Math.round((v.total / (d.legs * 2)) * 100)}% das pernas)
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 7, color: "var(--adm-ink-4)", fontStyle: "italic", lineHeight: 1.6 }}>
            Portão de entrada: {d.gatePct.toFixed(2)}% (custo + líquido mínimo){" "}
            {d.minSpreadPct != null && `· menor spread visto: ${d.minSpreadPct.toFixed(4)}%`}
            {" "}· {d.liquidations} liquidação(ões) na amostra. O portão é derivado das mesmas
            variáveis que a mesa usa — redigitá-lo aqui faria esta tela envelhecer em silêncio
            no dia em que alguém mudasse o custo.
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
