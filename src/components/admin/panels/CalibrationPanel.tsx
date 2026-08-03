"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * VARREDURA DE CALIBRAGEM — "estamos conservadores demais?", com número.
 *
 * O dono levantou a hipótese: "focamos tanto em ser conservador que os níveis de
 * pessimista e otimista não estão bem calibrados". Discutir isso sem poder variar
 * o parâmetro é chute com vocabulário técnico.
 *
 * ⚠️ A COLUNA QUE IMPEDE A LEITURA ERRADA É O TOTAL, NÃO A MÉDIA.
 *
 * Uma trava que melhora o líquido POR TRADE cortando 90% dos trades não melhorou
 * nada — ela escolheu a dedo. Na varredura sintética o "stop 2.5× ATR" apareceu
 * com +0.227% por trade e só oito trades, contra −0.423% em 199. Lado a lado o
 * engano não sobrevive; a média sozinha o venderia como descoberta.
 */

type Linha = {
  nome: string; oQueMuda: string; trades: number;
  netPerTrade: number | null; totalPct: number; winRate: number | null;
  porPlaybook: Array<{ playbook: string; n: number; net: number | null }>;
};
type Dados = {
  linhas: Linha[]; symbols: string[]; windowDays: number;
  aviso: string; tookMs: number;
};

const pct = (n: number | null, d = 3) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`);

export default function CalibrationPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [rodando, setRodando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/calibration", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  const base = d?.linhas[0];

  return (
    <TerminalPanel
      id="calibration" title="CALIBRAGEM"
      subtitle="a mesma janela com travas diferentes — qual cautela custa caro"
      icon="🎚" source="binance/klines + bracket.ts"
    >
      <div style={{ fontSize: 9, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 10 }}>
        Roda a MESMA janela, sobre os MESMOS dados, mexendo em UMA trava por vez. Variar duas
        de uma vez devolveria um resultado sem dono — não daria para saber qual moveu.
      </div>

      <button className="adm-btn" onClick={rodar} disabled={rodando}>
        {rodando ? "varrendo…" : "🎚 varrer a calibragem"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginTop: 8 }}>{err}</div>}

      {d && (
        <div style={{ marginTop: 12 }}>
          {/* O aviso vem ANTES da tabela. Adotar o melhor número de uma varredura
              é o caminho mais curto para o sobreajuste, e um rodapé não segura
              ninguém que já viu um verde na tela. */}
          <div style={{
            fontSize: 9, color: "var(--adm-amber)", lineHeight: 1.6,
            border: "1px solid var(--adm-border)", borderRadius: 4, padding: "6px 8px", marginBottom: 10,
          }}>
            ⚠ {d.aviso}
          </div>

          <table className="adm-table">
            <thead><tr><th>TRAVA</th><th>TRADES</th><th>LÍQ/TRADE</th><th>TOTAL</th><th>ACERTO</th></tr></thead>
            <tbody>
              {d.linhas.map((l) => {
                const melhorQueBase = base && (l.netPerTrade ?? -9) > (base.netPerTrade ?? -9);
                // Amostra que encolheu demais: a "melhora" é seleção a dedo.
                const amostraCaiu = base != null && l.trades < base.trades * 0.5;
                return (
                  <tr key={l.nome}>
                    <td style={{ color: l.nome.startsWith("padrão") ? "var(--adm-gold)" : "var(--adm-ink-2)" }}>
                      {l.nome}
                      <div style={{ fontSize: 7, color: "var(--adm-ink-4)" }}>{l.oQueMuda}</div>
                    </td>
                    <td style={{
                      fontVariantNumeric: "tabular-nums",
                      color: amostraCaiu ? "var(--adm-red)" : "var(--adm-ink-3)",
                    }}>
                      {l.trades}{amostraCaiu && <span style={{ fontSize: 7 }}> ⚠</span>}
                    </td>
                    <td style={{
                      fontVariantNumeric: "tabular-nums",
                      color: melhorQueBase && !amostraCaiu ? "var(--adm-green)" : "var(--adm-ink-3)",
                    }}>{pct(l.netPerTrade)}</td>
                    {/* O TOTAL é o juiz: média boa com amostra minúscula não paga conta. */}
                    <td style={{
                      fontVariantNumeric: "tabular-nums",
                      color: l.totalPct > 0 ? "var(--adm-green)" : "var(--adm-red)",
                    }}>{pct(l.totalPct, 1)}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--adm-ink-4)" }}>
                      {l.winRate == null ? "—" : `${(l.winRate * 100).toFixed(0)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 8, fontSize: 7, color: "var(--adm-ink-4)", fontStyle: "italic", lineHeight: 1.6 }}>
            ⚠ na coluna TRADES = a amostra caiu mais da metade contra o padrão. Quando isso
            acontece, um líquido/trade melhor não é melhora: é a trava escolhendo a dedo os
            trades que iam dar certo. Compare pelo TOTAL. · {d.symbols.length} símbolos ·
            janela ~{d.windowDays} dias · {(d.tookMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
