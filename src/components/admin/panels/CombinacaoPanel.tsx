"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";
import AvisoRodadaNova from "../AvisoRodadaNova";
import { corDoResultado } from "@/lib/admin/cor-resultado";

/**
 * COMBINAR AS VERDES — a única coisa que a correlação diz que funciona.
 *
 * ⚠️ ESTE PAINEL EXISTE PARA NÃO DEIXAR TRÊS COISAS ACONTECEREM.
 *
 * 1. ELEGER VENCEDOR POR FÓRMULA. A carteira quase certamente rende MENOS que
 *    a melhor parte — a média de 3,40% e 1,18% é 2,29%, aritmética e não
 *    descoberta. Um painel que mostrasse só o Sharpe diria "a carteira ganhou"
 *    escondendo que o dono ganharia menos. Os dois números ficam lado a lado,
 *    do mesmo tamanho, e a escolha é dele.
 *
 * 2. RANQUEAR PELO RISCO QUE NÃO MEDIMOS. O empréstimo de stablecoin quase
 *    nunca tem dia negativo — o risco dele é exploit e despegue, declarados
 *    como NÃO medidos. Ordenar por volatilidade premiaria a estratégia que
 *    esconde melhor o próprio risco. O aviso é vermelho e fica em cima.
 *
 * 3. ESQUECER QUE DIVERSIFICAR CUSTA. Dividir o capital em quatro paga quatro
 *    entradas. O custo aparece na conta, não numa nota de rodapé.
 */

type Parte = {
  slug: string; nome: string; motor: string;
  diasProprios: number; diasUsados?: number | null; idaEVoltaPct: number;
  brutoPct: number | null; liquidoPct: number | null;
  volAnualPct: number | null; tomboPct: number | null; diasNegativos: number | null;
};
type Dados = {
  veredito: { readable: boolean; status: "verde" | "cinza" | "morta"; verdict: string };
  resumo: {
    fluxos: number; diasComuns: number;
    primeiroDia: string | null; ultimoDia: string | null;
    rho: number | null; apostasEfetivas: number | null;
    capitalUsd: number; fatiaUsd: number | null; custoEntradaPct: number;
    carteiraBrutaPct: number | null; carteiraLiquidaPct: number | null;
    carteiraVolPct: number | null; carteiraTomboPct: number | null;
    melhorParteNome: string | null; melhorParteLiquidaPct: number | null;
    melhorParteTomboPct: number | null;
    medianaDiasProprios: number | null; fonte: string | null;
  };
  partes: Parte[];
  correlacao: { slugs: string[]; matriz: number[][] };
  falhas: string[] | null;
  naoMedido: string[];
  tookMs: number;
};

const pct = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const usd = (n: number) => `$${n.toLocaleString("pt-BR")}`;

const COR: Record<Dados["veredito"]["status"], string> = {
  verde: "var(--adm-green)", morta: "var(--adm-red)", cinza: "var(--adm-ink-4)",
};

/** Correlação alta é vermelha porque é ela que DESTRÓI a tese desta fase. */
function corRho(v: number): string {
  const a = Math.abs(v);
  if (a >= 0.7) return "var(--adm-red)";
  if (a >= 0.4) return "var(--adm-amber)";
  return "var(--adm-green)";
}

export default function CombinacaoPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [rodando, setRodando] = useState(false);
  /** Quando a tela recebeu o que mostra — alimenta o aviso de rodada nova. */
  const [vistoEm, setVistoEm] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/combinacao", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(`${json.error ?? res.status}${json.detail ? ` — ${json.detail}` : ""}`);
      setD(json); setVistoEm(Date.now());
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  const r = d?.resumo;

  return (
    <TerminalPanel
      id="combinacao" title="COMBINAR AS VERDES"
      subtitle="as rendas aprovadas juntas — a carteira ganha de concentrar na melhor?"
      icon="🧬" source="okx (funding) + yields.llama.fi/chart (histórico de APY)"
    >
      <AvisoRodadaNova slugs={["carteira_verde", "funding_basis"]} vistoEm={vistoEm} />
      <div style={{ fontSize: 12, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
        A Fase 4 mostrou que <b>o gás não é a barreira — a correlação é</b>: ρ=0,07 no funding
        transforma 50 nomes em 12 apostas, e o 51º perpétuo não faz nada. O que pode funcionar
        é juntar rendas com <b>motores diferentes</b> — posicionamento, crédito, juro soberano,
        emissão. Quatro causas, não quatro sabores da mesma.
      </div>

      <button className="adm-btn" onClick={rodar} disabled={rodando}>
        {rodando ? "alinhando as séries por data…" : "🧬 MEDIR A CARTEIRA COMBINADA · contra a melhor parte"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 13, marginTop: 6 }}>{err}</div>}

      {d && r && (
        <div style={{ marginTop: 10 }}>
          {/* VEREDITO PRIMEIRO — a mesma ordem de todos os painéis do laboratório. */}
          <div style={{
            border: `1px solid ${d.veredito.readable ? "var(--adm-border)" : "var(--adm-amber)"}`,
            borderRadius: 4, padding: "7px 9px", marginBottom: 10, fontSize: 13, lineHeight: 1.6,
            color: d.veredito.readable ? "var(--adm-ink-2)" : "var(--adm-amber)",
          }}>
            <span style={{ color: COR[d.veredito.status] }}>● {d.veredito.status.toUpperCase()}</span>
            {" — "}{d.veredito.verdict}
          </div>

          {/* ⚠️ A ARMADILHA Nº 2, EM VERMELHO E EM CIMA. Se ela ficasse no rodapé,
                 alguém leria a coluna VOL como se fosse risco. */}
          <div style={{
            border: "1px solid var(--adm-red)", borderRadius: 3, padding: "5px 7px",
            marginBottom: 8, fontSize: 11, color: "var(--adm-red)", lineHeight: 1.6,
          }}>
            ⚠️ O RISCO QUE DECIDE NÃO ESTÁ NESTA TABELA. Exploit de contrato, despegue e falha
            de emissor não aparecem em volatilidade. O empréstimo de stablecoin quase não tem
            dia negativo — <b>ordenar por VOL premiaria a estratégia que esconde melhor o
            próprio risco</b>, não a mais segura.
          </div>

          {/* ⚠️ A COMPARAÇÃO QUE DECIDE, os dois do MESMO tamanho. */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10,
          }}>
            <div style={{ border: "1px solid var(--adm-border)", borderRadius: 4, padding: "7px 9px" }}>
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", letterSpacing: "0.08em" }}>
                CARTEIRA · {r.fluxos} fluxos de {usd(r.fatiaUsd ?? 0)}
              </div>
              <div style={{
                fontSize: 18, fontWeight: 700,
                color: corDoResultado(r.carteiraLiquidaPct),
              }}>
                {pct(r.carteiraLiquidaPct)}<span style={{ fontSize: 12, fontWeight: 400 }}>/ano</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.6 }}>
                bruto {pct(r.carteiraBrutaPct)} · entrada −{r.custoEntradaPct.toFixed(3)}%
                <div>tombo <b style={{ color: "var(--adm-ink-3)" }}>{r.carteiraTomboPct?.toFixed(2) ?? "—"}</b> pontos
                {" · "}vol {pct(r.carteiraVolPct, 1)}</div>
              </div>
            </div>
            <div style={{ border: "1px solid var(--adm-border)", borderRadius: 4, padding: "7px 9px" }}>
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", letterSpacing: "0.08em" }}>
                CONCENTRAR NA MELHOR · {usd(r.capitalUsd)}
              </div>
              <div style={{
                fontSize: 18, fontWeight: 700,
                color: corDoResultado(r.melhorParteLiquidaPct),
              }}>
                {pct(r.melhorParteLiquidaPct)}<span style={{ fontSize: 12, fontWeight: 400 }}>/ano</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.6 }}>
                {r.melhorParteNome ?? "—"}
                <div>tombo <b style={{ color: "var(--adm-ink-3)" }}>{r.melhorParteTomboPct?.toFixed(2) ?? "—"}</b> pontos</div>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
            {/* A AMOSTRA: dias em COMUM, que é o que sustenta a correlação. */}
            <b style={{ color: "var(--adm-ink-3)" }}>{r.diasComuns} dias</b> em que TODOS os
            fluxos têm valor{r.primeiroDia && ` (${r.primeiroDia} → ${r.ultimoDia})`}
            {r.medianaDiasProprios != null && (
              <span> · mediana de {Math.round(r.medianaDiasProprios)}d por fluxo isolado</span>
            )}
            {r.rho != null && (
              <div style={{ color: "var(--adm-amber)" }}>
                correlação média <b>{Math.round(r.rho * 100)}%</b> — os {r.fluxos} fluxos
                equivalem a <b>{r.apostasEfetivas?.toFixed(1)}</b> apostas independentes
              </div>
            )}
            {r.fonte && <div>fonte: {r.fonte}</div>}
          </div>

          {/* A MATRIZ. É ela que diz se os motores são mesmo diferentes. */}
          {d.correlacao.slugs.length > 1 && (
            <div style={{ overflowX: "auto", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginBottom: 3 }}>
                CORRELAÇÃO ENTRE OS FLUXOS — verde é o que diversifica, vermelho é o que
                repete
              </div>
              <table style={{ fontSize: 11, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--adm-ink-4)" }}>
                    <th style={{ padding: "2px 6px" }}></th>
                    {d.correlacao.slugs.map((s) => (
                      <th key={s} style={{ padding: "2px 6px", textAlign: "right" }}>
                        {s.slice(0, 9)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.correlacao.matriz.map((linha, i) => (
                    <tr key={d.correlacao.slugs[i]} style={{ borderTop: "1px solid var(--adm-border)" }}>
                      <td style={{ padding: "2px 6px", color: "var(--adm-ink-3)" }}>
                        {d.correlacao.slugs[i].slice(0, 14)}
                      </td>
                      {linha.map((v, j) => (
                        <td key={j} style={{
                          padding: "2px 6px", textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: i === j ? "var(--adm-ink-4)" : corRho(v),
                        }}>
                          {i === j ? "—" : v.toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* AS PARTES. Ordenadas pelo LÍQUIDO — a régua que o veredito usa. */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "3px 5px" }}>FLUXO</th>
                  <th style={{ padding: "3px 5px" }}>LÍQ/ANO</th>
                  <th style={{ padding: "3px 5px" }}>BRUTO</th>
                  <th style={{ padding: "3px 5px" }}>ENTRADA</th>
                  <th style={{ padding: "3px 5px" }}>VOL</th>
                  <th style={{ padding: "3px 5px" }}>TOMBO</th>
                  <th style={{ padding: "3px 5px" }}>% NEG</th>
                  {/* ⚠️⚠️ A AMOSTRA, E ELA MUDOU DE COLUNA (01/09). Isto imprimia
                      `diasProprios` — o histórico INTEIRO do fluxo, até 1.273 —
                      ao lado de um número medido sobre os dias EM COMUM (97 na
                      rodada de 31/08). A coluna afirmava um n que não era o n da
                      linha. O histórico continua visível, agora rotulado como
                      tal e separado do que sustenta o número. */}
                  <th style={{ padding: "3px 5px" }} title="dias em comum que produziram os números desta linha">DIAS USADOS</th>
                  <th style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }} title="histórico próprio do fluxo — NÃO é o n desta linha">HIST.</th>
                </tr>
              </thead>
              <tbody>
                {[...d.partes]
                  .sort((a, b) => (b.liquidoPct ?? -Infinity) - (a.liquidoPct ?? -Infinity))
                  .map((p) => (
                    <tr key={p.slug} style={{ borderTop: "1px solid var(--adm-border)", textAlign: "right" }}>
                      <td style={{ textAlign: "left", padding: "3px 5px", color: "var(--adm-ink-2)" }}>
                        {p.nome}
                        {/* O MOTOR, porque a tese depende dele e não do número. */}
                        <div style={{ fontSize: 10, color: "var(--adm-ink-4)" }}>{p.motor}</div>
                      </td>
                      <td style={{
                        padding: "3px 5px",
                        color: corDoResultado(p.liquidoPct),
                      }}>
                        <b>{pct(p.liquidoPct)}</b>
                      </td>
                      <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>{pct(p.brutoPct)}</td>
                      <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                        −{p.idaEVoltaPct.toFixed(3)}%
                      </td>
                      <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>{pct(p.volAnualPct, 1)}</td>
                      <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                        {p.tomboPct?.toFixed(2) ?? "—"}
                      </td>
                      <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                        {p.diasNegativos == null ? "—" : `${Math.round(p.diasNegativos * 100)}%`}
                      </td>
                      <td style={{ padding: "3px 5px", color: "var(--adm-ink-3)" }}>
                        {p.diasUsados ?? "—"}
                      </td>
                      <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>{p.diasProprios}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {d.falhas && (
            <div style={{ fontSize: 11, color: "var(--adm-amber)", marginTop: 6, lineHeight: 1.6 }}>
              ⚠️ o que não entrou: {d.falhas.join(" · ")}
            </div>
          )}

          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 8, lineHeight: 1.7 }}>
            <div style={{ color: "var(--adm-amber)" }}>⚠️ NÃO está nesta conta:</div>
            {d.naoMedido.map((n) => <div key={n}>· {n}</div>)}
            {/* ⚠️ POR QUE O NÚMERO NÃO BATE COM O DO 🏦, e é de propósito.
                   Conferência de 08/08: o empréstimo aparece com 2,67% aqui e
                   3,56% lá. As duas estão certas para perguntas diferentes, e
                   sem esta nota parecem dois painéis se contradizendo — que é a
                   família de defeito que esta semana já achou seis vezes. */}
            <div style={{ marginTop: 4, color: "var(--adm-amber)" }}>
              ⚠️ BRUTO aqui é a <b>média da série própria</b> daquela UMA piscina, ao longo
              dos <b>DIAS USADOS</b> — os dias em comum entre todos os fluxos, não o histórico
              da coluna HIST. No 🏦 RENDIMENTO é a <b>mediana à vista</b> entre vários
              produtos, hoje. Divergem por construção: o empréstimo deu 2,67% (média dos
              {" "}{d.resumo.diasComuns} dias em comum da aave-v3 USDT) contra 3,56% (mediana de 5 produtos hoje).
              Nenhum está errado — são perguntas diferentes, e só a da esquerda serve para
              correlacionar.
            </div>
            <div style={{ marginTop: 4 }}>
              A carteira é de PESO IGUAL e nunca rebalanceia. LÍQ/ANO desconta UMA ida e volta
              por fluxo, sobre a fatia dele — dividir em {r.fluxos} paga {r.fluxos} entradas.
              {" · "}{(d.tookMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
