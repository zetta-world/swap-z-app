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
  /** ⚠️ O que decide, por símbolo: um ano menos UMA ida e volta. */
  netAnnualizedPct: number;
  grossPct: number; netPct: number; negativeShare: number;
  maxDrawdownPct: number; breakEvenDays: number | null; worstNegativeStreak: number;
};

type Dados = {
  resumo: {
    simbolos: number; comAmostra: number; janelaDias: number; custoPct: number;
    medianaLiquidaPct: number | null; medianaBrutaPct: number | null;
    medianaAnualizadaPct: number | null;
    /** ⚠️ A régua do veredito. Ver `fundingCounts` em funding.ts. */
    positivosNoAno: number; robustos: number; minRobustos?: number;
    /** Outra pergunta: pagou as 4 pernas DENTRO da janela entregue. */
    pagaramNaJanela?: number;
    medianaNegativeShare: number | null; piorTomboPct: number | null;
    rho: number | null; apostasEfetivas: number;
    /** ⚠️ A janela entregue é a pedida? Ver a nota no route.ts. */
    paginacaoCortada?: boolean;
    /** Curta porque a FONTE acabou — ação diferente de paginação cortada. */
    fonteEsgotada?: boolean;
    janelaPedidaDias?: number;
    diasMedianos?: number | null;
    medianaLiquidaAnualPct?: number | null;
    semAmostra?: number;
    /** Carimbo do último pagamento lido. Ver a nota `SEM_CACHE` no route.ts. */
    ultimoPontoEm?: string | null;
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

          {/* ⚠️ TETO DA FONTE ≠ CORTE NOSSO, e a ação é oposta (06/08).
                 Paginação cortada se resolve rodando de novo. Fonte esgotada
                 não se resolve: ou se aceita a janela, ou se troca de fonte.
                 Chamar as duas de "janela curta" faria alguém clicar de novo
                 por um ano que a fonte nunca vai entregar. */}
          {d.resumo.fonteEsgotada && !d.resumo.paginacaoCortada && (
            <div style={{
              border: "1px solid var(--adm-amber)", borderRadius: 3, padding: "5px 7px",
              marginBottom: 8, fontSize: 8.5, color: "var(--adm-amber)", lineHeight: 1.6,
            }}>
              ⚠️ A FONTE ESGOTOU, não fomos nós. A paginação rodou até o fim e o relógio
              não estourou — o histórico público simplesmente termina em{" "}
              <b>{Math.round(d.resumo.diasMedianos ?? 0)}d</b> dos{" "}
              {d.resumo.janelaPedidaDias}d pedidos. <b>Rodar de novo não muda.</b> O que muda
              é trocar de fonte, ou passar a acumular o funding aqui todo dia.
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
            {/* ⚠️ O NÚMERO QUE DECIDE, EM PRIMEIRO E EM CORPO MAIOR (06/08).
                   Ele era calculado, gravado em `lab_results` e NÃO aparecia na
                   tela: o destaque ia para o líquido da JANELA (+0,04%) e para
                   o anualizado BRUTO (+1,6%), enquanto o veredito julgava por
                   um terceiro número que ninguém via. Ver `netAnnualizedPct`. */}
            <div style={{ fontSize: 11, marginTop: 4 }}>
              LÍQUIDO POR ANO (o que decide):{" "}
              <b style={{
                fontSize: 14,
                color: (d.resumo.medianaLiquidaAnualPct ?? 0) > 0 ? "var(--adm-green)" : "var(--adm-red)",
              }}>
                {pct(d.resumo.medianaLiquidaAnualPct, 2)}
              </b>
              <span style={{ color: "var(--adm-ink-4)" }}>
                {" "}— mediana, um ano de funding menos UMA ida e volta
              </span>
            </div>
            <div>
              na janela entregue: líquido {pct(d.resumo.medianaLiquidaPct)}
              {" · "}bruto {pct(d.resumo.medianaBrutaPct)}
              {" · "}anualizado BRUTO {pct(d.resumo.medianaAnualizadaPct, 1)}
              <span style={{ color: "var(--adm-ink-4)" }}> (sem as pernas)</span>
            </div>
            {/* ⚠️ AS DUAS CONTAGENS TÊM RÉGUAS DIFERENTES, e até 06/08 apareciam
                   com o mesmo nome. "23 de 50" no veredito contra "26/50" aqui
                   embaixo eram netAnnualized × netPct-da-janela, sem rótulo. */}
            <div>
              positivos NO ANO: <b>{d.resumo.positivosNoAno}</b>/{d.resumo.comAmostra}
              {" · "}destes, com negativo raro:{" "}
              <b style={{
                color: d.resumo.robustos >= (d.resumo.minRobustos ?? 10)
                  ? "var(--adm-green)" : "var(--adm-amber)",
              }}>
                {d.resumo.robustos}
              </b>
              <span style={{ color: "var(--adm-ink-4)" }}>
                {" "}(piso {d.resumo.minRobustos ?? 10} — abaixo disso é um nome de sorte, não cesta)
              </span>
              {d.resumo.pagaramNaJanela != null && (
                <div style={{ color: "var(--adm-ink-4)" }}>
                  outra pergunta: <b>{d.resumo.pagaramNaJanela}</b> pagaram as 4 pernas DENTRO
                  {" "}dos {Math.round(d.resumo.diasMedianos ?? 0)}d entregues
                </div>
              )}
            </div>
            {/* DE ONDE VEIO O DADO. A primeira rodada falhou inteira porque o
                host de futuros da Binance recusa IP de datacenter, e o evento
                gravado não sabia dizer isso. Fonte na tela para "funcionou" e
                "funcionou pela metade" não ficarem iguais. */}
            {/* ⚠️ O CARIMBO DO ÚLTIMO PAGAMENTO LIDO (06/08).
                   O dono rodou às 10h21 e recebeu, até o 16º dígito, o mesmo
                   resultado das 01h34 — cache servido, nove horas depois, numa
                   fonte que paga a cada 8h. Ele apertou o botão, não mediu
                   nada, e não tinha como saber. Duas rodadas com o mesmo
                   carimbo leram o MESMO dado. */}
            {d.resumo.ultimoPontoEm && (
              <div style={{ color: "var(--adm-ink-4)", fontSize: 8 }}>
                último pagamento lido:{" "}
                <b>{new Date(d.resumo.ultimoPontoEm).toLocaleString("pt-BR")}</b>
                {" "}— duas rodadas com este mesmo carimbo leram o mesmo dado
              </div>
            )}
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
                  {/* A primeira coluna é a que o veredito usa. Antes a tabela
                      abria com o líquido da JANELA e a coluna "ANUAL." era o
                      anualizado BRUTO — nenhuma das duas era a régua. */}
                  <th style={{ padding: "3px 5px" }}>LÍQ/ANO</th>
                  <th style={{ padding: "3px 5px" }}>NA JANELA</th>
                  <th style={{ padding: "3px 5px" }}>BRUTO</th>
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
                      color: s.netAnnualizedPct > 0 ? "var(--adm-green)" : "var(--adm-red)",
                    }}>
                      <b>{pct(s.netAnnualizedPct, 1)}</b>
                    </td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-3)" }}>{pct(s.netPct)}</td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                      {pct(s.grossPct)}
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
              LÍQ/ANO = um ano de funding menos UMA ida e volta — é a régua do veredito, e
              é EXTRAPOLAÇÃO da janela, não medição de um ano. NA JANELA = o que sobrou
              dentro dos dias entregues, onde as pernas se pagam uma vez só e a janela curta
              pesa contra. EQUIL. = dias de funding médio só para pagar as pernas.
              {" · "}{d.resumo.simbolos} símbolos lidos · {(d.tookMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
