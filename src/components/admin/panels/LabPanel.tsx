"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAutoRefresh } from "../useAutoRefresh";
import { corDoResultado } from "@/lib/admin/cor-resultado";
import {
  razaoRetornoTombo, lerRazao, PORQUE_SEM_RAZAO, UNIDADE_DO_RETORNO,
} from "@/lib/lab/retorno-tombo";

/**
 * O LABORATÓRIO — as 26 estratégias, uma família por vez.
 *
 * ⚠️ O QUE ESTE PAINEL CONSERTA (auditoria visual de 05/08).
 *
 * O dono mandou 11 prints e disse: "se eu mostrar a um leigo ele não vai saber
 * o que é o quê, qual mesa é, e o que mede o quê". Os defeitos catalogados:
 *
 *  · 11 painéis empilhados numa aba só, sem hierarquia
 *  · a mesma carteira com números diferentes em painéis diferentes
 *  · nomes vikings sem legenda — MÍMIR não diz nada para quem não construiu
 *  · 23 chips de filtro numa fileira
 *  · CAPITAL invisível, e é a variável que mais explica o resultado
 *  · AMOSTRA em cinza claro do lado de um número grande e colorido
 *
 * As regras que este painel segue, e que valem para todos os próximos:
 *
 *  1. UMA FAMÍLIA POR VEZ. Não 26 cartões empilhados — abas por quem paga você.
 *  2. VEREDITO ANTES DO NÚMERO. Placar antes do veredito convida a ler retorno
 *     como aprovação, e foi assim que os +34% duraram três semanas.
 *  3. SEIS ESTADOS, e CINZA é cinza. Eram três até 11/08, quando a auditoria
 *     achou onze estratégias contando aqui uma história diferente da do
 *     `lab_results` — `grid_bot` tinha perdido 54% do capital e aparecia como
 *     "NÃO MEDIDA". Não medido continua sem ser âmbar: ausência de informação
 *     não é aviso, é vazio. Quem virou aviso foi INCONCLUSIVA, que É um pedido.
 *  6. A CONFERÊNCIA FICA NO TOPO. Se a tela discordar do livro de novo, ela
 *     aparece antes das abas — não num teste que ninguém roda olhando.
 *  4. CAPITAL SEMPRE VISÍVEL. Resultado sem o capital que o produziu não é
 *     comparável com nada.
 *  5. AMOSTRA SEMPRE VISÍVEL. Número sem `n` é opinião.
 */

type Estrategia = {
  id: string; slug: string; name: string; subtitle: string; family: string;
  capitalRequiredUsd: number; capitalWhy: string;
  status: string;
  hypothesis?: string; killedWhy?: string;
  notMeasurableWhy?: string; measuredElsewhere?: string;
  lastRunAt: string | null;
  lastStatus: "ok" | "falhou" | "rodando" | null;
  lastNetPct: number | null; lastNetAnnualizedPct: number | null;
  lastMaxDrawdownPct: number | null;
  lastSampleN: number | null; lastVerdict: string | null; lastVerdictText: string | null;
  runs: number;
};
type Familia = { id: string; label: string; hint: string };
type Discordancia = {
  slug: string; nome: string; tipo: string;
  tela: string; livro: string | null; o_que: string; fazer_o_que: string;
};
type Dados = {
  familias: Familia[]; estrategias: Estrategia[]; sincronizadoAgora: boolean;
  discordancias?: Discordancia[];
};

const usd = (n: number) => (n <= 1 ? "—" : `$${n.toLocaleString("pt-BR")}`);
const pct = (n: number | null, d = 2) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`);

/**
 * Os seis estados. CINZA é neutro de propósito — ver a regra 3.
 *
 * ⚠️ EMPATE e INCONCLUSIVA têm cores DIFERENTES porque pedem coisas
 * diferentes: empate é medição boa que deu "não há vantagem" e não pede nada;
 * inconclusiva é medição que não fechou e PEDE outra rodada. Pintar as duas de
 * cinza foi exatamente o defeito que a Fase 10 consertou.
 */
const COR: Record<string, string> = {
  verde: "var(--adm-green)", morta: "var(--adm-red)", cinza: "var(--adm-ink-4)",
  empate: "var(--adm-cyan)", inconclusiva: "var(--adm-amber)",
  nao_mensuravel: "var(--adm-ink-3)",
};
const ROTULO: Record<string, string> = {
  verde: "MEDIDA · positiva", morta: "MEDIDA · negativa", cinza: "NÃO MEDIDA",
  empate: "MEDIDA · empate", inconclusiva: "INCONCLUSIVA · pede outra rodada",
  nao_mensuravel: "NÃO MENSURÁVEL",
};

export default function LabPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [aba, setAba] = useState<string>("direcional");
  const [aberta, setAberta] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/lab");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setErr(null);
    } catch (e) { setErr(String(e)); } finally { setCarregando(false); }
  }, []);

  useAutoRefresh({ onRefresh: load, intervalMs: 90_000 });

  const daFamilia = (d?.estrategias ?? []).filter((e) => e.family === aba);
  const capitalDaFamilia = daFamilia.reduce((s, e) => s + (e.capitalRequiredUsd > 1 ? e.capitalRequiredUsd : 0), 0);
  /** ⚠️ "Medida" agora exclui os dois estados que NÃO são medição: não medida
      e não mensurável. `inconclusiva` conta como medida porque a rodada
      aconteceu — o que falta é veredito, não medição. */
  const medidas = daFamilia.filter(
    (e) => e.status !== "cinza" && e.status !== "nao_mensuravel",
  ).length;
  const disc = d?.discordancias ?? [];

  return (
    <TerminalPanel
      id="lab" title="LABORATÓRIO DE ESTRATÉGIAS"
      subtitle="26 formas de lucro — o que cada uma pede de capital, e o que já foi medido"
      icon="🔬" source="supabase/lab_strategies"
    >
      {carregando && <div className="adm-shimmer" style={{ height: 120 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 13 }}>{err}</div>}

      {d && (
        <>
          {/* ── A CONFERÊNCIA, ANTES DE TUDO (Fase 10).

                 ⚠️ Ela fica no TOPO porque foi a posição que faltou. Em 11/08
                 onze estratégias diziam aqui uma coisa e no `lab_results`
                 outra, e nada na tela pedia para alguém olhar. Um controle que
                 mora no rodapé é um controle que ninguém lê.

                 ⚠️ E QUANDO ESTÁ LIMPO, NÃO APARECE NADA. Sem "✅ tudo confere":
                 registro e livro podem estar errados JUNTOS, e um selo verde
                 afirmaria correção onde só houve consistência. */}
          {disc.length > 0 && (
            <div style={{
              border: "1px solid var(--adm-amber)", borderRadius: 4,
              padding: "7px 9px", marginBottom: 10, background: "rgba(255,176,0,.05)",
            }}>
              <div style={{ color: "var(--adm-amber)", fontSize: 13, fontWeight: 700 }}>
                ⚠️ {disc.length} {disc.length === 1 ? "discordância" : "discordâncias"} entre esta tela e o livro
              </div>
              <div style={{ color: "var(--adm-ink-4)", fontSize: 11, marginTop: 2 }}>
                o registro é escrito à mão, o `lab_results` é escrito por medição — quando os
                dois divergem, um dos dois está mentindo para quem lê
              </div>
              <div style={{ marginTop: 6, display: "grid", gap: 5 }}>
                {disc.map((x) => (
                  <div key={`${x.slug}-${x.tipo}`} style={{ fontSize: 12, lineHeight: 1.5 }}>
                    <b style={{ color: "var(--adm-ink-2)" }}>{x.nome}</b>
                    <span style={{ color: "var(--adm-ink-4)" }}> · {x.o_que}</span>
                    <div style={{ color: "var(--adm-cyan)", fontSize: 11 }}>→ {x.fazer_o_que}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ABAS POR FAMÍLIA. A família diz QUEM paga você — é a única
                 classificação que importa, e evita comparar carrego com
                 direcional na mesma tabela. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {d.familias.map((f) => {
              const n = d.estrategias.filter((e) => e.family === f.id).length;
              const ativa = f.id === aba;
              return (
                <button
                  key={f.id} onClick={() => { setAba(f.id); setAberta(null); }}
                  className="adm-btn"
                  style={{
                    padding: "4px 9px", fontSize: 12,
                    borderColor: ativa ? "var(--adm-cyan)" : undefined,
                    color: ativa ? "var(--adm-cyan)" : undefined,
                  }}
                >
                  {f.label} <span style={{ opacity: 0.6 }}>({n})</span>
                </button>
              );
            })}
          </div>

          {/* O que a família É, em uma linha, mais o capital que ela exige
              somado — o número que diz se dá para rodar tudo de uma vez. */}
          <div style={{ fontSize: 12, color: "var(--adm-ink-3)", marginBottom: 10, lineHeight: 1.6 }}>
            {d.familias.find((f) => f.id === aba)?.hint}
            {" · "}<b>{daFamilia.length}</b> estratégias
            {" · "}capital somado <b>{usd(capitalDaFamilia)}</b>
            {" · "}<b style={{ color: medidas > 0 ? "var(--adm-green)" : "var(--adm-ink-4)" }}>
              {medidas} medidas
            </b>{" "}de {daFamilia.length}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {daFamilia.map((e) => {
              const aberto = aberta === e.slug;
              return (
                <div
                  key={e.slug}
                  style={{
                    border: "1px solid var(--adm-border)", borderRadius: 4,
                    borderLeft: `2px solid ${COR[e.status]}`,
                    background: "var(--adm-bg-2, transparent)",
                  }}
                >
                  <button
                    onClick={() => setAberta(aberto ? null : e.slug)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      background: "none", border: "none", cursor: "pointer",
                      padding: "8px 10px", color: "inherit", font: "inherit",
                    }}
                  >
                    {/* NOME + SUBTÍTULO FUNCIONAL. A decisão de 05/08: mantém a
                        identidade e resolve a legibilidade. */}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 14, color: "var(--adm-ink-1, var(--adm-ink-2))", fontWeight: 600 }}>
                        {e.name}
                      </span>
                      <span style={{ fontSize: 10, letterSpacing: "0.08em", color: COR[e.status], whiteSpace: "nowrap" }}>
                        {ROTULO[e.status]}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 2 }}>
                      {e.subtitle}
                    </div>

                    {/* O RESULTADO, com a AMOSTRA colada nele. Número sem `n`
                        é opinião — e um `n` em cinza claro do lado de um número
                        grande e colorido não conta como visível. */}
                    <div style={{ display: "flex", gap: 12, marginTop: 5, fontSize: 12, alignItems: "baseline" }}>
                      {e.lastStatus === "ok" ? (
                        <>
                          <span style={{ color: "var(--adm-ink-4)" }}>
                            líquido{" "}
                            <b style={{
                              /* ⚠️ `?? 0` pintava AUSÊNCIA de vermelho (01/09). As
                                 rotas de combinação e rendimento gravam só o
                                 anualizado, então `net_pct` fica NULL de propósito
                                 — e CINCO linhas apareciam com a cor de prejuízo
                                 para uma medição que não existe. O texto já
                                 imprimia "—"; era só a cor que mentia. */
                              color: corDoResultado(e.lastNetPct),
                              fontSize: 14,
                            }}>
                              {pct(e.lastNetPct)}
                            </b>
                          </span>
                          <span style={{ color: "var(--adm-ink-4)" }}>
                            ao ano <b>{pct(e.lastNetAnnualizedPct, 1)}</b>
                          </span>
                          <span style={{
                            color: (e.lastSampleN ?? 0) >= 30 ? "var(--adm-ink-3)" : "var(--adm-amber)",
                          }}>
                            n={e.lastSampleN ?? 0}
                            {(e.lastSampleN ?? 0) < 30 && " · amostra curta"}
                          </span>
                          {/* ⚠️ RETORNO ÷ TOMBO — o tombo era gravado e nunca lido.
                              A coberta rende 13× mais que o funding e é só 1,7×
                              melhor por unidade de tombo; sem esta célula os dois
                              números pareciam diferir só no tamanho.
                              A unidade é EXIGIDA: vantagem e nível não se ordenam
                              na mesma coluna (invariante nº 17). */}
                          {(() => {
                            const r = razaoRetornoTombo(
                              e.lastNetAnnualizedPct, e.lastMaxDrawdownPct,
                              UNIDADE_DO_RETORNO[e.slug] ?? "desconhecida",
                            );
                            if (r.razao === null) {
                              return (
                                <span style={{ color: "var(--adm-ink-4)" }} title={PORQUE_SEM_RAZAO[r.motivo]}>
                                  ret/tombo —
                                </span>
                              );
                            }
                            return (
                              <span
                                style={{ color: r.razao >= 1 ? "var(--adm-green)" : "var(--adm-ink-3)" }}
                                title={`${lerRazao(r.razao)} · numerador em ${r.unidade}`}
                              >
                                ret/tombo <b>{r.razao.toFixed(2)}</b>
                                {r.unidade === "vantagem" && " (vantagem)"}
                              </span>
                            );
                          })()}
                        </>
                      ) : e.lastStatus === "falhou" ? (
                        <span style={{ color: "var(--adm-red)" }}>última rodada FALHOU — abra para ver o motivo</span>
                      ) : (
                        <span style={{ color: "var(--adm-ink-4)" }}>
                          nunca rodou · aguarda a fase que a mede
                        </span>
                      )}
                      <span style={{ marginLeft: "auto", color: "var(--adm-ink-4)", fontSize: 11 }}>
                        {aberto ? "▲" : "▼"}
                      </span>
                    </div>
                  </button>

                  {aberto && (
                    <div style={{
                      borderTop: "1px solid var(--adm-border)", padding: "8px 10px",
                      fontSize: 11, color: "var(--adm-ink-3)", lineHeight: 1.7,
                    }}>
                      {/* O CAPITAL E O PORQUÊ DELE. É a variável que mais
                          explica o resultado, e ela era invisível no painel
                          antigo — 23 mesas com $1.000 independentemente do que
                          a estratégia exige. */}
                      <div>
                        <span style={{ color: "var(--adm-cyan)" }}>capital exigido</span>{" "}
                        <b style={{ color: "var(--adm-ink-2)" }}>{usd(e.capitalRequiredUsd)}</b>
                        <div style={{ color: "var(--adm-ink-4)", fontSize: 11 }}>{e.capitalWhy}</div>
                      </div>

                      {e.hypothesis && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: "var(--adm-cyan)" }}>hipótese registrada antes do dado</span>
                          <div style={{ color: "var(--adm-ink-4)", fontSize: 11 }}>{e.hypothesis}</div>
                        </div>
                      )}
                      {/* ⚠️ O RÓTULO SEGUE O ESTADO. Este campo carrega tanto
                             reprovação quanto "rodou e não deu para concluir",
                             e chamar as duas de "reprovada" seria a mesma
                             confusão de vocabulário que a Fase 10 desfez. */}
                      {e.killedWhy && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: COR[e.status] ?? "var(--adm-red)" }}>
                            {e.status === "inconclusiva" ? "por que não deu para concluir"
                              : e.status === "empate"     ? "por que deu empate"
                              : "por que foi reprovada"}
                          </span>
                          <div style={{ color: "var(--adm-ink-4)", fontSize: 11 }}>{e.killedWhy}</div>
                        </div>
                      )}
                      {e.notMeasurableWhy && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: COR.nao_mensuravel }}>
                            por que não dá para medir daqui
                          </span>
                          <div style={{ color: "var(--adm-ink-4)", fontSize: 11 }}>{e.notMeasurableWhy}</div>
                        </div>
                      )}
                      {/* ⚠️ Sem isto, um VERDE com zero rodadas parece veredito
                             inventado — e a conferência do topo reclamaria dele
                             para sempre. Declarar onde o número mora é o que
                             separa "medido noutro lugar" de "afirmado". */}
                      {e.measuredElsewhere && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: "var(--adm-cyan)" }}>onde esta medição vive</span>
                          <div style={{ color: "var(--adm-ink-4)", fontSize: 11 }}>{e.measuredElsewhere}</div>
                        </div>
                      )}
                      {e.lastVerdictText && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: "var(--adm-cyan)" }}>veredito da última rodada</span>
                          <div style={{ color: "var(--adm-ink-4)", fontSize: 11 }}>{e.lastVerdictText}</div>
                        </div>
                      )}
                      <div style={{ marginTop: 6, color: "var(--adm-ink-4)", fontSize: 11 }}>
                        {e.runs} rodada(s) registrada(s)
                        {e.lastRunAt && ` · última em ${new Date(e.lastRunAt).toLocaleString("pt-BR")}`}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 10, lineHeight: 1.7 }}>
            <b style={{ color: COR.cinza }}>NÃO MEDIDA</b> é cinza de propósito: ausência de
            informação não é aviso, é vazio — não confundir com reprovada.
            {" · "}<b style={{ color: COR.empate }}>EMPATE</b> é medição BOA cujo resultado foi
            "não há vantagem que eu consiga distinguir" — não adianta remedir com o mesmo método.
            {" · "}<b style={{ color: COR.inconclusiva }}>INCONCLUSIVA</b> é o único estado que
            PEDE alguma coisa: a rodada aconteceu e faltou amostra ou dado para concluir.
            {" · "}<b style={{ color: COR.nao_mensuravel }}>NÃO MENSURÁVEL</b> não é fila de
            espera: é "não dá com a fonte que a gente alcança", e exige o motivo escrito.
            {" · "}O capital de cada uma é o que a ESTRATÉGIA exige, não o que ela tem hoje:
            mesa sub-capitalizada não rende menos, rende negativo por custo fixo.
          </div>
        </>
      )}
    </TerminalPanel>
  );
}
