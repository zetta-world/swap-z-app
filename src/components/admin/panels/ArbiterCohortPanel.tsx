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
type SymbolRealism = {
  symbol: string; samples: number; positive: number; passesGate: number;
  avgRealisticPct: number; avgSlippagePct: number;
};
type Realism = {
  samples: number; withDepth: number;
  avgTheoreticalPct: number; avgRealisticPct: number; avgSlippagePct: number;
  survivors: number; symbols: number; passesGate: number; bySymbol: SymbolRealism[];
};
type Data = {
  desks: Desk[]; flags: Flag[]; readable: boolean; realism: Realism | null;
  gatePct: number; minSpreadPct: number | null; liquidations: number; legs: number;
  venues: Array<{ venue: string; compras: number; vendas: number; total: number }>;
  ranAt: string;
};
/**
 * O antes-e-depois da mediana do corte de outlier. Ver a nota em
 * `arbiter.ts`: a conta em produção não é mediana com contagem par, e trocá-la
 * AFROUXA o portão. Isto mede o quanto, antes de trocar.
 */
type MedianProbe = {
  resumo: {
    simbolos: number; simbolosComQuorum: number; contagemPar: number;
    mudaramSobreviventes: number; ganharamQuorum: number; perderamQuorum: number;
    cotacoesDevolvidas: number; cotacoesRemovidas: number;
    oportunidadesAntes: number; oportunidadesDepois: number;
    oportunidadesNovas: Array<{ symbol: string; buy: string; sell: string; spreadPct: number; netPct: number; suspect: boolean }>;
    oportunidadesPerdidas: Array<{ symbol: string; buy: string; sell: string; spreadPct: number }>;
  };
  outlierPct: number; minVenues: number;
};

type VenueStat = {
  venue: string; symbols: number; biasPct: number; dispersionPct: number;
  worstPct: number; verdict: "estável" | "cara" | "barata" | "ruidosa";
};
type SymbolGap = { symbol: string; gapPct: number; venues: number; outlier: string; outlierDeviationPct: number };
type Truth = {
  verdict: string; stats: VenueStat[];
  gapsAboveFloor: SymbolGap[]; worstGaps: SymbolGap[];
  window: { floorPct: number; ceilPct: number; empty: boolean };
  symbolsTotal: number; symbolsWithQuorum: number;
  biggestDispersionPct: number | null; tookMs: number;
};

const VER_COR: Record<VenueStat["verdict"], string> = {
  ruidosa: "var(--adm-red)", cara: "var(--adm-amber)",
  barata: "var(--adm-amber)", estável: "var(--adm-green)",
};

const COR: Record<Flag["level"], string> = {
  fatal: "var(--adm-red)", aviso: "var(--adm-amber)", ok: "var(--adm-ink-3)",
};
const ICONE: Record<Flag["level"], string> = { fatal: "✕", aviso: "⚠", ok: "·" };
const usdSigned = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
const pctS = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)}%`;

export default function ArbiterCohortPanel() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [truth, setTruth] = useState<Truth | null>(null);
  const [checking, setChecking] = useState(false);
  const [zeroing, setZeroing] = useState(false);
  const [zeroed, setZeroed] = useState<string | null>(null);
  const [med, setMed] = useState<MedianProbe | null>(null);
  const [medRodando, setMedRodando] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/arbiter-cohort");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setErr(null);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // O motivo viaja com a ação, montado a partir do que ESTA medição achou.
  // Um texto fixo diria a mesma coisa daqui a um ano, quando o motivo for outro.
  async function zerar() {
    if (!d) return;
    setZeroing(true);
    const motivo = "auditoria da coorte: ciclos sem uma perda sequer, spread de entrada colado no "
      + "portão e uma venue nos dois lados das pernas — o lucro era ruído de feed, não mercado. "
      + `Marcas fatais: ${d.flags.filter((f) => f.level === "fatal").map((f) => f.id).join(", ")}.`;
    try {
      const res = await fetch("/admin/api/paper-reset", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: d.desks.map((k) => k.source), reason: motivo }),
      });
      const json = await res.json();
      if (res.ok) {
        setZeroed(`${usdSigned(json.totalRemovedUsd)} retirados · posições arquivadas, motivo gravado`);
        await load();
      }
    } catch { /* mantém o estado; nada foi perdido */ } finally { setZeroing(false); }
  }

  // Não roda sozinha: são ~55 símbolos × N venues de chamada real. Uma medição
  // cara que dispara a cada abertura do painel vira custo invisível.
  async function conferir() {
    setChecking(true);
    try {
      const res = await fetch("/admin/api/venue-truth");
      if (res.ok) setTruth(await res.json());
    } catch { /* mantém o estado anterior */ } finally { setChecking(false); }
  }

  // Leitura pura: não abre posição, não escreve em admin_kv, não muda o padrão
  // do findArbs. Roda as DUAS fórmulas de mediana sobre a mesma matriz viva.
  async function medirMediana() {
    setMedRodando(true);
    try {
      const res = await fetch("/admin/api/arbiter-median", { method: "POST" });
      if (res.ok) setMed(await res.json());
    } catch { /* mantém o estado anterior */ } finally { setMedRodando(false); }
  }

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

          {/* A VALIDAÇÃO DE ORDERBOOK — o instrumento que já existia e ninguém lia.
              Rodou 4.085 vezes desde 28/07 dizendo que o líquido REAL era
              negativo, enquanto o ledger anotava positivo. Sobe para o painel
              porque o defeito não foi falta de instrumento, foi falta de leitura. */}
          {d.realism && (
            <div style={{
              border: "1px solid var(--adm-border)", borderRadius: 4,
              padding: "7px 9px", marginBottom: 10, fontSize: 9, lineHeight: 1.7,
            }}>
              <div style={{ color: "var(--adm-ink-2)" }}>
                📖 PROFUNDIDADE REAL DO LIVRO · {d.realism.samples.toLocaleString("pt-BR")} medições
                {" "}em {d.realism.symbols} símbolos
              </div>
              <div style={{ color: "var(--adm-ink-3)" }}>
                topo do livro prometia{" "}
                <b style={{ color: "var(--adm-green)" }}>{pctS(d.realism.avgTheoreticalPct)}</b>
                {" · "}andando o livro sobra{" "}
                <b style={{ color: d.realism.avgRealisticPct >= 0 ? "var(--adm-green)" : "var(--adm-red)" }}>
                  {pctS(d.realism.avgRealisticPct)}
                </b>
                {" · "}profundidade comeu <b>{d.realism.avgSlippagePct.toFixed(3)}%</b>
              </div>
              <div style={{ color: "var(--adm-ink-3)" }}>
                positivas: <b>{d.realism.survivors}</b> de {d.realism.samples.toLocaleString("pt-BR")}
                {" · "}
                <span style={{ color: d.realism.passesGate === 0 ? "var(--adm-red)" : "var(--adm-amber)" }}>
                  passariam do mínimo da mesa: <b>{d.realism.passesGate}</b>
                </span>
              </div>
              {/* "Positiva" e "operável" não são a mesma coisa. Das 17 positivas,
                  16 ficaram entre +0.016% e +0.021% — zero dentro do
                  arredondamento, menos de um centavo num ciclo de $50. */}

              {d.realism.bySymbol.length > 0 && (
                <div style={{ marginTop: 5 }}>
                  <div style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>
                    por símbolo, do livro mais FUNDO para o mais raso:
                  </div>
                  <table className="adm-table" style={{ fontSize: 8 }}>
                    <thead><tr><th>SÍMBOLO</th><th>MEDIÇÕES</th><th>POSITIVAS</th><th>PASSAM</th><th>SLIPPAGE</th></tr></thead>
                    <tbody>
                      {d.realism.bySymbol.map((s) => (
                        <tr key={s.symbol}>
                          <td style={{ color: "var(--adm-ink-2)" }}>{s.symbol}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.samples.toLocaleString("pt-BR")}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{s.positive}</td>
                          <td style={{
                            fontVariantNumeric: "tabular-nums",
                            color: s.passesGate > 0 ? "var(--adm-amber)" : "var(--adm-ink-4)",
                          }}>{s.passesGate}</td>
                          <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--adm-red)" }}>
                            {s.avgSlippagePct.toFixed(3)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontSize: 8, color: "var(--adm-ink-4)", fontStyle: "italic", lineHeight: 1.6 }}>
                    Ordenado pela PROFUNDIDADE, não pelo volume — ordenar por volume repetiria
                    na tela o mesmo viés que a mesa tinha na seleção. O símbolo MAIS operado
                    (MANA, 298 ciclos) é o de pior livro e teve ZERO positivas; o único com
                    alguma sobrevivência é o de melhor livro. A mesa buscava o maior spread
                    aparente, e spread aparente grande é sintoma de livro FINO — ela rodava um
                    detector de iliquidez e chamava de arbitragem.
                  </div>
                </div>
              )}
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", fontStyle: "italic", marginTop: 3 }}>
                O spread do topo é o preço de UMA unidade. Operar ${'{'}50{'}'} exige andar o livro — pagar
                subindo os asks e vender descendo os bids. Esta sonda existia desde 28/07 e só
                registrava: o comentário da chamada dizia &quot;never blocks booking&quot;. Agora ela VETA
                a abertura, e livro que não pôde ser lido reprova.
              </div>
            </div>
          )}

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

          {/* A CONFERÊNCIA AO VIVO — "abre as duas corretoras e olha", com número.
              O ledger diz o que aconteceu; isto diz o que ESTÁ acontecendo nas
              mesmas cotações que a mesa usaria para abrir um ciclo agora. */}
          <div style={{ marginTop: 12, borderTop: "1px solid var(--adm-border)", paddingTop: 8 }}>
            <button className="adm-btn" onClick={conferir} disabled={checking}>
              {checking ? "lendo as corretoras…" : "⚖ conferir os preços AO VIVO"}
            </button>

            {/* ANTES E DEPOIS DA MEDIANA — rótulo diferente do vizinho de
                propósito. Dois botões com texto parecido no mesmo painel já
                custaram dias aqui: o dono rodava um pensando que rodava o outro. */}
            <button
              className="adm-btn" onClick={medirMediana} disabled={medRodando}
              style={{ marginTop: 6 }}
            >
              {medRodando ? "rodando as duas contas…" : "🧮 MEDIANA DO CORTE · antes e depois"}
            </button>

            {med && (
              <div style={{
                marginTop: 8, fontSize: 9, lineHeight: 1.7,
                border: "1px solid var(--adm-border)", borderRadius: 4, padding: "7px 9px",
              }}>
                <div style={{ color: "var(--adm-ink-2)" }}>
                  🧮 CORTE DE OUTLIER · a conta de hoje contra a mediana de verdade
                </div>
                <div style={{ color: "var(--adm-ink-4)", fontSize: 8, marginBottom: 4 }}>
                  a fórmula em produção não é mediana quando a contagem de cotações é PAR.
                  Trocá-la AFROUXA o portão — devolve cotações baratas, e barata é a ponta
                  onde a mesa compra. Este número existe para a troca ser decisão, não descuido.
                </div>
                <div style={{ color: "var(--adm-ink-3)" }}>
                  {med.resumo.simbolos} símbolos · <b>{med.resumo.contagemPar}</b> com contagem PAR
                  {" "}(onde as duas contas podem divergir)
                </div>
                <div style={{ color: "var(--adm-ink-3)" }}>
                  divergiram de fato:{" "}
                  <b style={{ color: med.resumo.mudaramSobreviventes > 0 ? "var(--adm-amber)" : "var(--adm-green)" }}>
                    {med.resumo.mudaramSobreviventes}
                  </b>
                  {" · "}cotações devolvidas: <b>{med.resumo.cotacoesDevolvidas}</b>
                  {" · "}removidas: <b>{med.resumo.cotacoesRemovidas}</b>
                </div>
                <div style={{ color: "var(--adm-ink-3)" }}>
                  quórum: <b style={{ color: "var(--adm-amber)" }}>+{med.resumo.ganharamQuorum}</b> ganham
                  {" · "}<b>−{med.resumo.perderamQuorum}</b> perdem
                </div>
                <div style={{ color: "var(--adm-ink-2)", marginTop: 4 }}>
                  oportunidades: <b>{med.resumo.oportunidadesAntes}</b> hoje →{" "}
                  <b style={{
                    color: med.resumo.oportunidadesDepois > med.resumo.oportunidadesAntes
                      ? "var(--adm-amber)" : "var(--adm-green)",
                  }}>
                    {med.resumo.oportunidadesDepois}
                  </b>{" "}com a mediana correta
                </div>
                {med.resumo.oportunidadesNovas.length > 0 && (
                  <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 4 }}>
                    <div style={{ color: "var(--adm-amber)" }}>
                      as que a troca ABRIRIA — leia antes de decidir:
                    </div>
                    {med.resumo.oportunidadesNovas.slice(0, 8).map((o) => (
                      <div key={`${o.symbol}:${o.buy}:${o.sell}`}>
                        · {o.symbol}: compra {o.buy} → vende {o.sell}
                        {" · "}spread {o.spreadPct.toFixed(3)}%
                        {o.suspect && <span style={{ color: "var(--adm-red)" }}> · acima do teto crível</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 5 }}>
                  leitura pura — nada foi aberto, nada foi alterado. O padrão continua
                  sendo a conta antiga.
                </div>
              </div>
            )}

            {truth && (
              <div style={{ marginTop: 8 }}>
                <div style={{
                  fontSize: 9, lineHeight: 1.6, color: "var(--adm-ink-2)",
                  border: "1px solid var(--adm-border)", borderRadius: 4, padding: "6px 8px",
                }}>
                  {truth.verdict}
                </div>

                {/* Os dois números que respondem tudo: o maior desvio que existe
                    de verdade, contra o que a mesa exige para abrir. */}
                {truth.biggestDispersionPct != null && (
                  <div style={{ fontSize: 9, marginTop: 6, color: "var(--adm-ink-3)" }}>
                    maior desvio real medido:{" "}
                    <b style={{ color: "var(--adm-cyan)" }}>{truth.biggestDispersionPct.toFixed(3)}%</b>
                    {" · "}a mesa exige{" "}
                    <b style={{ color: "var(--adm-amber)" }}>{truth.window.floorPct.toFixed(2)}%</b> para abrir
                    {truth.biggestDispersionPct < truth.window.floorPct && (
                      <span style={{ color: "var(--adm-red)" }}> — não existe spread que pague o custo</span>
                    )}
                  </div>
                )}

                {/* OS SÍMBOLOS, antes das venues. A mesa nunca operou o símbolo
                    médio — ela selecionava a cauda, porque é a cauda que passa do
                    portão. MANA sozinha disparou em 144 horas distintas. */}
                {truth.worstGaps.length > 0 && (
                  <div style={{ fontSize: 8, color: "var(--adm-ink-4)", lineHeight: 1.7, margin: "6px 0" }}>
                    <div style={{ color: "var(--adm-ink-3)" }}>
                      maiores gaps POR SÍMBOLO agora
                      {truth.gapsAboveFloor.length > 0
                        ? ` — ${truth.gapsAboveFloor.length} acima do piso:`
                        : " — nenhum acima do piso:"}
                    </div>
                    {truth.worstGaps.map((g) => (
                      <div key={g.symbol}>
                        · {g.symbol}:{" "}
                        <span style={{ color: g.gapPct >= truth.window.floorPct ? "var(--adm-red)" : "var(--adm-ink-4)" }}>
                          {g.gapPct.toFixed(3)}%
                        </span>{" "}
                        ({g.venues} venues · {g.outlier} {g.outlierDeviationPct > 0 ? "+" : ""}{g.outlierDeviationPct.toFixed(2)}%)
                      </div>
                    ))}
                  </div>
                )}

                {truth.stats.map((s) => (
                  <div key={s.venue} style={{ fontSize: 8, color: "var(--adm-ink-4)", lineHeight: 1.7 }}>
                    · {s.venue}: desvio {s.dispersionPct.toFixed(3)}% · viés{" "}
                    {s.biasPct >= 0 ? "+" : ""}{s.biasPct.toFixed(3)}% · pior {s.worstPct.toFixed(2)}%{" "}
                    <span style={{ color: VER_COR[s.verdict] }}>[{s.verdict}]</span>
                  </div>
                ))}

                <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 4, fontStyle: "italic", lineHeight: 1.6 }}>
                  {truth.symbolsWithQuorum} de {truth.symbolsTotal} símbolos têm as 3 cotações que a
                  regra nova exige. Desvio COM sinal é praça com preço próprio; desvio SEM sinal é
                  feed oscilando — e um par isolado nunca separa os dois, só a mediana de três.
                  {truth.window.empty && (
                    <> A janela de disparo está VAZIA (piso {truth.window.floorPct.toFixed(2)}% &gt; teto{" "}
                    {truth.window.ceilPct.toFixed(2)}%): as mesas não abrem ciclo novo, de propósito.</>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ZERAR. Só aparece enquanto houver resultado a tirar, e só quando a
              coorte foi REPROVADA — um botão de zerar sempre visível é um
              convite a apagar resultado ruim que era verdadeiro. */}
          {!d.readable && d.desks.some((k) => k.realizedUsd !== 0) && !zeroed && (
            <div style={{
              marginTop: 10, border: "1px solid var(--adm-amber)", borderRadius: 4,
              padding: "7px 9px", fontSize: 9, lineHeight: 1.6, color: "var(--adm-ink-3)",
            }}>
              <div style={{ color: "var(--adm-amber)", fontWeight: 700, letterSpacing: "0.08em" }}>
                ⌫ TIRAR {usdSigned(d.desks.reduce((s, k) => s + k.realizedUsd, 0))} DO LEDGER
              </div>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", margin: "3px 0" }}>
                Enquanto este lucro estiver no ledger, toda soma do laboratório está inflada e as
                comparações entre mesas — a única coisa que este laboratório produz — ficam medidas
                contra um número falso. As posições são <b>arquivadas, não apagadas</b>: a evidência
                do defeito é o próprio registro, e apagá-la deixaria só a minha palavra de que ele
                existiu. Fica gravado o motivo.
              </div>
              <button className="adm-btn" onClick={zerar} disabled={zeroing}>
                {zeroing ? "arquivando…" : "⌫ zerar os ledgers de arbitragem"}
              </button>
            </div>
          )}
          {zeroed && (
            <div style={{ marginTop: 10, fontSize: 9, color: "var(--adm-green)", lineHeight: 1.6 }}>
              ✓ {zeroed}
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
