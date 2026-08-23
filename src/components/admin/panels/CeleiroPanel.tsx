"use client";

import { useCallback, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAutoRefresh } from "../useAutoRefresh";

/**
 * O CELEIRO — a segunda arena, na tela.
 *
 * ⚠️⚠️ POR QUE ESTE PAINEL NÃO PARECE COM O TORNEIO, DE PROPÓSITO.
 *
 * O mandato foi explícito: *"identificar no painel de uma forma que não
 * confunda"* e *"nada de painel amontoado um em cima do outro"*.
 *
 *  · **UMA TABELA POR FAIXA DE CAPITAL.** O portão de profundidade mostra que o
 *    mesmo livro aprova 100 USD com 0% de derrapagem e reprova 800 com 7,45%.
 *    Uma tabela única compararia coisas distintas.
 *
 *  · **A COLUNA PRINCIPAL É USDT, e win-rate não aparece.** Mediu-se mesas com
 *    70,2% e 60,0% de acerto PERDENDO dinheiro. Taxa de acerto num ranking é um
 *    número que mente com cara de placar.
 *
 *  · **O CONTROLE EM TODA FAIXA, marcado.** Agente abaixo do Aluguel de Ocioso
 *    está destruindo valor. Sem o piso na MESMA tela, curva bonita e inútil
 *    passa por vitória.
 */

type Piso = { usdt: number; forma: "pct" | "vezes" | "piso" | "sem_base"; valor: number | null };

type Linha = {
  agente: string; nome: string; usdt: number; acimaDoControle: number;
  ehControle: boolean; convidado: boolean; semDado: boolean; lancamentos: number;
  modalidade: string; ritmo: string; motor: string; capitalMinimoUsd: number;
  mecanismo: string; naoFaz: string; destaque: boolean;
  serie: number[]; piso: Piso;
  retorno: { pct: number | null; contraOPisoPp: number | null; porque: string };
  bancaUsd: number; alavancagemMaxima: number; tetoDeExposicao: number; categoria: string;
  porCausa: Record<string, number>;
  execucao: "maker" | "taker";
  taxaPernaPct: number;
  /** ⚠️ O que o extrato NÃO respondia: o que está aberto e quanto capital está preso. */
  abertas: Array<{
    id: string; simbolo: string; lado: "buy" | "sell";
    nocionalUsd: number; margemUsd: number; alavanca: number;
    precoEntrada: number; precoAtual: number | null;
    alvo: number; stop: number;
    movPct: number | null; naoRealizadoUsd: number | null;
    taxaPernaPct: number | null;
    horasAbertas: number; horasLimite: number; vencida: boolean;
  }>;
  fechadas: { total: number; porMotivo: Record<string, number> };
  capital: {
    bancaUsd: number; margemComprometidaUsd: number; livreUsd: number;
    nocionalUsd: number; exposicaoPct: number;
  };
  semPreco: boolean;
  vazamentos: Array<{ causa: string; usdt: number; fatiaDoVazamento: number }>;
  fontes: Array<{ causa: string; usdt: number; fatiaDoVazamento: number }>;
};

type Faixa = { faixa: string; rotulo: string; linhas: Linha[] };

type Resumo = {
  usdtTotal: number; lancamentos: number; agentesComDado: number;
  deMs: number | null; ateMs: number | null; ativo: boolean; ultimoMs: number | null;
};

type Dados = {
  controle: string; semNenhumLancamento: boolean; totalDeLancamentos: number;
  resumo: Resumo; faixas: Faixa[];
};

const MODALIDADE: Record<string, string> = {
  spot_gate: "spot · gate", margem_gate: "margem · gate",
  futuros_gate: "futuros · gate", dex: "dex",
};

const APAGADO = { color: "var(--adm-ink-4)" } as const;
const SUAVE   = { color: "var(--adm-ink-3)" } as const;
const BOM     = { color: "var(--adm-green)" } as const;
const RUIM    = { color: "var(--adm-red)" } as const;

function usd(n: number): string {
  const s = Math.abs(n) >= 1 ? Math.abs(n).toFixed(2) : Math.abs(n).toFixed(4);
  return `${n < 0 ? "−" : ""}$${s}`;
}

function dia(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * O MINIGRÁFICO — USDT acumulado do agente.
 *
 * ⚠️ ESCALA PRÓPRIA POR LINHA, e isso precisa ser dito na tela. O piso rende
 * centavos e o Maker rende unidades; numa escala comum a linha do piso seria
 * reta e pareceria morta quando ele está funcionando perfeitamente. Aqui cada
 * curva mostra a FORMA do próprio acúmulo, não o tamanho comparado.
 */
function Curva({ pontos, cor }: { pontos: number[]; cor: string }) {
  if (pontos.length < 2) {
    return <span style={{ ...APAGADO, fontSize: 10 }}>sem série</span>;
  }
  const min = Math.min(...pontos), max = Math.max(...pontos);
  const amp = max - min || 1;
  const L = 110, A = 20;
  const d = pontos
    .map((p, i) => `${(i / (pontos.length - 1)) * L},${A - ((p - min) / amp) * A}`)
    .join(" ");
  return (
    <svg width={L} height={A} viewBox={`0 0 ${L} ${A}`} style={{ display: "block" }}
         aria-label="USDT acumulado (escala própria)">
      <polyline points={d} fill="none" stroke={cor} strokeWidth="1.2"
                strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
    </svg>
  );
}

/**
 * O RETORNO SOBRE CAPITAL — a coluna que substituiu o `vs. piso` em USDT.
 *
 * ⚠️⚠️ A COMPARAÇÃO ANTERIOR PREMIAVA QUEM ARRISCA MAIS. Ela somava USDT
 * produzido, e o piso rende sobre $1.000 enquanto um alavancado pode ter $1.500
 * de exposição efetiva. Em % da própria banca a pergunta fica justa: para cada
 * dólar administrado, quanto sobrou?
 */
/**
 * O CAPITAL DO AGENTE — banca, o que está preso, o que sobra, o que o mercado move.
 *
 * ⚠️⚠️ MARGEM E NOCIONAL APARECEM OS DOIS, sempre. A margem é o que sai da
 * banca; o nocional é o que o mercado move. Um agente de 10× tem nocional muito
 * maior que a própria banca — mostrar só a margem esconde o risco, mostrar só o
 * nocional inventa um capital que não existe. As duas leituras erram sozinhas.
 */
/** Um rótulo de seção — o que separa "cada coisa no seu espaço" de uma pilha. */
function Secao({ titulo }: { titulo: string }) {
  return (
    <div style={{
      ...APAGADO, marginTop: 12, marginBottom: 2,
      textTransform: "uppercase", letterSpacing: ".08em", fontSize: 10,
      borderBottom: "1px solid rgba(255,255,255,.08)", paddingBottom: 3,
    }}>{titulo}</div>
  );
}

function Capital({ c, alavancado }: { c: Linha["capital"]; alavancado: boolean }) {
  const usado = Math.max(0, Math.min(100, c.exposicaoPct));
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline" }}>
        <span>banca <b>{usd(c.bancaUsd)}</b></span>
        <span style={SUAVE}>comprometido <b>{usd(c.margemComprometidaUsd)}</b> ({usado.toFixed(0)}%)</span>
        <span style={SUAVE}>livre <b>{usd(c.livreUsd)}</b></span>
        {alavancado && (
          <span style={SUAVE}>no mercado <b>{usd(c.nocionalUsd)}</b> de nocional</span>
        )}
      </div>
      <div aria-hidden style={{
        height: 6, borderRadius: 3, marginTop: 6,
        background: "rgba(255,255,255,.10)", overflow: "hidden",
      }}>
        <div style={{
          width: `${usado}%`, height: "100%",
          background: usado > 80 ? "#f87171" : "#34d399",
        }} />
      </div>
    </div>
  );
}

/**
 * AS POSIÇÕES ABERTAS — a pergunta que o extrato não respondia.
 *
 * ⚠️ O NÃO REALIZADO É SÓ DE PREÇO e a tela diz isso: a segunda perna de
 * corretagem ainda não foi paga. Chamar de "lucro" um número que ainda vai
 * pagar pedágio é a mesma mentira que fez o Maker de Faixa parecer vencedor.
 *
 * ⚠️ SEM PREÇO LIDO mostra "—", nunca zero. "Não li" e "não mexeu" são coisas
 * diferentes, e confundi-las é o começo de toda leitura errada.
 */
function Abertas({ ps }: { ps: Linha["abertas"] }) {
  if (ps.length === 0) {
    return <div style={{ ...APAGADO, marginTop: 8 }}>nenhuma posição aberta</div>;
  }
  return (
    <div style={{ marginTop: 8, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={APAGADO}>
            <th style={TH}>par</th><th style={TH}>lado</th>
            <th style={TH}>margem</th><th style={TH}>nocional</th>
            <th style={TH}>entrada → agora</th><th style={TH}>não realizado</th>
            <th style={TH}>alvo / stop</th><th style={TH}>idade</th>
          </tr>
        </thead>
        <tbody>
          {ps.map((p) => {
            const ganha = (p.naoRealizadoUsd ?? 0) > 0;
            return (
              <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
                <td style={TD}><b>{p.simbolo}</b></td>
                <td style={TD}>{p.lado === "buy" ? "compra" : "venda"}
                  {p.alavanca > 1 && <span style={APAGADO}> {p.alavanca}×</span>}</td>
                <td style={TD}>{usd(p.margemUsd)}</td>
                <td style={TD}>{usd(p.nocionalUsd)}</td>
                <td style={TD}>
                  {p.precoEntrada.toFixed(2)} → {p.precoAtual === null
                    ? <span style={APAGADO}>preço não lido</span>
                    : p.precoAtual.toFixed(2)}
                </td>
                <td style={{ ...TD, color: p.naoRealizadoUsd === null ? undefined
                  : ganha ? "#34d399" : "#f87171" }}>
                  {p.naoRealizadoUsd === null ? <span style={APAGADO}>—</span>
                    : <>{usd(p.naoRealizadoUsd)} <span style={APAGADO}>
                        ({p.movPct!.toFixed(2)}%)</span></>}
                </td>
                <td style={TD}>{p.alvo.toFixed(2)} / {p.stop.toFixed(2)}</td>
                <td style={{ ...TD, color: p.vencida ? "#f87171" : undefined }}>
                  {p.horasAbertas.toFixed(1)}h / {p.horasLimite}h
                  {p.vencida && <b> vencida</b>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const TH: React.CSSProperties = { textAlign: "left", padding: "4px 8px 4px 0", fontWeight: 400 };
const TD: React.CSSProperties = { textAlign: "left", padding: "5px 8px 5px 0", whiteSpace: "nowrap" };

function Retorno({ r, ehPiso }: { r: Linha["retorno"]; ehPiso: boolean }) {
  if (r.pct == null) return <span style={APAGADO} title={r.porque}>—</span>;
  const pct = <b>{r.pct >= 0 ? "+" : "−"}{Math.abs(r.pct).toFixed(3)}%</b>;
  if (ehPiso || r.contraOPisoPp == null) {
    return <span style={APAGADO} title={r.porque}>{pct}</span>;
  }
  const acima = r.contraOPisoPp >= 0;
  return (
    <span style={acima ? BOM : RUIM} title={r.porque}>
      {pct} <span style={{ fontSize: 10 }}>{acima ? "↑" : "↓"}</span>
    </span>
  );
}

/** O `vs. piso`, na forma que cabe — ver `contraOPiso`. */
function ContraPiso({ p }: { p: Piso }) {
  if (p.forma === "piso") return <span style={APAGADO} title="este é o piso">— piso</span>;
  if (p.forma === "sem_base" || p.valor == null) {
    return (
      <span style={APAGADO} title={`diferença de ${usd(p.usdt)} — o piso ainda é pequeno demais para uma razão`}>
        {usd(p.usdt)}
      </span>
    );
  }
  const bom = p.usdt >= 0;
  const texto = p.forma === "vezes"
    ? `${p.valor.toFixed(1)}×`
    : `${p.valor >= 0 ? "+" : ""}${p.valor.toFixed(1)}%`;
  return (
    <span style={bom ? BOM : RUIM} title={`${usd(p.usdt)} de diferença para o piso`}>
      {texto} {bom ? "↑" : "↓"}
    </span>
  );
}

export default function CeleiroPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [fechadas, setFechadas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/admin/api/celeiro", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErro(j?.erro ?? "falhou"); return; }
      setErro(null); setD(j);
    } catch (e) { setErro(String(e)); }
  }, []);

  useAutoRefresh({ onRefresh: carregar, intervalMs: 60_000 });

  const alternar = (f: string) => setFechadas((s) => {
    const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n;
  });

  return (
    <TerminalPanel
      id="celeiro" title="CELEIRO" icon="🌾"
      subtitle="a segunda arena · placar em USDT acumulado, por faixa de capital"
      source="CELEIRO_FLUXOS"
    >
      {erro && <div style={RUIM}>{erro}</div>}

      {/* ── O RESUMO ────────────────────────────────────────────────────────
          ⚠️ O TOTAL SOMA CADA AGENTE UMA VEZ. As faixas repetem o piso como
          convidado; somar as linhas das três tabelas contaria o Aluguel de
          Ocioso três vezes e inflaria o Celeiro sem nada ter rendido. */}
      {d && (
        <div style={{
          border: "1px solid var(--adm-border-hi)", borderRadius: 4,
          padding: "12px 14px", marginBottom: 16, background: "var(--adm-bg-raise)",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14,
        }}>
          <div style={{ gridColumn: "1 / -1", fontSize: 11, letterSpacing: ".08em", ...SUAVE }}>
            RESUMO DO CELEIRO
          </div>

          <div>
            <div style={{ ...APAGADO, fontSize: 10, letterSpacing: ".06em" }}>TOTAL ACUMULADO</div>
            <div style={{ fontSize: 22, fontVariantNumeric: "tabular-nums",
                          color: d.resumo.usdtTotal >= 0 ? "var(--adm-cyan)" : "var(--adm-red)" }}>
              {usd(d.resumo.usdtTotal)}
            </div>
          </div>

          <div>
            <div style={{ ...APAGADO, fontSize: 10, letterSpacing: ".06em" }}>LANÇAMENTOS</div>
            <div style={{ fontSize: 22, fontVariantNumeric: "tabular-nums", color: "var(--adm-ink-2)" }}>
              {d.resumo.lancamentos}
            </div>
            <div style={{ ...APAGADO, fontSize: 10 }}>
              {d.resumo.agentesComDado} agente(s) com dado
            </div>
          </div>

          <div>
            <div style={{ ...APAGADO, fontSize: 10, letterSpacing: ".06em" }}>PERÍODO</div>
            <div style={{ fontSize: 12, color: "var(--adm-ink-2)", marginTop: 4 }}>
              {dia(d.resumo.deMs)} → {dia(d.resumo.ateMs)}
            </div>
          </div>

          {/* ⚠️ "ATIVO" É MEDIDO, não declarado: houve lançamento na última
              hora? Um selo fixo continuaria verde com o cron morto — a morte
              muda que este projeto já pagou três vezes. */}
          <div>
            <div style={{ ...APAGADO, fontSize: 10, letterSpacing: ".06em" }}>ESTADO</div>
            <div style={{ fontSize: 12, marginTop: 4,
                          color: d.resumo.ativo ? "var(--adm-green)" : "var(--adm-amber)" }}>
              {d.resumo.ativo ? "● escrevendo" : "○ sem lançar há mais de 1h"}
            </div>
            <div style={{ ...APAGADO, fontSize: 10 }}>
              {d.resumo.ultimoMs ? `último ${new Date(d.resumo.ultimoMs).toLocaleTimeString("pt-BR")}` : "—"}
            </div>
          </div>
        </div>
      )}

      {/* ⚠️ ARRANQUE DITO, NÃO DEDUZIDO. Painel zerado é ambíguo: pode ser
          "ninguém rendeu" (resultado) ou "nada foi lançado" (ausência de
          medição). Confundir as duas é o começo de toda leitura errada. */}
      {d?.semNenhumLancamento && (
        <div className="adm-nota">
          <b>O Celeiro ainda não recebeu nenhum lançamento.</b> Isto não é
          resultado zero — é ausência de medição.
        </div>
      )}

      {d?.faixas.map((f) => {
        const oculta = fechadas.has(f.faixa);
        return (
          <section key={f.faixa} style={{
            marginBottom: 14, border: "1px solid var(--adm-border)",
            borderRadius: 4, overflow: "hidden",
          }}>
            <button
              onClick={() => alternar(f.faixa)}
              style={{
                width: "100%", display: "flex", justifyContent: "space-between",
                alignItems: "center", padding: "8px 12px", background: "var(--adm-bg-raise)",
                border: "none", cursor: "pointer", color: "var(--adm-ink-2)",
                fontSize: 12, letterSpacing: ".05em", fontFamily: "inherit",
              }}
            >
              <span>{f.rotulo.toUpperCase()}</span>
              <span style={APAGADO}>{oculta ? "▸" : "▾"}</span>
            </button>

            {!oculta && (
              <div style={{ overflowX: "auto" }}>
                <table className="adm-table" style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>agente</th>
                      <th style={{ textAlign: "left" }}>onde · ritmo</th>
                      <th></th>
                      <th style={{ textAlign: "right" }}>USDT</th>
                      <th style={{ textAlign: "right" }} title="USDT produzido sobre a banca do agente — a régua que não premia quem arrisca mais">sobre a banca</th>
                      <th style={{ textAlign: "right" }}>vs. piso</th>
                      <th style={{ textAlign: "right" }}>lanç.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.linhas.map((l) => (
                      <tr
                        key={l.agente}
                        onClick={() => setAberto(aberto === `${f.faixa}:${l.agente}` ? null : `${f.faixa}:${l.agente}`)}
                        style={{ cursor: "pointer", opacity: l.convidado ? 0.62 : 1 }}
                      >
                        <td>
                          {l.ehControle && <span title="o piso do Celeiro">⚖ </span>}
                          {l.nome}
                          {/* ⚠️ O selo só existe com pelo menos DOIS concorrentes
                              com dado. "Melhor" numa faixa de um premiaria a
                              ausência de concorrência, e o piso nunca o leva. */}
                          {l.destaque && (
                            <span style={{
                              marginLeft: 6, fontSize: 10, padding: "1px 5px", borderRadius: 2,
                              border: "1px solid var(--adm-gold)", color: "var(--adm-gold)",
                            }}>DESTAQUE</span>
                          )}
                          {l.convidado && <span style={APAGADO}> · piso</span>}
                        </td>
                        <td style={SUAVE}>
                          {MODALIDADE[l.modalidade] ?? l.modalidade} · {l.ritmo}
                          {l.motor === "bot" ? " · bot" : " · bot+ia"}
                        </td>
                        <td style={{ width: 118 }}>
                          <Curva pontos={l.serie}
                                 cor={l.usdt >= 0 ? "var(--adm-cyan)" : "var(--adm-red)"} />
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {l.semDado ? <span style={APAGADO}>sem dado</span> : <b>{usd(l.usdt)}</b>}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {l.semDado ? <span style={APAGADO}>—</span> : <Retorno r={l.retorno} ehPiso={l.ehControle} />}
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {l.semDado ? <span style={APAGADO}>—</span> : <ContraPiso p={l.piso} />}
                        </td>
                        <td style={{ ...APAGADO, textAlign: "right" }}>{l.lancamentos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ⚠️ O EXTRATO DE VAZAMENTO. É a diferença entre "perdi 4 USDT" e
                "paguei 3,10 de taxa, 0,70 de derrapagem e o preço levou 2,40".
                O placar antigo guardava o RESULTADO e nunca as PARTES — e por
                isso não explicava como uma mesa acerta 70% e perde dinheiro. */}
            {!oculta && f.linhas.filter((l) => aberto === `${f.faixa}:${l.agente}`).map((l) => (
              <div key={l.agente} className="adm-nota" style={{ margin: "0 12px 12px" }}>
                <div><b>{l.nome}</b> — {l.mecanismo}</div>
                <div style={{ ...SUAVE, marginTop: 4 }}><b>não faz:</b> {l.naoFaz}</div>
                <div style={{ ...APAGADO, marginTop: 4 }}>
                  exposição máxima {(l.tetoDeExposicao * 100).toFixed(0)}%
                  {l.alavancagemMaxima > 1 && <> · alavanca até <b>{l.alavancagemMaxima}×</b> (a conta manda abaixo)</>}
                  {" · "}mínimo para competir {l.capitalMinimoUsd > 0 ? `${l.capitalMinimoUsd}` : "nenhum"}
                  {" · "}corretagem <b>{l.taxaPernaPct.toFixed(3)}%</b>/perna ({l.execucao} em {l.modalidade.replace("_", " ")})
                </div>

                <Secao titulo="capital" />
                <Capital c={l.capital} alavancado={l.alavancagemMaxima > 1} />

                <Secao titulo={`abertas (${l.abertas.length})`} />
                <Abertas ps={l.abertas} />

                <Secao titulo={`fechadas (${l.fechadas.total})`} />
                {l.fechadas.total === 0 ? (
                  <div style={APAGADO}>nenhuma decidida ainda</div>
                ) : (
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {(["alvo", "stop", "tempo", "liquidacao"] as const).map((m) => (
                      <span key={m} style={l.fechadas.porMotivo[m] ? undefined : APAGADO}>
                        {m === "liquidacao" ? "liquidação" : m}{" "}
                        <b>{l.fechadas.porMotivo[m] ?? 0}</b>
                      </span>
                    ))}
                  </div>
                )}

                {/* ⚠️ A DIFERENÇA ENTRE "perdi 4 USDT" e "paguei 3,10 de taxa, 0,70 de
                    derrapagem e o preço levou 2,40". O placar antigo guardava o
                    RESULTADO e nunca as PARTES — e por isso não explicava como uma
                    mesa acerta 70% e perde dinheiro. */}
                <Secao titulo="o que fez lucrar, o que fez perder" />
                {l.semDado ? (
                  <div>Nenhum lançamento — <b>sem dado não há diagnóstico</b>.</div>
                ) : (
                  <div style={{ display: "grid", gap: 3 }}>
                    {l.fontes.length === 0 && l.vazamentos.length === 0 && (
                      <div style={APAGADO}>nada lançado</div>
                    )}
                    {l.fontes.map((v) => (
                      <div key={`f${v.causa}`} style={{ display: "flex", gap: 8 }}>
                        <span style={{ minWidth: 92 }}>{v.causa}</span>
                        <b style={{ color: "#34d399" }}>{usd(v.usdt)}</b>
                      </div>
                    ))}
                    {l.vazamentos.map((v) => (
                      <div key={`v${v.causa}`} style={{ display: "flex", gap: 8 }}>
                        <span style={{ minWidth: 92 }}>{v.causa}</span>
                        <b style={{ color: "#f87171" }}>{usd(v.usdt)}</b>
                        <span style={APAGADO}>{(v.fatiaDoVazamento * 100).toFixed(0)}% do vazamento</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        );
      })}

      {d && (
        <div style={{ ...APAGADO, marginTop: 10, fontSize: 11 }}>
          ⚖ = o piso (Aluguel de Ocioso), convidado em toda faixa ·
          <b>sobre a banca</b> = USDT ÷ capital do agente — a régua que não premia
          quem arrisca mais · minigráfico é USDT acumulado,{" "}
          <b>escala própria por linha</b> ·{" "}
          <b>win-rate não aparece de propósito</b>: mediu-se mesas com 70% de
          acerto perdendo dinheiro.
        </div>
      )}
    </TerminalPanel>
  );
}
