"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { corDoResultado } from "@/lib/admin/cor-resultado";

/**
 * PRÊMIO DE VARIÂNCIA — Fase 5.1, e a correção da hipótese do mapa.
 *
 * ⚠️ O QUE ESTE PAINEL EXISTE PARA NÃO DEIXAR ACONTECER.
 *
 * 1. LER "IV DE 60%" COMO LUCRO. Quem vende opção não ganha a implícita: ganha
 *    implícita MENOS a volatilidade que aconteceu. BTC com IV 60% realizando
 *    55% embolsa os mesmos 5 pontos que o S&P com 18% realizando 13%. Por isso
 *    o titular é o PRÊMIO, e a implícita nominal fica ao lado, em cinza.
 *
 * 2. ⚠️ LER A MEDIANA. Aqui ela mente, e é a inversão de tudo que este
 *    laboratório fez. Venda de volatilidade tem mediana positiva quase sempre e
 *    média arrastada pela cauda. A média decide; a mediana aparece só para
 *    mostrar o tamanho da assimetria entre as duas.
 *
 * 3. CONFUNDIR PRÊMIO COM ESTRATÉGIA. Prêmio positivo não é call coberta
 *    aprovada — falta o custo de execução e o teto de alta. O aviso é fixo.
 */

type Ponto = { dia: string; implicitaPct: number; realizadaPct: number; vrpPct: number };
type Resumo = {
  n: number; independentes: number; janelaDias: number; historicoDias: number;
  mediaPct: number; medianaPct: number; fracaoNegativa: number;
  /** Quantas vezes a sangria COMEÇOU. Ver `contarEpisodios`. */
  episodiosNegativos: number;
  piorPct: number; cauda5Pct: number;
  implicitaMediaPct: number; realizadaMediaPct: number;
  semFuturo: number; dvolDe: string | null; dvolAte: string | null; diasComPreco: number;
};
type Veredito = { readable: boolean; status: "verde" | "cinza" | "morta"; verdict: string };
type PorTeto = {
  strikeFrac: number; n: number;
  cobertaMediaPct: number; segurarMediaPct: number; vantagemPct: number;
  cobertaMedianaPct: number; segurarMedianaPct: number;
  fracaoGanhou: number; fracaoExercida: number; premioMedioPct: number;
  piorCobertaPct: number; piorSegurarPct: number;
  /** Retorno de SEGURAR anualizado — revela o regime da janela. */
  segurarAnualPct: number;
};
type Dados = {
  veredito: Veredito;
  /** ⚠️ FASE 5.2 — SIMULAÇÃO, prêmio de modelo. Ver `coberta.ts`. */
  coberta?: { veredito: Veredito; porTeto: PorTeto[] };
  resumo: Resumo | null;
  /** As piores da série INTEIRA — é o que a tabela diz mostrar. */
  piores: Ponto[];
  /** As recentes, separadas, para ver o regime de agora. */
  recentes: Ponto[];
  falhas: string[] | null;
  naoMedido: string[];
  tookMs: number;
};

const pt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}`;

const COR: Record<Dados["veredito"]["status"], string> = {
  verde: "var(--adm-green)", morta: "var(--adm-red)", cinza: "var(--adm-ink-4)",
};

export default function VarianciaPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [rodando, setRodando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/variancia", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(`${json.error ?? res.status}${json.detail ? ` — ${json.detail}` : ""}`);
      setD(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  const r = d?.resumo;

  return (
    <TerminalPanel
      id="variancia" title="PRÊMIO DE VARIÂNCIA"
      subtitle="o que sobra de vender volatilidade — implícita menos a que de fato aconteceu"
      icon="🌪" source="deribit/DVOL (implícita) + binance.vision (realizada)"
    >
      <div style={{ fontSize: 9, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
        O mapa dizia que a IV do BTC a 50–80% contra 15–20% do S&P era <i>&quot;o prêmio mais
        gordo deste mercado&quot;</i>. Isso compara o <b>preço do seguro</b>, não o lucro de
        vendê-lo. Quem vende ganha <b>implícita menos realizada</b> — e 60% contra 55% é o
        mesmo negócio que 18% contra 13%. A gordura é proporcional.
      </div>

      <button className="adm-btn" onClick={rodar} disabled={rodando}>
        {rodando ? "lendo implícita e realizada…" : "🌪 MEDIR O PRÊMIO DE VARIÂNCIA · implícita × realizada"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginTop: 6 }}>{err}</div>}

      {d && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            border: `1px solid ${d.veredito.readable ? "var(--adm-border)" : "var(--adm-amber)"}`,
            borderRadius: 4, padding: "7px 9px", marginBottom: 10, fontSize: 10, lineHeight: 1.6,
            color: d.veredito.readable ? "var(--adm-ink-2)" : "var(--adm-amber)",
          }}>
            <span style={{ color: COR[d.veredito.status] }}>● {d.veredito.status.toUpperCase()}</span>
            {" — "}{d.veredito.verdict}
          </div>

          {/* ⚠️ FASE 5.2 — A ESTRATÉGIA, ACIMA DO PRÊMIO.
                 Prêmio positivo é condição NECESSÁRIA e não suficiente: quem
                 decide é se travar a alta custa menos que o prêmio recebido. Por
                 isso o veredito da coberta vem primeiro, e o do prêmio vira
                 contexto logo abaixo. */}
          {d.coberta && (
            <div style={{ marginBottom: 10 }}>
              <div style={{
                border: `1px solid ${d.coberta.veredito.readable ? "var(--adm-border)" : "var(--adm-amber)"}`,
                borderRadius: 4, padding: "7px 9px", fontSize: 10, lineHeight: 1.6,
                color: d.coberta.veredito.readable ? "var(--adm-ink-2)" : "var(--adm-amber)",
              }}>
                <span style={{ color: COR[d.coberta.veredito.status] }}>
                  ● CALL COBERTA — {d.coberta.veredito.status.toUpperCase()}
                </span>
                {" — "}{d.coberta.veredito.verdict}
              </div>

              {/* ⚠️⚠️ O REGIME DA JANELA, ANTES DA TABELA (09/08).
                     A rodada deu vantagem POSITIVA nos quatro tetos, e o motivo
                     não estava na estratégia: SEGURAR rendeu ~10,5%/ano — o BTC
                     andou de lado por 2,5 anos, e coberta ganha POR CONSTRUÇÃO
                     em mercado lateral. Sem isto, +0,62 é lido como constante
                     da estratégia quando é condicional ao mercado que a janela
                     pegou. Mesma família da janela curta do funding: o número
                     está certo e a leitura, não. */}
              {(() => {
                const melhor = [...d.coberta!.porTeto]
                  .sort((a, b) => b.vantagemPct - a.vantagemPct)[0];
                if (!melhor) return null;
                const lateral = melhor.segurarAnualPct >= 0 && melhor.segurarAnualPct < 15;
                return (
                  <div style={{
                    border: `1px solid ${lateral ? "var(--adm-amber)" : "var(--adm-border)"}`,
                    borderRadius: 3, padding: "5px 7px", marginTop: 6,
                    fontSize: 8.5, lineHeight: 1.6,
                    color: lateral ? "var(--adm-amber)" : "var(--adm-ink-3)",
                  }}>
                    ⚠️ CONDICIONAL AO REGIME. Nesta janela <b>SEGURAR rendeu{" "}
                    {melhor.segurarAnualPct.toFixed(1)}%/ano</b>
                    {melhor.segurarAnualPct < 0
                      ? " — mercado em QUEDA: o teto não morde e o prejuízo da moeda vem inteiro."
                      : lateral
                        ? " — mercado LATERAL, e é exatamente onde a coberta ganha POR CONSTRUÇÃO: o teto quase não morde e o prêmio entra inteiro. Num ciclo de alta forte a mesma conta INVERTE."
                        : " — mercado em ALTA, o regime mais duro para a coberta: vantagem positiva aqui vale mais que em mercado lateral."}
                    {" "}O teto mordeu em <b>{Math.round(melhor.fracaoExercida * 100)}%</b> das
                    janelas; em outro regime essa fração muda, e com ela o resultado.
                  </div>
                );
              })()}

              {/* ⚠️ SIMULAÇÃO, EM VERMELHO. A 5.1 é medição; esta metade não é,
                     e as duas aparecem na mesma tela. Sem este aviso, o número
                     de modelo herda a credibilidade do número medido. */}
              <div style={{
                border: "1px solid var(--adm-red)", borderRadius: 3, padding: "5px 7px",
                marginTop: 6, fontSize: 8.5, color: "var(--adm-red)", lineHeight: 1.6,
              }}>
                ⚠️ ESTA METADE É <b>SIMULAÇÃO</b>, não medição. O prêmio vem de Black-Scholes
                com a implícita do dinheiro — não existe histórico gratuito de preço de opção.
                O <b>sorriso</b> subestima o prêmio (conservador) e a <b>cauda</b> subestima o
                risco (otimista): apontam para lados opostos e não se cancelam de forma
                conhecida. Leia como ordem de grandeza. O que é <b>medido</b> é o retorno do
                BTC e quantas vezes ele passou do teto.
              </div>

              {d.coberta.porTeto.length > 0 && (
                <div style={{ overflowX: "auto", marginTop: 7 }}>
                  <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                        <th style={{ textAlign: "left", padding: "3px 5px" }}>TETO</th>
                        <th style={{ padding: "3px 5px" }}>COBERTA</th>
                        <th style={{ padding: "3px 5px" }}>SEGURAR</th>
                        {/* O regime, na linha: sem ele a vantagem vira constante. */}
                        <th style={{ padding: "3px 5px" }}>SEGURAR/ANO</th>
                        <th style={{ padding: "3px 5px" }}>VANTAGEM</th>
                        <th style={{ padding: "3px 5px" }}>GANHOU</th>
                        <th style={{ padding: "3px 5px" }}>EXERCIDA</th>
                        <th style={{ padding: "3px 5px" }}>PRÊMIO</th>
                        <th style={{ padding: "3px 5px" }}>JANELAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...d.coberta.porTeto]
                        .sort((a, b) => b.vantagemPct - a.vantagemPct)
                        .map((c) => (
                          <tr key={c.strikeFrac} style={{ borderTop: "1px solid var(--adm-border)", textAlign: "right" }}>
                            <td style={{ textAlign: "left", padding: "3px 5px", color: "var(--adm-ink-2)" }}>
                              +{Math.round((c.strikeFrac - 1) * 100)}%
                            </td>
                            <td style={{ padding: "3px 5px", color: "var(--adm-ink-3)" }}>
                              {pt(c.cobertaMediaPct)}%
                            </td>
                            <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                              {pt(c.segurarMediaPct)}%
                            </td>
                            <td style={{
                              padding: "3px 5px",
                              color: c.segurarAnualPct < 15 ? "var(--adm-amber)" : "var(--adm-ink-4)",
                            }}>
                              {pt(c.segurarAnualPct, 1)}%
                            </td>
                            <td style={{
                              padding: "3px 5px",
                              /* ⚠️ O ABSOLUTO DA COBERTA MANDA (12/08): uma
                                 coberta que PERDEU não fica verde por ter
                                 perdido menos que segurar. */
                              color: corDoResultado(c.cobertaMediaPct, c.vantagemPct),
                            }}>
                              <b>{pt(c.vantagemPct)}</b>
                            </td>
                            {/* ⚠️ GANHOU EM ÂMBAR DE PROPÓSITO: é o número
                                verdadeiro e enganoso desta fase. A coberta bate
                                segurar na maioria das janelas e perde na média. */}
                            <td style={{ padding: "3px 5px", color: "var(--adm-amber)" }}>
                              {Math.round(c.fracaoGanhou * 100)}%
                            </td>
                            <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                              {Math.round(c.fracaoExercida * 100)}%
                            </td>
                            <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                              +{c.premioMedioPct.toFixed(2)}%
                            </td>
                            <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>{c.n}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 7.5, color: "var(--adm-ink-4)", marginTop: 3, lineHeight: 1.6 }}>
                    COBERTA = min(retorno da moeda, teto) + prêmio. <b>GANHOU</b> é a fração de
                    janelas em que ela bateu segurar — e é o número que engana: ela ganha quase
                    sempre e pode perder na MÉDIA, porque as poucas altas grandes pagam a conta
                    inteira. Tetos declarados antes de ver o resultado.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ⚠️ A ARMADILHA Nº 3, FIXA E EM CIMA. Prêmio positivo NÃO é call
                 coberta aprovada, e a distância entre as duas é justamente o
                 que falta medir. */}
          <div style={{
            border: "1px solid var(--adm-amber)", borderRadius: 3, padding: "5px 7px",
            marginBottom: 8, fontSize: 8.5, color: "var(--adm-amber)", lineHeight: 1.6,
          }}>
            ⚠️ ABAIXO É O PRÊMIO (5.1), MEDIDO — não a estratégia. É o combustível da
            coberta, e continua faltando o <b>custo de execução</b> da opção: DVOL é índice,
            não livro, e não há preço histórico em fonte gratuita.
          </div>

          {r && (
            <>
              {/* O NÚMERO QUE DECIDE — e ele é a MÉDIA, contra a regra do resto
                  do laboratório. Ver a nota do topo. */}
              <div style={{ fontSize: 11, marginBottom: 6 }}>
                PRÊMIO MÉDIO (o que decide):{" "}
                <b style={{ fontSize: 15, color: r.mediaPct > 0 ? "var(--adm-green)" : "var(--adm-red)" }}>
                  {pt(r.mediaPct)}
                </b>
                <span style={{ fontSize: 9, color: "var(--adm-ink-4)" }}>
                  {" "}pontos de volatilidade ao ano
                </span>
              </div>

              <div style={{ fontSize: 8.5, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
                implícita média <b style={{ color: "var(--adm-ink-3)" }}>{r.implicitaMediaPct.toFixed(1)}%</b>
                {" "}contra realizada <b style={{ color: "var(--adm-ink-3)" }}>{r.realizadaMediaPct.toFixed(1)}%</b>
                {/* ⚠️ A MEDIANA APARECE PARA EXPOR A ASSIMETRIA, nunca como
                       veredito. A diferença entre ela e a média É o negócio. */}
                <div style={{ color: "var(--adm-amber)" }}>
                  mediana {pt(r.medianaPct)} — {pt(r.medianaPct - r.mediaPct)} acima da média.
                  {" "}Essa distância É a cauda: na maioria das janelas o prêmio entra inteiro,
                  e poucas explosões pagam a conta toda. <b>Aqui a mediana engana</b>, ao
                  contrário do resto do laboratório.
                </div>
                <div>
                  pior janela <b style={{ color: "var(--adm-red)" }}>{pt(r.piorPct)}</b>
                  {" · "}média das 5% piores <b style={{ color: "var(--adm-red)" }}>{pt(r.cauda5Pct)}</b>
                </div>
                {/* ⚠️ FRAÇÃO E EPISÓDIO RESPONDEM PERGUNTAS DIFERENTES (09/08).
                       A rodada deu 28% de janelas negativas, e as doze piores
                       eram 21/05, 22/05 … 01/06 — consecutivas. Com janela de
                       30 dias deslizando dia a dia, UM mês ruim aparece trinta
                       vezes. A fração diz quanto tempo se esteve perdendo; o
                       episódio diz quantas vezes começou, que é a pergunta de
                       quem precisa aguentar o tranco. */}
                <div style={{ color: "var(--adm-amber)" }}>
                  <b>{Math.round(r.fracaoNegativa * 100)}%</b> das janelas deram prejuízo — mas
                  em apenas <b>{r.episodiosNegativos}</b> episódio
                  {r.episodiosNegativos === 1 ? "" : "s"} distinto
                  {r.episodiosNegativos === 1 ? "" : "s"}. Com janela deslizante, um mês ruim
                  aparece trinta vezes: a fração conta TEMPO, o episódio conta VEZES.
                </div>
                {/* A AMOSTRA: independentes, não diárias. Regra nº 5 da casa. */}
                <div>
                  <b>{r.independentes}</b> janelas independentes ({r.n} diárias de {r.janelaDias}d,
                  sobrepostas {r.janelaDias - 1}/{r.janelaDias})
                  {r.semFuturo > 0 && (
                    <span> · {r.semFuturo} dias sem {r.janelaDias}d de futuro saíram da conta</span>
                  )}
                </div>
                <div style={{ fontSize: 8 }}>
                  implícita de {r.dvolDe ?? "—"} a {r.dvolAte ?? "—"} · {r.diasComPreco} dias com preço
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                      <th style={{ textAlign: "left", padding: "3px 5px" }}>DIA</th>
                      <th style={{ padding: "3px 5px" }}>IMPLÍCITA</th>
                      <th style={{ padding: "3px 5px" }}>REALIZADA (30d à frente)</th>
                      <th style={{ padding: "3px 5px" }}>PRÊMIO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* ⚠️ AS PIORES DA SÉRIE INTEIRA, e até 09/08 não eram.
                           A rota mandava `slice(-180)` — recorte por RECÊNCIA —
                           e isto ordenava ESSE recorte, anunciando "as 30
                           piores". A pior que chegava aqui era −10,6 enquanto a
                           pior real era −46,1. Numa fase cujo argumento é "a
                           cauda decide", a tela escondia a cauda. */}
                    {d.piores.slice(0, 30).map((p) => (
                      <tr key={p.dia} style={{ borderTop: "1px solid var(--adm-border)", textAlign: "right" }}>
                        <td style={{ textAlign: "left", padding: "3px 5px", color: "var(--adm-ink-3)" }}>
                          {p.dia}
                        </td>
                        <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                          {p.implicitaPct.toFixed(1)}%
                        </td>
                        <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                          {p.realizadaPct.toFixed(1)}%
                        </td>
                        <td style={{
                          padding: "3px 5px",
                          color: p.vrpPct > 0 ? "var(--adm-green)" : "var(--adm-red)",
                        }}>
                          <b>{pt(p.vrpPct, 1)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 7.5, color: "var(--adm-ink-4)", marginTop: 3 }}>
                  as 30 piores da série INTEIRA ({d.piores.length} guardadas), não as últimas —
                  numa lista cronológica a cauda some, e é ela que decide se dá para segurar a
                  posição. Datas seguidas aqui são o MESMO episódio visto por janelas
                  sobrepostas, não eventos diferentes.
                </div>
              </div>
            </>
          )}

          {d.falhas && (
            <div style={{ fontSize: 8, color: "var(--adm-amber)", marginTop: 6, lineHeight: 1.6 }}>
              ⚠️ recusas: {d.falhas.join(" · ")}
            </div>
          )}

          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 8, lineHeight: 1.7 }}>
            <div style={{ color: "var(--adm-amber)" }}>⚠️ NÃO está nesta conta:</div>
            {d.naoMedido.map((n) => <div key={n}>· {n}</div>)}
            <div style={{ marginTop: 4 }}>
              PRÊMIO = implícita do dia menos a volatilidade realizada nos {r?.janelaDias ?? 30}{" "}
              dias <b>seguintes</b> — para a frente, porque a implícita é uma previsão e
              compará-la com o passado mediria outra coisa.
              {" · "}{(d.tookMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
