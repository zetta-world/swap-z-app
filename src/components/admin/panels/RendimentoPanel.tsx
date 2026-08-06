"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * RENDIMENTO INTEGRADO — C1 a C4, e a tabela que vira produto.
 *
 * ⚠️ O QUE ESTE PAINEL EXISTE PARA MOSTRAR, e não é o APY.
 *
 * Aave rende 3,5–9% e isso está publicado em toda parte. O que ninguém publica
 * é quanto sobra depois de entrar e sair — e a resposta MUDA DE SINAL conforme
 * o capital. Um gás de $31 é 6,3% de $500 e 0,06% de $50.000.
 *
 * Por isso a peça central aqui é a TABELA POR FAIXA, não um número grande. Um
 * número grande esconderia exatamente a variável que decide se o produto serve
 * ao peixe pequeno ou o machuca — e "capital invisível" foi o defeito nº 5 da
 * auditoria visual de 05/08.
 *
 * As regras do LabPanel valem aqui: veredito antes do número, capital sempre
 * visível, amostra sempre visível, cinza é cinza.
 */

type Piscina = {
  projeto: string; cadeia: string; simbolo: string; tvlUsd: number;
  apyPct: number; apyDe: "media30d" | "base" | "total";
  apyRecompensaPct: number | null;
};
type Faixa = {
  faixaUsd: number; trocaPct: number; gasPct: number; idaEVoltaPct: number;
  /** A cadeia MAIS BARATA naquela faixa. Ver a nota `cadeiasDe` no route.ts. */
  cadeia: string | null;
  /** A cotação devolveu custo NEGATIVO nesta faixa. Ver `custoDaFaixa`. */
  precoIncoerente: boolean;
  apyBrutoPct: number | null; liquido1oAnoPct: number | null; equilibrioDias: number | null;
};
type Linha = {
  slug: string; nome: string; capitalUsd: number;
  piscinas: Piscina[]; naoEncontrados: string[]; faixas: Faixa[];
  /** Emissor+ativo distintos. O mesmo produto em N cadeias é UM. */
  produtos: number;
  precoIncoerente: boolean; gasLido: boolean | null;
  apyBrutoMedianoPct: number | null; liquidoNaFaixaDeclaradaPct: number | null;
  veredito: { readable: boolean; verdict: string; status: "verde" | "cinza" | "morta" };
};
type Dados = {
  fonte: string; falhasPorHost: string | null; piscinasLidas: number; faixas: number[];
  cadeias: Array<{
    cadeia: string; usdPorGas: number; faixasMedidas: number;
    cotacoes: number; cotacoesComGas: number; falha: string | null;
  }>;
  linhas: Linha[]; naoMedido: string[]; aviso: string; tookMs: number;
};

const pct = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const usd = (n: number) => `$${n.toLocaleString("pt-BR")}`;

const COR: Record<Linha["veredito"]["status"], string> = {
  verde: "var(--adm-green)", morta: "var(--adm-red)", cinza: "var(--adm-ink-4)",
};

export default function RendimentoPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [rodando, setRodando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/rendimento", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(`${json.error ?? res.status}${json.detail ? ` — ${json.detail}` : ""}`);
      setD(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  return (
    <TerminalPanel
      id="rendimento" title="RENDIMENTO INTEGRADO"
      subtitle="C1–C4 · quanto sobra do APY depois de entrar e sair, por faixa de capital"
      icon="🏦" source="yields.llama.fi (APY) + li.quest (custo real de entrada)"
    >
      <div style={{ fontSize: 9, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
        Aave rende 3,5–9% e o Tesouro tokenizado 3,3–8% — isso está publicado e não precisa
        de nós. O que ninguém publica é quanto sobra depois do gás e da troca, e a resposta
        muda de sinal conforme o capital: <b>um gás de $31 é 6,3% de $500 e 0,06% de $50.000</b>.
        É a mesma variável que a auditoria achou faltando nas 23 mesas antigas.
      </div>

      <button className="adm-btn" onClick={rodar} disabled={rodando}>
        {rodando ? "lendo APY e cotando a entrada…" : "🏦 MEDIR O RENDIMENTO LÍQUIDO · por faixa de capital"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginTop: 6 }}>{err}</div>}

      {d && (
        <div style={{ marginTop: 10 }}>
          {/* DE ONDE VEIO O DADO, ANTES DO DADO. `api.llama.fi` funcionar não
              prova que `yields.llama.fi` funciona — host diferente, bloqueio
              diferente, e foi essa distinção que me fez escolher a Bybit por
              evidência falsa e levar 403. */}
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginBottom: 8, lineHeight: 1.7 }}>
            fonte: <b style={{ color: "var(--adm-ink-3)" }}>{d.fonte || "—"}</b>
            {" · "}{d.piscinasLidas.toLocaleString("pt-BR")} piscinas lidas
            {d.falhasPorHost && (
              <span style={{ color: "var(--adm-amber)" }}> · recusas: {d.falhasPorHost}</span>
            )}
            <div>
              custo cotado em: {d.cadeias.map((c) => (
                <span key={c.cadeia} style={{
                  color: c.falha || c.cotacoesComGas === 0 ? "var(--adm-amber)" : "var(--adm-ink-4)",
                }}>
                  {/* Quantas cotações trouxeram `gasCosts`. Sem isto, gás não
                      lido vira gás zero e ninguém vê. */}
                  {c.cadeia} <span style={{ fontSize: 7 }}>
                    (gás {c.cotacoesComGas}/{c.cotacoes})
                  </span>{c.falha ? "⚠" : ""}{" "}
                </span>
              ))}
              {d.cadeias.length === 0 && <span style={{ color: "var(--adm-red)" }}>nenhuma</span>}
            </div>
            {d.cadeias.filter((c) => c.falha).map((c) => (
              <div key={c.cadeia} style={{ color: "var(--adm-amber)" }}>⚠ {c.cadeia}: {c.falha}</div>
            ))}
          </div>

          {d.linhas.map((l) => {
            const aberto = aberta === l.slug;
            return (
              <div key={l.slug} style={{
                border: "1px solid var(--adm-border)", borderRadius: 4,
                padding: "8px 10px", marginBottom: 8,
              }}>
                {/* VEREDITO ANTES DO NÚMERO. Placar antes do veredito convida a
                    ler retorno como aprovação, e foi assim que os +34%
                    duraram três semanas. */}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <div style={{ fontSize: 11, color: "var(--adm-ink-2)" }}>
                    <b>{l.nome}</b>
                    <span style={{ fontSize: 8.5, color: "var(--adm-ink-4)" }}>
                      {/* ⚠️ PRODUTOS, NÃO IMPLANTAÇÕES. "12 piscinas" no Tesouro
                          eram BUIDL contado seis vezes com o mesmo 3,5%. Ver
                          `produtosDistintos`. */}
                      {" "}· capital declarado {usd(l.capitalUsd)} · <b>{l.produtos}</b> produto
                      {l.produtos === 1 ? "" : "s"}
                      {l.piscinas.length !== l.produtos && (
                        <span> ({l.piscinas.length} implantações)</span>
                      )}
                    </span>
                  </div>
                  <div style={{ fontSize: 9, color: COR[l.veredito.status], whiteSpace: "nowrap" }}>
                    ● {l.veredito.status.toUpperCase()}
                  </div>
                </div>

                <div style={{
                  fontSize: 9, lineHeight: 1.6, marginTop: 5,
                  color: l.veredito.readable ? "var(--adm-ink-3)" : "var(--adm-amber)",
                }}>
                  {l.veredito.verdict}
                </div>

                {/* ⚠️ AS DUAS RESSALVAS QUE INVALIDAM A TABELA VÊM ANTES DELA.
                       Se elas aparecessem embaixo, alguém leria os números e
                       decidiria antes de chegar no aviso — que é o mesmo motivo
                       do "ARQUIVA a rodada" ficar acima do botão. */}
                {l.precoIncoerente && (
                  <div style={{
                    border: "1px solid var(--adm-red)", borderRadius: 3, padding: "5px 7px",
                    marginTop: 7, fontSize: 8.5, color: "var(--adm-red)", lineHeight: 1.6,
                  }}>
                    ⚠️ A COTAÇÃO DEVOLVEU CUSTO <b>NEGATIVO</b> em pelo menos uma faixa —
                    entrar e sair te pagando, o que é impossível. Os dois lados da troca têm
                    preços que discordam na fonte. O custo foi achatado em zero, então{" "}
                    <b>o líquido abaixo está inflado</b> e a linha não vale como medição.
                  </div>
                )}
                {l.gasLido === false && (
                  <div style={{
                    border: "1px solid var(--adm-red)", borderRadius: 3, padding: "5px 7px",
                    marginTop: 7, fontSize: 8.5, color: "var(--adm-red)", lineHeight: 1.6,
                  }}>
                    ⚠️ A COTAÇÃO NÃO TROUXE CUSTO DE GÁS. O que está na tabela é impacto e
                    taxa, <b>sem gás</b>. &quot;Gás barato&quot; e &quot;gás não lido&quot; dariam
                    a mesma tela — este aviso existe para não darem.
                  </div>
                )}

                {/* ⚠️ A TABELA É A PEÇA CENTRAL, não um enfeite embaixo de um
                       número grande. É ela que responde "serve para o peixe
                       pequeno?" — e a resposta muda de linha para linha. */}
                {l.faixas.some((f) => f.liquido1oAnoPct != null) && (
                  <div style={{ overflowX: "auto", marginTop: 7 }}>
                    <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                          <th style={{ textAlign: "left", padding: "3px 5px" }}>CAPITAL</th>
                          {/* ⚠️ ONDE. "Líquido de +4,1%" sem dizer em qual cadeia
                              não é acionável — e a resposta MUDA entre $500 e
                              $50.000, porque o gás é fixo e o impacto não. */}
                          <th style={{ textAlign: "left", padding: "3px 5px" }}>ONDE</th>
                          <th style={{ padding: "3px 5px" }}>BRUTO/ANO</th>
                          <th style={{ padding: "3px 5px" }}>TROCA</th>
                          <th style={{ padding: "3px 5px" }}>GÁS</th>
                          <th style={{ padding: "3px 5px" }}>IDA+VOLTA</th>
                          <th style={{ padding: "3px 5px" }}>LÍQ. 1º ANO</th>
                          <th style={{ padding: "3px 5px" }}>EQUIL.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.faixas.map((f) => {
                          const declarada = f.faixaUsd === l.capitalUsd;
                          return (
                            <tr key={f.faixaUsd} style={{
                              borderTop: "1px solid var(--adm-border)", textAlign: "right",
                              background: declarada ? "rgba(255,255,255,0.03)" : undefined,
                            }}>
                              <td style={{ textAlign: "left", padding: "3px 5px", color: "var(--adm-ink-2)" }}>
                                {usd(f.faixaUsd)}
                                {declarada && (
                                  <span style={{ fontSize: 7.5, color: "var(--adm-ink-4)" }}> ← declarado</span>
                                )}
                              </td>
                              <td style={{ textAlign: "left", padding: "3px 5px", color: "var(--adm-ink-3)" }}>
                                {f.cadeia ?? "—"}
                              </td>
                              <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                                {pct(f.apyBrutoPct)}
                              </td>
                              <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                                −{f.trocaPct.toFixed(2)}%
                              </td>
                              <td style={{
                                padding: "3px 5px",
                                color: f.gasPct > 1 ? "var(--adm-amber)" : "var(--adm-ink-4)",
                              }}>
                                −{f.gasPct.toFixed(2)}%
                              </td>
                              <td style={{
                                padding: "3px 5px",
                                color: f.precoIncoerente ? "var(--adm-red)" : "var(--adm-ink-3)",
                              }}>
                                {f.precoIncoerente ? "⚠ 0,00%" : `−${f.idaEVoltaPct.toFixed(2)}%`}
                              </td>
                              <td style={{
                                padding: "3px 5px",
                                color: (f.liquido1oAnoPct ?? 0) > 0 ? "var(--adm-green)" : "var(--adm-red)",
                              }}>
                                <b>{pct(f.liquido1oAnoPct)}</b>
                              </td>
                              <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                                {f.equilibrioDias == null ? "nunca" : `${Math.round(f.equilibrioDias)}d`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ⚠️ O QUE A LISTA DECLARADA NÃO ACHOU, NA TELA. Projeto que
                       some da fonte pode ter mudado de slug, ter sido
                       despriorizado ou ter quebrado — as três mudam a leitura,
                       e nenhuma aparece num agregado. */}
                {l.naoEncontrados.length > 0 && (
                  <div style={{ fontSize: 8, color: "var(--adm-amber)", marginTop: 6, lineHeight: 1.6 }}>
                    ⚠️ declarados e NÃO encontrados na fonte: {l.naoEncontrados.join(", ")}
                  </div>
                )}

                {l.piscinas.length > 0 && (
                  <>
                    <button
                      className="adm-btn"
                      style={{ marginTop: 7, fontSize: 8, padding: "3px 7px" }}
                      onClick={() => setAberta(aberto ? null : l.slug)}
                    >
                      {aberto ? "▾ esconder as piscinas" : `▸ ver as ${l.piscinas.length} piscinas por trás do número`}
                    </button>
                    {aberto && (
                      <div style={{ overflowX: "auto", marginTop: 6 }}>
                        <table style={{ width: "100%", fontSize: 8.5, borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                              <th style={{ textAlign: "left", padding: "2px 5px" }}>PROJETO</th>
                              <th style={{ textAlign: "left", padding: "2px 5px" }}>CADEIA</th>
                              <th style={{ textAlign: "left", padding: "2px 5px" }}>ATIVO</th>
                              <th style={{ padding: "2px 5px" }}>APY</th>
                              <th style={{ padding: "2px 5px" }}>ORIGEM</th>
                              <th style={{ padding: "2px 5px" }}>RECOMP.</th>
                              <th style={{ padding: "2px 5px" }}>TAMANHO</th>
                            </tr>
                          </thead>
                          <tbody>
                            {l.piscinas.slice(0, 25).map((p, i) => (
                              <tr key={`${p.projeto}-${p.cadeia}-${p.simbolo}-${i}`}
                                  style={{ borderTop: "1px solid var(--adm-border)", textAlign: "right" }}>
                                <td style={{ textAlign: "left", padding: "2px 5px", color: "var(--adm-ink-3)" }}>{p.projeto}</td>
                                <td style={{ textAlign: "left", padding: "2px 5px", color: "var(--adm-ink-4)" }}>{p.cadeia}</td>
                                <td style={{ textAlign: "left", padding: "2px 5px", color: "var(--adm-ink-4)" }}>{p.simbolo}</td>
                                <td style={{ padding: "2px 5px", color: "var(--adm-ink-2)" }}>{p.apyPct.toFixed(2)}%</td>
                                {/* ORIGEM DO APY NA LINHA. "média de 30 dias" e
                                    "à vista" não podem ficar iguais: à vista
                                    dispara com uma alavancada e volta em horas. */}
                                <td style={{
                                  padding: "2px 5px",
                                  color: p.apyDe === "media30d" ? "var(--adm-ink-4)" : "var(--adm-amber)",
                                }}>
                                  {p.apyDe === "media30d" ? "30d" : p.apyDe === "base" ? "à vista" : "total⚠"}
                                </td>
                                {/* ⚠️ RECOMPENSA SEPARADA, NUNCA SOMADA. É paga
                                    num token de incentivo que pode cair 80%
                                    antes de você vender. */}
                                <td style={{ padding: "2px 5px", color: "var(--adm-ink-4)" }}>
                                  {p.apyRecompensaPct == null ? "—" : `+${p.apyRecompensaPct.toFixed(2)}%`}
                                </td>
                                <td style={{ padding: "2px 5px", color: "var(--adm-ink-4)" }}>
                                  ${(p.tvlUsd / 1e6).toFixed(0)}M
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ fontSize: 7.5, color: "var(--adm-ink-4)", marginTop: 4, lineHeight: 1.6 }}>
                          RECOMP. é rendimento pago em token de incentivo e <b>não entra</b> no APY
                          da coluna ao lado — ele assume venda instantânea a preço de tela.
                          {l.piscinas.length > 25 && ` · mostrando 25 de ${l.piscinas.length}`}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 8, lineHeight: 1.7 }}>
            <div style={{ color: "var(--adm-amber)" }}>⚠️ NÃO está nesta conta:</div>
            {d.naoMedido.map((n) => <div key={n}>· {n}</div>)}
            <div style={{ marginTop: 4 }}>
              LÍQ. 1º ANO = um ano de rendimento menos UMA ida e volta. No 2º ano a entrada
              já foi paga — um número decide se vale <b>entrar</b>, o bruto decide se vale
              <b> ficar</b>.
              {/* ⚠️ ZERO NA COLUNA GÁS NÃO É "SEM GÁS". Nas três estratégias que
                     exigem troca, o gás está DENTRO de TROCA (a cotação já o
                     cobra). Coluna zerada sem explicação vira, semanas depois,
                     "então entrar em stETH não custa gás". */}
              {" "}<span style={{ color: "var(--adm-amber)" }}>
                GÁS zerado não quer dizer sem gás: nas estratégias que exigem troca ele já
                está DENTRO de TROCA, cobrado pela própria cotação.
              </span>{" "}
              Só o empréstimo de stablecoin tem gás em coluna própria — lá não há troca, e
              o preço por unidade é MEDIDO enquanto a contagem de unidades é DECLARADA.
              {" · "}{(d.tookMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
