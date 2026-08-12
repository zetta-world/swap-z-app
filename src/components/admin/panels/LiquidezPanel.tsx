"use client";

import { useCallback, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { corDoResultado, legendaDoResultado } from "@/lib/admin/cor-resultado";

/**
 * SER A CONTRAPARTE — C14, a mesa de liquidez (Fase 8.1).
 *
 * ⚠️ O DESENHO SEGUE A REGRA DA CASA: veredito ANTES do número. Placar antes do
 * veredito convida a ler retorno como aprovação — foi assim que os +34%
 * duraram três semanas.
 *
 * ⚠️ E AS DUAS COLUNAS QUE DECIDEM FICAM LADO A LADO: LÍQUIDO e SEGURAR. A
 * pergunta desta família não é "a piscina deu lucro?", é "a piscina bateu ter
 * segurado?". Separar as duas na tela deixaria a primeira responder pela
 * segunda.
 */

interface Piscina {
  id: string; rotulo: string; porque: string; controle: boolean;
  dias: number; razao: number;
  ilPct: number; taxaPct: number;
  vantagemPct: number; lpPct: number; segurarPct: number;
  apyDe: "apyBase" | "apyMean30d" | "ausente"; apyAnualPct: number | null;
  gasPct: number; gasDe: "medido" | "ausente"; desacordoTaxaPct: number | null;
  casada: { symbol: string; tvlUsd: number | null } | null;
}
interface Dados {
  janelaDias: number; minPiscinas: number; hostUsado: string;
  falhas: string[]; naoCasadas: string[];
  resumo: {
    ilMedianoPct: number | null; taxaMedianaPct: number | null;
    vantagemMedianaPct: number | null; lpMedianoPct: number | null;
    gasMedianoPct: number | null; semGas: number; incertezaTaxaPct: number | null;
    piscinaMediana: string | null;
    segurarMedianoPct: number | null;
    ganhouDeSegurar: number; medidas: number; semApy: number;
  };
  gasDetalhe: {
    usdPorGas: number; usdTotal: number; unidades: number;
    cotacaoUsd: number | null; cotacaoUnidades: number | null;
  } | null;
  piscinas: Piscina[];
  veredito: { status: "verde" | "cinza" | "morta"; texto: string };
  naoMedido: string[];
  tookMs: number;
}

const COR: Record<Dados["veredito"]["status"], string> = {
  verde: "var(--adm-green)", cinza: "var(--adm-ink-3)", morta: "var(--adm-red)",
};
const ROTULO: Record<Dados["veredito"]["status"], string> = {
  verde: "✓ VERDE", cinza: "◌ INCONCLUSIVA", morta: "✕ MORTA",
};

const pct = (n: number | null | undefined, casas = 2) =>
  n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(casas)}%`;

export default function LiquidezPanel() {
  const [data,    setData]    = useState<Dados | null>(null);
  const [erro,    setErro]    = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  const medir = useCallback(async () => {
    setRodando(true); setErro(null);
    try {
      const res = await fetch("/admin/api/liquidez", { method: "POST" });
      const body = await res.json() as Dados & { error?: string; detail?: string };
      if (!res.ok) { setErro(`${body.error ?? res.status}${body.detail ? ` — ${body.detail}` : ""}`); return; }
      setData(body);
    } catch (e) {
      setErro(String(e).slice(0, 160));
    } finally { setRodando(false); }
  }, []);

  return (
    <TerminalPanel
      id="liquidez"
      title="SER A CONTRAPARTE"
      subtitle="a taxa da piscina cobre a perda impermanente?"
      icon="💧"
      source="yields.llama.fi + data-api.binance.vision"
    >
      <button className="adm-btn" onClick={() => void medir()} disabled={rodando}>
        {rodando ? "medindo LP…" : "💧 MEDIR LP EM AMM"}
      </button>

      {erro && (
        <div style={{ color: "var(--adm-red)", fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          {erro}
          {/* ⚠️ Fonte recusada NÃO é perda zero. A tela diz qual falhou. */}
          <div style={{ color: "var(--adm-ink-4)", fontSize: 11, marginTop: 3 }}>
            fonte recusada não é resultado — nada foi medido nesta tentativa
          </div>
        </div>
      )}

      {data && (
        <div style={{ marginTop: 10 }}>
          {/* ── VEREDITO PRIMEIRO ─────────────────────────────────────── */}
          <div style={{
            border: `1px solid ${COR[data.veredito.status]}`, borderRadius: 3,
            padding: "6px 8px", marginBottom: 8,
          }}>
            <div style={{ color: COR[data.veredito.status], fontSize: 13, fontWeight: 700, letterSpacing: "0.1em" }}>
              {ROTULO[data.veredito.status]}
            </div>
            <div style={{ color: "var(--adm-ink-3)", fontSize: 11, lineHeight: 1.6, marginTop: 3 }}>
              {data.veredito.texto}
            </div>
          </div>

          {/* ── AS DUAS RÉGUAS, LADO A LADO ───────────────────────────── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            {/* ⚠️ A VANTAGEM É A RÉGUA, e o rótulo diz "contra segurar" para
                ninguém a ler como retorno. Foi exatamente essa confusão que
                pintou de verde, em 09/08, duas piscinas que perderam. */}
            {/* ⚠️ E A COR OLHA O ABSOLUTO JUNTO (12/08). Em 01:05 a piscina
                rendeu −53,6% e esta vantagem de +0,73 saía VERDE, porque
                segurar rendeu −54,3. O rótulo já avisava; a cor desmentia. */}
            <Bloco rotulo="VANTAGEM vs SEGURAR" valor={pct(data.resumo.vantagemMedianaPct)}
                   cor={corDoResultado(data.resumo.lpMedianoPct, data.resumo.vantagemMedianaPct)} />
            <Bloco rotulo="PISCINA (absoluto)" valor={pct(data.resumo.lpMedianoPct)} cor="var(--adm-ink-2)" />
            <Bloco rotulo="SEGURAR (absoluto)" valor={pct(data.resumo.segurarMedianoPct)} cor="var(--adm-ink-2)" />
            <Bloco rotulo="TAXA" valor={pct(data.resumo.taxaMedianaPct)} cor="var(--adm-ink-2)" />
            <Bloco rotulo="PERDA IMPERM." valor={pct(data.resumo.ilMedianoPct)} cor="var(--adm-amber)" />
            {/* ⚠️ O gás é a SEGUNDA parcela do custo, e ela decide o sinal
                nesta faixa de capital. Vermelho quando não foi medido — não
                pode passar por "gás barato". */}
            <Bloco rotulo={data.resumo.semGas > 0 ? "GÁS — NÃO MEDIDO" : "GÁS (ida e volta)"}
                   valor={data.resumo.semGas > 0 ? "—" : pct(data.resumo.gasMedianoPct)}
                   cor={data.resumo.semGas > 0 ? "var(--adm-red)" : "var(--adm-amber)"} />
            <Bloco rotulo="CAPITAL" valor="$2.000" cor="var(--adm-ink-3)" />
            <Bloco rotulo="PISCINAS (n)" valor={`${data.resumo.medidas}/${data.minPiscinas}`} cor="var(--adm-ink-3)" />
          </div>

          {/* ⚠️ A PARCELA DO GÁS, conferível. US$ 0,20 pela ida e volta na
              Ethereum é número que exige conferência, e gwei é a unidade em
              que se sabe se um gás é plausível. */}
          {data.gasDetalhe && (
            <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginBottom: 4, lineHeight: 1.6 }}>
              gás: {data.gasDetalhe.unidades.toLocaleString("pt-BR")} unidades ×{" "}
              ${data.gasDetalhe.usdPorGas.toExponential(2)}/un = <b>${data.gasDetalhe.usdTotal.toFixed(2)}</b>
              {data.gasDetalhe.cotacaoUnidades != null && data.gasDetalhe.cotacaoUsd != null && (
                <> · da cotação: ${data.gasDetalhe.cotacaoUsd.toFixed(4)} por{" "}
                  {data.gasDetalhe.cotacaoUnidades.toLocaleString("pt-BR")} un</>
              )}
            </div>
          )}
          {data.resumo.incertezaTaxaPct != null && (
            <div style={{ fontSize: 11, color: "var(--adm-amber)", marginBottom: 4, lineHeight: 1.6 }}>
              ⚠️ desacordo da fonte sobre a MESMA taxa (apyBase vs apyMean30d): até{" "}
              {data.resumo.incertezaTaxaPct.toFixed(2)} pontos — é isso que define a faixa de empate
            </div>
          )}

          {/* ⚠️ AS MEDIANAS SÃO POR COLUNA E NÃO SE COMBINAM. Cada uma pode
              vir de uma piscina diferente — sem esta linha a tela convida a
              conferir `taxa − perda ≈ vantagem`, que não fecha. */}
          <div style={{ fontSize: 11, color: "var(--adm-amber)", marginBottom: 4, lineHeight: 1.6 }}>
            ⚠️ cada número acima é a mediana da SUA coluna e pode vir de uma piscina
            diferente — <b>não se somam</b>. A régua é a VANTAGEM; o resto é contexto
            {data.resumo.piscinaMediana && (
              <> · a mediana da régua é a linha marcada <b>▸</b> abaixo</>
            )}
          </div>

          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginBottom: 6, lineHeight: 1.6 }}>
            janela de {data.janelaDias} dias · bateu segurar em {data.resumo.ganhouDeSegurar}/{data.resumo.medidas}
            {data.resumo.semApy > 0 && <> · {data.resumo.semApy} sem taxa na fonte (fora do veredito)</>}
            {data.hostUsado && <> · fonte: {data.hostUsado}</>}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>PISCINA</th>
                  <th style={{ textAlign: "right" }}>DIAS</th>
                  <th style={{ textAlign: "right" }}>TAXA</th>
                  <th style={{ textAlign: "right" }}>PERDA</th>
                  <th style={{ textAlign: "right" }}>GÁS</th>
                  <th style={{ textAlign: "right" }}>PISCINA</th>
                  <th style={{ textAlign: "right" }}>SEGURAR</th>
                  <th style={{ textAlign: "right" }}>VANTAGEM</th>
                  <th>FONTE</th>
                </tr>
              </thead>
              <tbody>
                {data.piscinas.map((p) => (
                  <tr key={p.id} style={{ opacity: p.apyDe === "ausente" ? 0.55 : 1 }}>
                    <td>
                      {data.resumo.piscinaMediana === p.id && (
                        <b style={{ color: "var(--adm-cyan, var(--adm-ink-2))" }}>▸ </b>
                      )}
                      {p.rotulo}
                      {p.controle && (
                        <span style={{ color: "var(--adm-amber)", fontSize: 10 }}> · CONTROLE</span>
                      )}
                      <div style={{ color: "var(--adm-ink-4)", fontSize: 10 }}>{p.porque}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>{p.dias}</td>
                    <td style={{ textAlign: "right" }}>{p.apyDe === "ausente" ? "—" : pct(p.taxaPct)}</td>
                    <td style={{ textAlign: "right", color: "var(--adm-amber)" }}>{pct(p.ilPct)}</td>
                    <td style={{
                      textAlign: "right",
                      color: p.gasDe === "ausente" ? "var(--adm-red)" : "var(--adm-amber)",
                    }}>
                      {p.gasDe === "ausente" ? "n/medido" : `−${p.gasPct.toFixed(2)}%`}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {p.apyDe === "ausente" ? "—" : pct(p.lpPct)}
                    </td>
                    <td style={{ textAlign: "right" }}>{pct(p.segurarPct)}</td>
                    {/* ⚠️ A COR MORA AQUI, na vantagem — a única coluna que
                        responde "bateu segurar?". */}
                    <td style={{
                      textAlign: "right", fontWeight: 700,
                      color: p.apyDe === "ausente" ? "var(--adm-ink-4)"
                        : corDoResultado(p.lpPct, p.vantagemPct),
                    }}>
                      {p.apyDe === "ausente" ? "—" : pct(p.vantagemPct)}
                    </td>
                    <td style={{ color: p.apyDe === "ausente" ? "var(--adm-red)" : "var(--adm-ink-4)", fontSize: 11 }}>
                      {p.apyDe === "ausente" ? "AUSENTE" : p.apyDe}
                      {/* ⚠️ QUAL piscina a fonte casou. Sem isto, uma taxa
                          implausível não tem como ser conferida. */}
                      {p.casada && (
                        <div style={{ fontSize: 10 }}>
                          {p.casada.symbol}
                          {p.casada.tvlUsd != null && <> · ${(p.casada.tvlUsd / 1e6).toFixed(1)}M</>}
                          {p.apyAnualPct != null && <> · {p.apyAnualPct.toFixed(2)}%/ano</>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.naoCasadas.length > 0 && (
            <div style={{ color: "var(--adm-amber)", fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
              ⚠️ não encontradas na fonte: {data.naoCasadas.join(", ")} — entraram sem taxa e
              ficaram fora do veredito
            </div>
          )}

          {/* ── O QUE NÃO FOI MEDIDO, NA TELA ─────────────────────────── */}
          <div style={{ marginTop: 8, borderTop: "1px solid var(--adm-border)", paddingTop: 6 }}>
            <div style={{ fontSize: 11, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>
              O QUE ESTA MEDIÇÃO NÃO INCLUI
            </div>
            <ul style={{ margin: "3px 0 0", paddingLeft: 14 }}>
              {data.naoMedido.map((n, i) => (
                <li key={i} style={{ color: "var(--adm-ink-4)", fontSize: 11, lineHeight: 1.6 }}>{n}</li>
              ))}
            </ul>
          </div>

          {data.falhas.length > 0 && (
            <div style={{ color: "var(--adm-ink-4)", fontSize: 10, marginTop: 5 }}>
              recusas de fonte: {data.falhas.join(" · ")}
            </div>
          )}
        </div>
      )}
    </TerminalPanel>
  );
}

function Bloco({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div style={{
      border: "1px solid var(--adm-border)", borderRadius: 3,
      padding: "4px 8px", minWidth: 92,
    }}>
      <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.1em" }}>{rotulo}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: cor }}>{valor}</div>
    </div>
  );
}
