"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * FUNDING / BASIS — o que sobrou depois de a arbitragem spot-spot ser reprovada.
 *
 * O dono perguntou: "então quer dizer que é impossível lucrar com arbitragem?"
 * A resposta honesta é que uma FORMA foi reprovada — a nossa, spot-spot entre
 * CEXes, que perde para velocidade. Esta é a outra: comprado no spot, vendido
 * no perpétuo, colhendo o funding a cada 8h. Não depende de milissegundo.
 *
 * ⚠️ AS DUAS COLUNAS QUE IMPEDEM A LEITURA ERRADA SÃO "LÍQUIDO" E "% NEG".
 *
 * O anualizado é a unidade em que o mercado fala, e é a que mais engana: ele
 * extrapola a janela medida 365 dias adentro assumindo que o regime não muda.
 * O que aconteceu de verdade é o LÍQUIDO da janela, depois das 4 pernas.
 *
 * E "% neg" separa renda de ESTRUTURA de renda de REGIME. Funding positivo na
 * média com metade dos períodos negativo quer dizer que a renda existe
 * enquanto o mercado estiver comprado — e mercado comprado vira.
 */

type Simbolo = {
  symbol: string; periods: number; days: number;
  meanPct: number; medianPct: number; annualizedPct: number;
  grossPct: number; netPct: number; negativeShare: number;
  maxDrawdownPct: number; breakEvenDays: number | null; worstNegativeStreak: number;
};

type Dados = {
  resumo: {
    simbolos: number; comAmostra: number; janelaDias: number; custoPct: number;
    medianaLiquidaPct: number | null; medianaBrutaPct: number | null;
    medianaAnualizadaPct: number | null;
    positivosLiquidos: number; robustos: number;
    medianaNegativeShare: number | null; piorTomboPct: number | null;
    rho: number | null; apostasEfetivas: number;
    /** ⚠️ A janela entregue é a pedida? Ver a nota no route.ts. */
    paginacaoCortada?: boolean;
    janelaPedidaDias?: number;
    diasMedianos?: number | null;
    medianaLiquidaAnualPct?: number | null;
    semAmostra?: number;
  };
  veredito: { readable: boolean; verdict: string; positivos: number; total: number };
  /** Quantos símbolos vieram de cada corretora. Ver a nota no route.ts. */
  fontes: Record<string, number>;
  falhasPorStatus: string | null;
  porSimbolo: Simbolo[];
  naoMedido: string[];
  aviso: string; tookMs: number;
};

const pct = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;

export default function FundingPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [rodando, setRodando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/funding", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  return (
    <TerminalPanel
      id="funding" title="FUNDING / BASIS"
      subtitle="comprado no spot + vendido no perpétuo — renda neutra, sem depender de velocidade"
      icon="🪙" source="binance/fundingRate (histórico realizado)"
    >
      <div style={{ fontSize: 9, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
        A arbitragem spot-spot foi reprovada por velocidade: o spread entre CEXes vive
        milissegundos e a mesa olha a cada minuto. O funding não tem esse problema — é
        publicado, muda a cada 8h, e é fluxo de caixa contratual, não ineficiência a
        capturar. A pergunta é só se ele paga as 4 pernas.
      </div>

      <button className="adm-btn" onClick={rodar} disabled={rodando}>
        {rodando ? "lendo o histórico de funding…" : "🪙 MEDIR O FUNDING · janela do laboratório"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginTop: 6 }}>{err}</div>}

      {d && (
        <div style={{ marginTop: 10 }}>
          {/* O VEREDITO PRIMEIRO, antes de qualquer número — a mesma ordem da
              coorte. Placar antes do veredito convida a ler retorno como
              aprovação. */}
          <div style={{
            border: `1px solid ${d.veredito.readable ? "var(--adm-border)" : "var(--adm-amber)"}`,
            borderRadius: 4, padding: "7px 9px", marginBottom: 10,
            fontSize: 10, lineHeight: 1.6,
            color: d.veredito.readable ? "var(--adm-ink-2)" : "var(--adm-amber)",
          }}>
            {d.veredito.verdict}
          </div>

          {/* ⚠️ A JANELA ENTREGUE, não a pedida. Janela curta silenciosa foi a
                 causa raiz da medição de 04/08 que deu 1,4% — a fonte devolveu
                 30-60 dias enquanto a tela dizia 174. */}
          {d.resumo.paginacaoCortada && (
            <div style={{
              border: "1px solid var(--adm-red)", borderRadius: 3, padding: "5px 7px",
              marginBottom: 8, fontSize: 8.5, color: "var(--adm-red)", lineHeight: 1.6,
            }}>
              ⚠️ A PAGINAÇÃO FOI CORTADA POR TEMPO. A janela entregue é <b>menor</b> que os{" "}
              {d.resumo.janelaPedidaDias} dias pedidos — o número abaixo vale menos do que
              parece. Rodar de novo, ou reduzir a lista de símbolos.
            </div>
          )}

          <div style={{ fontSize: 9, color: "var(--adm-ink-3)", lineHeight: 1.7, marginBottom: 8 }}>
            {d.resumo.comAmostra} símbolos com amostra
            {d.resumo.semAmostra != null && d.resumo.semAmostra > 0 && (
              <span style={{ color: "var(--adm-amber)" }}>
                {" "}(+{d.resumo.semAmostra} descartados por janela curta)
              </span>
            )}
            {" · "}janela pedida <b>{d.resumo.janelaDias}d</b>
            {d.resumo.diasMedianos != null && (
              <>
                {" · "}<b style={{
                  color: d.resumo.diasMedianos >= d.resumo.janelaDias * 0.8
                    ? "var(--adm-green)" : "var(--adm-amber)",
                }}>
                  entregue {Math.round(d.resumo.diasMedianos)}d
                </b>
              </>
            )}
            {" · "}custo das 4 pernas {d.resumo.custoPct}%
            <div>
              mediana LÍQUIDA da janela:{" "}
              <b style={{
                color: (d.resumo.medianaLiquidaPct ?? 0) > 0 ? "var(--adm-green)" : "var(--adm-red)",
              }}>
                {pct(d.resumo.medianaLiquidaPct)}
              </b>
              {" · "}bruta {pct(d.resumo.medianaBrutaPct)}
              {" · "}anualizado (extrapolação) {pct(d.resumo.medianaAnualizadaPct, 1)}
            </div>
            <div>
              positivos no líquido: <b>{d.resumo.positivosLiquidos}</b>/{d.resumo.comAmostra}
              {" · "}destes, com negativo raro:{" "}
              <b style={{ color: d.resumo.robustos > 0 ? "var(--adm-green)" : "var(--adm-red)" }}>
                {d.resumo.robustos}
              </b>
            </div>
            {/* DE ONDE VEIO O DADO. A primeira rodada falhou inteira porque o
                host de futuros da Binance recusa IP de datacenter, e o evento
                gravado não sabia dizer isso. Fonte na tela para "funcionou" e
                "funcionou pela metade" não ficarem iguais. */}
            <div style={{ color: "var(--adm-ink-4)", fontSize: 8 }}>
              fonte:{" "}
              {Object.entries(d.fontes).map(([f, n]) => `${f} ${n}`).join(" · ") || "—"}
              {d.falhasPorStatus && ` · recusas: ${d.falhasPorStatus}`}
            </div>
            {d.resumo.rho != null && (
              <div style={{ color: "var(--adm-amber)" }}>
                correlação {Math.round(d.resumo.rho * 100)}% entre os fundings —
                equivalem a <b>{d.resumo.apostasEfetivas.toFixed(1)}</b> apostas independentes,
                não {d.resumo.comAmostra}
              </div>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "3px 5px" }}>SÍMBOLO</th>
                  <th style={{ padding: "3px 5px" }}>LÍQUIDO</th>
                  <th style={{ padding: "3px 5px" }}>BRUTO</th>
                  <th style={{ padding: "3px 5px" }}>ANUAL.</th>
                  <th style={{ padding: "3px 5px" }}>% NEG</th>
                  <th style={{ padding: "3px 5px" }}>TOMBO</th>
                  <th style={{ padding: "3px 5px" }}>EQUIL.</th>
                  <th style={{ padding: "3px 5px" }}>DIAS</th>
                </tr>
              </thead>
              <tbody>
                {d.porSimbolo.slice(0, 30).map((s) => (
                  <tr key={s.symbol} style={{ borderTop: "1px solid var(--adm-border)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "3px 5px", color: "var(--adm-ink-2)" }}>
                      {s.symbol}
                    </td>
                    <td style={{
                      padding: "3px 5px",
                      color: s.netPct > 0 ? "var(--adm-green)" : "var(--adm-red)",
                    }}>
                      <b>{pct(s.netPct)}</b>
                    </td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-3)" }}>{pct(s.grossPct)}</td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                      {pct(s.annualizedPct, 1)}
                    </td>
                    <td style={{
                      padding: "3px 5px",
                      color: s.negativeShare > 0.35 ? "var(--adm-red)" : "var(--adm-ink-3)",
                    }}>
                      {Math.round(s.negativeShare * 100)}%
                    </td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                      −{s.maxDrawdownPct.toFixed(2)}%
                    </td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                      {s.breakEvenDays == null ? "nunca" : `${Math.round(s.breakEvenDays)}d`}
                    </td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>{Math.round(s.days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* O QUE NÃO FOI MEDIDO, na tela e não só no código. Omissão que só
              existe no comentário vira, semanas depois, um número que alguém
              leu como completo. */}
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 8, lineHeight: 1.7 }}>
            <div style={{ color: "var(--adm-amber)" }}>⚠️ NÃO está nesta conta:</div>
            {d.naoMedido.map((n) => <div key={n}>· {n}</div>)}
            <div style={{ marginTop: 4 }}>
              LÍQUIDO = funding somado na janela menos as 4 pernas. EQUIL. = dias de funding
              médio só para pagar as pernas. ANUAL. é EXTRAPOLAÇÃO da janela, não medição.
              {" · "}{d.resumo.simbolos} símbolos lidos · {(d.tookMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
