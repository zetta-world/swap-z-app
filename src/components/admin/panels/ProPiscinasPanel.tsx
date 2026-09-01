"use client";

import { useCallback, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { PRO_PAIRS } from "@/lib/pro-pairs";
import type { VereditoPiscina } from "@/lib/pro/escolha-da-piscina";

/**
 * QUAL PISCINA O TERMINAL DEVE MOSTRAR — o botão que roda a medição.
 *
 * ⚠️⚠️ O BOTÃO EXISTE PORQUE A MEDIÇÃO NÃO RODA NA MÁQUINA DE QUEM ESCREVE O
 * CÓDIGO. O contêiner de desenvolvimento não alcança a GeckoTerminal; a Vercel
 * alcança. A ideia foi do dono: o teste vem para o painel, alguém clica, e o
 * resultado desce para o banco — de onde qualquer sessão lê por SQL.
 *
 * ⚠️ A TELA NÃO É O RESULTADO. Ela mostra o que acabou de ser medido, mas o
 * resultado que vale está em `pro_piscina_medicao` e `pro_piscina_veredito`. Se
 * a gravação falhar, isto diz — porque uma tela verde sobre um banco vazio é a
 * pior saída possível.
 *
 * ⚠️ E O VEREDITO VEM ANTES DO NÚMERO, como em todo painel desta casa. Placar
 * antes de veredito convida a ler "mais TVL" como "melhor" — e as duas réguas
 * aqui podem apontar para piscinas diferentes.
 */

interface Linha {
  par: string; rede: string; piscina: string; rotulo: string; atual: boolean;
  porqueNaoLeu: string | null;
  velasLidas: number | null; velasParadas: number | null;
  minutosComVela: number | null; coberturaPct: number | null;
  amplitudeMediaPct: number | null; atrasoMin: number | null;
  tvlUsd: number | null; volume24hUsd: number | null;
  trocas24h: number | null; precoUsd: number | null;
}
interface Veredito {
  par: string; rede: string;
  melhorParaOGrafico: string | null; maiorLiquidez: string | null; atual: string | null;
  veredito: VereditoPiscina; porque: string; lidas: number; candidatas: number;
}
interface Dados {
  rodada: string; janelaMin: number; medidoEm: string;
  gravado: boolean; erroAoGravar: string | null;
  semCandidata: string[];
  foraDoLote: string[];
  maxParesPorRodada: number;
  chamadasAFonte: number;
  vereditos: Veredito[];
  linhas: Linha[];
  naoMedido: string[];
  tookMs: number;
}

const COR: Record<VereditoPiscina, string> = {
  atual_e_a_melhor: "var(--adm-green)",
  trocar:           "var(--adm-amber)",
  conflito:         "var(--adm-amber)",
  inconclusiva:     "var(--adm-ink-3)",
  /** ⚠️ VERMELHO, não cinza. Rodada perdida não é resultado neutro. */
  fonte_recusou:    "var(--adm-red)",
};
const ROTULO: Record<VereditoPiscina, string> = {
  atual_e_a_melhor: "✓ A ATUAL É A MELHOR",
  trocar:           "→ TROCAR",
  conflito:         "⚖ CONFLITO — as duas réguas discordam",
  inconclusiva:     "◌ INCONCLUSIVA",
  fonte_recusou:    "✕ A FONTE RECUSOU — nada medido",
};

const pct = (n: number | null, casas = 0) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(casas)}%`;
const usd = (n: number | null) =>
  n == null || !Number.isFinite(n) ? "—"
    : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M`
    : `$${Math.round(n).toLocaleString("pt-BR")}`;

/** Os pares que o botão mede por padrão — o do BNB primeiro, que foi a queixa. */
const PADRAO = ["bnb-usdt-pcs-v3", "eth-usdt-uni-v3-005", "eth-usdc-uni-v3-005", "btcb-usdt-pcs-v3"];

/**
 * ⚠️ O SEGUNDO LOTE — os pares que não cabem num clique. A rota corta em 6 por
 * rodada porque a GeckoTerminal permite ~30 chamadas/min por IP, e em 31/08 um
 * clique de 23 pares voltou com 56 de 62 leituras em 429.
 */
const LOTE_2 = ["arb-usdc-uni-v3-005", "eth-usdc-arb-uni-v3", "op-usdc-uni-v3",
                "matic-usdc-uni-v3", "avax-usdc-tj-v21", "cbbtc-usdc-base-uni"];

export default function ProPiscinasPanel() {
  const [data, setData]       = useState<Dados | null>(null);
  const [erro, setErro]       = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [tudo, setTudo]       = useState(false);

  const medir = useCallback(async (todos: boolean) => {
    setRodando(true); setErro(null); setTudo(todos);
    try {
      const res = await fetch("/admin/api/pro-piscinas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pares: todos ? LOTE_2 : PADRAO }),
      });
      const body = await res.json() as Dados & { error?: string; detail?: string };
      if (!res.ok) {
        setErro(`${body.error ?? res.status}${body.detail ? ` — ${body.detail}` : ""}`);
        return;
      }
      setData(body);
    } catch (e) {
      setErro(String(e).slice(0, 200));
    } finally { setRodando(false); }
  }, []);

  return (
    <TerminalPanel
      id="pro-piscinas"
      title="QUAL PISCINA O /PRO MOSTRA"
      subtitle="o gráfico se mexe? e é a piscina mais funda? — duas réguas, medidas"
      icon="🩺"
      source="api.geckoterminal.com → pro_piscina_medicao"
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="adm-btn" onClick={() => void medir(false)} disabled={rodando}>
          {rodando && !tudo ? "medindo…" : `🩺 MEDIR ${PADRAO.length} PARES`}
        </button>
        <button className="adm-btn" onClick={() => void medir(true)} disabled={rodando}>
          {rodando && tudo ? "medindo lote 2…" : "🩺 MEDIR LOTE 2"}
        </button>
      </div>
      {/* ⚠️ O RITMO NA TELA. Em 31/08 um clique de 23 pares devolveu 56 de 62
          leituras em 429 e a tela disse "gravado". O botão agora é de LOTE, a
          rota espaça as chamadas, e a rodada demora de propósito. */}
      <div style={{ color: "var(--adm-ink-4)", fontSize: 11, marginTop: 5, lineHeight: 1.6 }}>
        a rota espaça as chamadas (~3s cada) porque a GeckoTerminal permite ~30/min por IP,
        e os IPs da Vercel são compartilhados — <b>uma rodada leva 1 a 3 minutos</b>.
        Máximo de {PRO_PAIRS.length > 0 ? 6 : 6} pares por clique; o que ficar de fora vem nomeado na resposta.
      </div>

      {erro && (
        <div style={{ color: "var(--adm-red)", fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          {erro}
          <div style={{ color: "var(--adm-ink-4)", fontSize: 11, marginTop: 3 }}>
            fonte recusada não é resultado — nada foi medido nesta tentativa
          </div>
        </div>
      )}

      {data && (
        <div style={{ marginTop: 10 }}>
          {/* ── A GRAVAÇÃO PRIMEIRO. Sem ela, isto é uma tela, não uma medição. ── */}
          <div style={{
            border: `1px solid ${data.gravado ? "var(--adm-green)" : "var(--adm-red)"}`,
            borderRadius: 3, padding: "5px 8px", marginBottom: 8,
            fontSize: 11, lineHeight: 1.6,
            color: data.gravado ? "var(--adm-green)" : "var(--adm-red)",
          }}>
            {data.gravado ? (
              <>
                ✓ gravado no banco · rodada <b>{data.rodada}</b>
                <div style={{ color: "var(--adm-ink-4)", marginTop: 2 }}>
                  {`select * from pro_piscina_veredito where rodada = '${data.rodada}';`}
                </div>
              </>
            ) : (
              <>✕ NÃO gravado — {data.erroAoGravar ?? "motivo desconhecido"}. O que está na tela
                se perde ao recarregar.</>
            )}
          </div>

          {/* ── UM BLOCO POR PAR: veredito, depois as piscinas ────────────── */}
          {data.vereditos.map((v) => {
            const doPar = data.linhas.filter((l) => l.par === v.par);
            return (
              <div key={v.par} style={{ marginBottom: 12 }}>
                <div style={{
                  border: `1px solid ${COR[v.veredito]}`, borderRadius: 3, padding: "6px 8px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--adm-ink-2)", fontSize: 12, fontWeight: 700 }}>
                      {v.par} <span style={{ color: "var(--adm-ink-4)", fontWeight: 400 }}>· {v.rede}</span>
                    </span>
                    <span style={{ color: COR[v.veredito], fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>
                      {ROTULO[v.veredito]}
                    </span>
                  </div>
                  <div style={{ color: "var(--adm-ink-3)", fontSize: 11, lineHeight: 1.6, marginTop: 4 }}>
                    {v.porque}
                  </div>
                  <div style={{ color: "var(--adm-ink-4)", fontSize: 11, marginTop: 3 }}>
                    {v.lidas} de {v.candidatas} piscinas lidas
                  </div>
                </div>

                <div style={{ overflowX: "auto", marginTop: 5 }}>
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>PISCINA</th>
                        {/* ⚠️ As duas réguas ficam LADO A LADO. Separá-las deixaria
                            uma responder pela outra — a mesma regra do painel de LP. */}
                        <th style={{ textAlign: "right" }}>COBERTURA 1m</th>
                        <th style={{ textAlign: "right" }}>TVL</th>
                        <th style={{ textAlign: "right" }}>PARADAS</th>
                        <th style={{ textAlign: "right" }}>AMPLITUDE</th>
                        <th style={{ textAlign: "right" }}>ATRASO</th>
                        <th style={{ textAlign: "right" }}>VOL 24h</th>
                        <th style={{ textAlign: "right" }}>TROCAS 24h</th>
                        <th style={{ textAlign: "right" }}>PREÇO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doPar.map((l) => {
                        const naoLeu = l.porqueNaoLeu !== null;
                        return (
                          <tr key={l.piscina} style={{ opacity: naoLeu ? 0.55 : 1 }}>
                            <td>
                              {l.atual && <b style={{ color: "var(--adm-cyan, var(--adm-ink-2))" }}>▸ </b>}
                              {l.rotulo}
                              {l.atual && <span style={{ color: "var(--adm-ink-4)" }}> (atual)</span>}
                              {naoLeu && (
                                <div style={{ color: "var(--adm-red)", fontSize: 10 }}>
                                  não lida: {l.porqueNaoLeu}
                                </div>
                              )}
                            </td>
                            {/* ⚠️ VERMELHO quando não leu, NUNCA "0%". Zero aqui
                                afirmaria "piscina morta"; o traço diz "não medida". */}
                            <td style={{
                              textAlign: "right",
                              color: naoLeu ? "var(--adm-red)"
                                : (l.coberturaPct ?? 0) < 50 ? "var(--adm-amber)" : "var(--adm-ink-2)",
                            }}>
                              {naoLeu ? "—" : pct(l.coberturaPct)}
                              {!naoLeu && l.minutosComVela != null && (
                                <div style={{ color: "var(--adm-ink-4)", fontSize: 10 }}>
                                  {l.minutosComVela}/{data.janelaMin} min
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: "right" }}>{usd(l.tvlUsd)}</td>
                            <td style={{ textAlign: "right", color: "var(--adm-ink-3)" }}>
                              {l.velasParadas == null ? "—" : l.velasParadas}
                            </td>
                            <td style={{ textAlign: "right", color: "var(--adm-ink-3)" }}>
                              {pct(l.amplitudeMediaPct, 3)}
                            </td>
                            <td style={{
                              textAlign: "right",
                              color: (l.atrasoMin ?? 0) > 15 ? "var(--adm-amber)" : "var(--adm-ink-3)",
                            }}>
                              {l.atrasoMin == null ? "—" : `${l.atrasoMin.toFixed(0)} min`}
                            </td>
                            <td style={{ textAlign: "right", color: "var(--adm-ink-3)" }}>{usd(l.volume24hUsd)}</td>
                            <td style={{ textAlign: "right", color: "var(--adm-ink-3)" }}>
                              {l.trocas24h == null ? "—" : l.trocas24h.toLocaleString("pt-BR")}
                            </td>
                            <td style={{ textAlign: "right", color: "var(--adm-ink-3)" }}>
                              {l.precoUsd == null ? "—" : `$${l.precoUsd.toPrecision(6)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {data.foraDoLote && data.foraDoLote.length > 0 && (
            <div style={{ color: "var(--adm-amber)", fontSize: 11, lineHeight: 1.6, marginTop: 6 }}>
              ⚠️ <b>{data.foraDoLote.length} pares ficaram fora deste clique</b> (teto de{" "}
              {data.maxParesPorRodada} por rodada): {data.foraDoLote.join(", ")}
            </div>
          )}

          {data.semCandidata.length > 0 && (
            <div style={{ color: "var(--adm-amber)", fontSize: 11, lineHeight: 1.6, marginTop: 6 }}>
              ⚠️ pares sem alternativa nesta rodada — uma piscina sozinha não se compara com nada:
              <ul style={{ margin: "3px 0 0 16px" }}>
                {data.semCandidata.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* ⚠️ O QUE NÃO FOI MEDIDO, NA TELA. Sem esta lista, "maior TVL" seria
              lido como "melhor execução", e não é. */}
          <div style={{ color: "var(--adm-ink-4)", fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
            <b style={{ color: "var(--adm-amber)" }}>não medido nesta rodada:</b>
            <ul style={{ margin: "3px 0 0 16px" }}>
              {data.naoMedido.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>

          <div style={{ color: "var(--adm-ink-4)", fontSize: 11, marginTop: 6 }}>
            {data.chamadasAFonte} chamadas à fonte · janela de {data.janelaMin} min · medido em {new Date(data.medidoEm).toLocaleString("pt-BR")}
            {" · "}{(data.tookMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
