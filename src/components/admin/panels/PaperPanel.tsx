"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type OpenPos = { symbol: string; side: string; costUsd: number; unrealized: number };
type RecentTrade = { symbol: string; side: string; pnlUsd: number; pnlPct: number | null; route: string | null; closedAt: string | null };
type Row = {
  source: string; label: string;
  startingUsd: number; cashUsd: number; equity: number;
  realizedPnl: number; unrealizedPnl: number; returnPct: number;
  wins: number; losses: number; winRate: number | null;
  avgWin: number | null; avgLoss: number | null; profitFactor: number | null;
  best: number | null; worst: number | null; closedTrades: number;
  openPositions: number; exposure: number; openBook: OpenPos[]; recentTrades: RecentTrade[]; curve: number[];
  retired: boolean;
  /** ⚠️ `RET`/`WR` vêm da CONTA, `FECH.` vem do LIVRO VIVO. Quando divergem,
   *  a linha está somando dois livros — ver o comentário longo na rota. */
  divergencia: { trades: number; usd: number; livroTrades: number; livroUsd: number } | null;
  /** Por que a mesa está calada. `operando` = não está. */
  silencio: { kind: string; label: string; action: string; isProblem: boolean };
};
type PR = { rows: Row[]; totals: { startingUsd: number; equity: number; cashUsd: number; buracoUsd: number; comBuraco: number; realizedPnl: number; openPositions: number; exposure: number; closedTrades: number; comDivergencia: number; comProblema: number }; fetchedAt: string };

/**
 * A COR DE CADA SILÊNCIO — e por que `disciplina` NÃO é âmbar.
 *
 * Os cinco estados pedem ações opostas, e pintar todos de alerta desfaria o
 * trabalho inteiro: a URÐR recusando 15 de 15 candidatos por veto do histórico
 * medido é a mesa mais correta do laboratório. Se ela acende igual a uma mesa
 * quebrada, quem olhar vai "consertar" a certa.
 */
const COR_DO_SILENCIO: Record<string, string> = {
  operando:     "var(--adm-ink-4)",
  disciplina:   "var(--adm-ink-3)",
  seca:         "var(--adm-amber)",
  fome:         "var(--adm-amber)",
  /** Decidiu e a carteira não abriu: o sinal existe, a posição não. */
  nao_executou: "var(--adm-red)",
  quebra:       "var(--adm-red)",
  sem_rastro:   "var(--adm-red)",
};
type RepairState = {
  plan: Array<{ source: string; label: string; from: number; to: number; deltaUsd: number }>;
  last: { at: string; totalUsd: number } | null;
  /** ⚠️ Contador `realized_pnl_usd` divergindo das posições — ver reconcile.ts. */
  contadorDivergente?: Array<{
    source: string; label: string; guardado: number | null;
    calculado: number; driftUsd: number; retired: boolean;
  }>;
  /**
   * ⚠️ O QUE O BOTÃO DE FATO ESCREVE — e é MENOR que `contadorDivergente`.
   *
   * O diagnóstico acima conta TODAS as carteiras divergentes, inclusive as
   * aposentadas; o plano só toca as VIVAS, pela mesma regra do caixa (cicatriz
   * não se reescreve). Hoje são 13 contra 3. Um botão anunciando 13 e
   * escrevendo 3 seria a mesma família de mentira que este painel existe para
   * acabar — por isso os dois números aparecem separados na tela.
   */
  planContador?: Array<{ source: string; label: string; from: number; to: number; deltaUsd: number }>;
};

/**
 * ⚠️ RECAPITALIZAÇÃO — o TERCEIRO bloco de dinheiro deste painel, e por isso
 * o rótulo dele tem que dizer sozinho o que ele faz (06/08).
 *
 * Os outros dois já existiam: "devolver o capital às carteiras vivas" (reparo
 * de vazamento) e o ✓ de conferência. Três controles que mexem em capital na
 * mesma tela é exatamente o cenário em que o dono clicou num achando que era
 * outro — aconteceu com os dois botões de backtest, e custou dias.
 *
 * Por isso: verbo diferente ("recapitalizar", não "devolver"), consequência
 * dita na frente (ARQUIVA a rodada), e motivo escrito obrigatório antes de o
 * botão sequer habilitar.
 */
type RecapState = {
  plan: Array<{
    source: string; label: string; fromUsd: number; toUsd: number;
    deltaUsd: number; why: string; openPositions: number; closedPositions: number;
  }>;
  last: { at: string; reason: string; entries: Array<{ source: string; fromUsd: number; toUsd: number }> } | null;
};

const MEDAL = ["🥇", "🥈", "🥉"];
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const usdc = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(0)}`);
const pctS = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
const col = (n: number) => (n >= 0 ? "var(--adm-green)" : "var(--adm-red)");

function Sparkline({ curve, h = 20 }: { curve: number[]; h?: number }) {
  if (!curve || curve.length < 2) return null;
  const w = 100, min = Math.min(100, ...curve), max = Math.max(100, ...curve), range = max - min || 1;
  const pts = curve.map((v, i) => `${((i / (curve.length - 1)) * w).toFixed(1)},${(h - ((v - min) / range) * (h - 2) - 1).toFixed(1)}`).join(" ");
  const color = curve[curve.length - 1] >= 100 ? "var(--adm-green)" : "var(--adm-red)";
  const baseY = h - ((100 - min) / range) * (h - 2) - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: h, display: "block" }} role="img" aria-label="curva de patrimônio">
      <line x1={0} y1={baseY} x2={w} y2={baseY} stroke="var(--adm-border)" strokeDasharray="2 2" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 13, color: color ?? "var(--adm-ink-2)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

export default function PaperPanel() {
  const [data, setData] = useState<PR | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const realtime = useAdminRealtime();
  const [repair, setRepair] = useState<RepairState | null>(null);
  const [repairing, setRepairing] = useState(false);
  /**
   * ⚠️ AS APOSENTADAS FICAM NO ARQUIVO — decisão do dono, 05/08.
   *
   * Elas ocupavam 10 das 23 linhas e apareciam em vermelho como se tivessem
   * perdido operando, quando o buraco delas é a cicatriz PRESERVADA do
   * vazamento de julho. O painel operacional mostra quem está VIVO; a cicatriz
   * vira uma aba que se abre quando alguém quer ver o histórico.
   */
  const [verArquivo, setVerArquivo] = useState(false);
  const [recap, setRecap] = useState<RecapState | null>(null);
  const [recapMotivo, setRecapMotivo] = useState("");
  const [recapando, setRecapando] = useState(false);
  const [recapErro, setRecapErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/paper");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  // O plano de reparo é lido junto, mas NUNCA executado sozinho. Ver o
  // cabeçalho de `paper/reconcile.ts`: reparo automático transformaria o
  // detector de vazamento em encobridor de vazamento.
  const loadRepair = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/paper-repair");
      if (res.ok) setRepair(await res.json());
    } catch { /* seção some, o painel continua */ }
  }, []);

  const loadRecap = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/paper-recap");
      if (res.ok) setRecap(await res.json());
    } catch { /* a seção some, o painel continua */ }
  }, []);

  useEffect(() => {
    load(); loadRepair(); loadRecap();
    const t = setInterval(load, realtime?.status === "live" ? 60_000 : 90_000);
    return () => clearInterval(t);
  }, [load, loadRepair, loadRecap, realtime?.status]);

  async function runRepair() {
    setRepairing(true);
    try {
      const res = await fetch("/admin/api/paper-repair", { method: "POST" });
      if (res.ok) { await load(); await loadRepair(); }
    } catch { /* estado antigo permanece */ } finally { setRepairing(false); }
  }

  async function runRecap() {
    setRecapando(true); setRecapErro(null);
    try {
      const res = await fetch("/admin/api/paper-recap", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sources: (recap?.plan ?? []).map((p) => p.source),
          reason: recapMotivo,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setRecapMotivo("");
      await load(); await loadRepair(); await loadRecap();
    } catch (e) { setRecapErro(String(e)); } finally { setRecapando(false); }
  }

  const todas = data?.rows ?? [];
  // `retired` vem do registro de mesas — mesa fora do registro conta como VIVA,
  // porque o desconhecido não ganha dispensa.
  const arquivadas = todas.filter((r) => r.retired);
  /** As mesas VIVAS — o denominador do card OPERANDO. */
  const vivas = todas.filter((r) => !r.retired);
  const rows = verArquivo ? arquivadas : todas.filter((r) => !r.retired);
  const totalRet = data && data.totals.startingUsd > 0 ? (data.totals.equity / data.totals.startingUsd - 1) * 100 : 0;

  return (
    <TerminalPanel id="paper" title="PAPER · GATE.IO" subtitle="③ SÓ AS CARTEIRAS, sem ranking — unidade: patrimônio em USDT" icon="📈" source="supabase/paper_accounts">
      {loading && <div className="adm-shimmer" style={{ height: 140 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 13 }}>{error}</div>}

      {/* O ROMBO QUE SOBROU. O bug do débito-sem-posição foi corrigido em 01/08,
          mas correção não devolve dinheiro: uma mesa com $51 de $1.000 não abre
          posição nenhuma e some do experimento sem nada ficar vermelho. */}
      {repair && repair.plan.length > 0 && (
        <div style={{
          border: "1px solid var(--adm-red)", borderRadius: 4, padding: "7px 9px", marginBottom: 10,
          fontSize: 12, lineHeight: 1.6, color: "var(--adm-ink-3)",
        }}>
          <div style={{ color: "var(--adm-red)", fontWeight: 700, letterSpacing: "0.08em" }}>
            ⚠ {repair.plan.length} CARTEIRA(S) VIVA(S) COM CAIXA A MENOS —{" "}
            {usd(repair.plan.reduce((s, p) => s + p.deltaUsd, 0))} a devolver
          </div>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", margin: "3px 0" }}>
            {repair.plan.slice(0, 6).map((p) => `${p.label}: ${usd(p.from)} → ${usd(p.to)}`).join(" · ")}
            {repair.plan.length > 6 && ` · +${repair.plan.length - 6}`}
          </div>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)" }}>
            O caixa é o que decide se a mesa consegue abrir posição — abaixo do piso ela
            simplesmente para, sem erro e sem alerta. Isto devolve o capital ao valor que os
            trades justificam. Não é automático de propósito: se fosse, um vazamento NOVO
            seria zerado a cada rodada e o detector nunca mais acusaria nada.
          </div>
          <button className="adm-btn" style={{ marginTop: 6 }} onClick={runRepair} disabled={repairing}>
            {repairing ? "devolvendo…" : "↺ devolver o capital às carteiras vivas"}
          </button>
        </div>
      )}
      {/**
        * ⚠️ O ESCOPO DO ✓ PRECISA ESTAR NA FRASE (05/08).
        *
        * Este aviso dizia "caixa bate com os trades", sem qualificador, acima de
        * uma lista com as 23 carteiras. `planRepair` só olha as VIVAS — decisão
        * de 04/08, para não recreditar as aposentadas e apagar a cicatriz do
        * vazamento de julho. Então o ✓ era verdadeiro e a frase era falsa: dez
        * carteiras logo abaixo tinham buraco, uma delas de $991.
        *
        * Afirmação sem escopo é a mesma família do "inconclusivo lido como
        * aprovado". O escopo agora está na frase, e o buraco das aposentadas
        * aparece do lado em vez de ficar implícito.
        */}
      {repair && repair.plan.length === 0 && repair.last && (
        <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginBottom: 8, lineHeight: 1.6 }}>
          ✓ caixa bate com os trades <b>nas carteiras VIVAS</b> · último reparo{" "}
          {new Date(repair.last.at).toLocaleString("pt-BR")} ({usd(repair.last.totalUsd)} devolvidos)
          — desvio que aparecer daqui pra frente é vazamento NOVO
          {data && data.totals.comBuraco > 0 && (
            <div style={{ color: "var(--adm-amber)", marginTop: 3 }}>
              ⚠ {data.totals.comBuraco} carteiras APOSENTADAS seguem com{" "}
              <b>{usd(data.totals.buracoUsd)}</b> de buraco — cicatriz preservada do vazamento de
              julho, não desempenho. Recreditá-las apagaria o registro.
            </div>
          )}
        </div>
      )}

      {/**
        * ⚠️ O CONTADOR DIVERGINDO DAS POSIÇÕES (05/08).
        *
        * Sintoma DIFERENTE do desvio de caixa, e por isso um bloco próprio:
        * caixa errado é dinheiro que apareceu ou sumiu; contador errado é a
        * mesma verdade escrita duas vezes com valores distintos — e é o
        * segundo que faz duas telas mostrarem números diferentes para a mesma
        * carteira. Misturar os dois esconderia qual foi consertado.
        */}
      {repair?.contadorDivergente && repair.contadorDivergente.length > 0 && (
        <div style={{
          border: "1px solid var(--adm-amber)", borderRadius: 4, padding: "7px 9px",
          marginBottom: 10, fontSize: 12, lineHeight: 1.6, color: "var(--adm-ink-3)",
        }}>
          <div style={{ color: "var(--adm-amber)", fontWeight: 700, letterSpacing: "0.08em" }}>
            ⚠ {repair.contadorDivergente.length} CARTEIRA(S) COM O CONTADOR DE P&amp;L FORA DAS POSIÇÕES
          </div>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", margin: "3px 0" }}>
            {repair.contadorDivergente.slice(0, 6).map((c) => (
              `${c.label}: coluna ${usdc(c.guardado)} vs posições ${usdc(c.calculado)}`
            )).join(" · ")}
          </div>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)" }}>
            A coluna <code>realized_pnl_usd</code> é o que o PAINEL lê; a soma das posições
            vivas é o que a CONFERÊNCIA usa. Quando divergem, as duas telas contam histórias
            diferentes da mesma carteira. Acontece num reset parcial: as posições são
            arquivadas e o contador fica para trás.
          </div>

          {/**
            * ⚠️⚠️ O BOTÃO QUE FALTAVA — e a falta dele é a invariante nº 32.
            *
            * O reparo do contador foi escrito na biblioteca (`planRealizedRepair`)
            * e ligado na rota (o POST escreve os dois), mas NENHUMA tela o
            * chamava: o único botão morava no bloco do CAIXA, que só aparece
            * quando há déficit. Sem déficit, o painel mostrava o diagnóstico e
            * não oferecia conserto — exatamente "ligar não é montar".
            *
            * ⚠️ E OS DOIS NÚMEROS FICAM À VISTA. O aviso acima conta TODAS as
            * divergentes (13); este plano só toca as VIVAS (3), porque cicatriz
            * de mesa aposentada não se reescreve. Anunciar 13 e escrever 3 seria
            * a mesma mentira com outra roupa.
            */}
          {repair.planContador && repair.planContador.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: "var(--adm-ink-3)", marginTop: 4 }}>
                Serão corrigidas <b>{repair.planContador.length}</b> — só as VIVAS. As
                aposentadas ficam como estão: o número delas é cicatriz do vazamento de
                julho, e reescrevê-lo apagaria o registro.
              </div>
              {repair.plan.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--adm-red)", marginTop: 3 }}>
                  ⚠ este botão também devolve o caixa do bloco vermelho acima — a rota
                  aplica os dois planos na mesma passada.
                </div>
              )}
              <button className="adm-btn" style={{ marginTop: 6 }}
                      onClick={runRepair} disabled={repairing}>
                {repairing ? "alinhando…" : `↺ alinhar o contador às posições (${repair.planContador.length})`}
              </button>
            </>
          )}
        </div>
      )}

      {/* ══ RECAPITALIZAÇÃO — dar a cada mesa o capital que a ESTRATÉGIA pede.
              O bloco fica ACIMA da tabela porque muda o significado de tudo que
              vem abaixo: os retornos exibidos passam a ser de uma rodada nova. */}
      {recap && recap.plan.length > 0 && (
        <div style={{
          border: "1px solid var(--adm-cyan)", borderRadius: 4, padding: "8px 10px",
          marginBottom: 10, fontSize: 12, lineHeight: 1.6, color: "var(--adm-ink-3)",
        }}>
          <div style={{ color: "var(--adm-cyan)", fontWeight: 700, letterSpacing: "0.08em" }}>
            ⚖ {recap.plan.length} MESA(S) COM CAPITAL DIFERENTE DO QUE A ESTRATÉGIA PEDE
          </div>

          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", margin: "4px 0 6px" }}>
            As 23 carteiras receberam $1.000 (ou $300) independentemente da estratégia. Isso
            não é neutro: mesa sub-capitalizada não rende menos — <b>rende negativo por custo
            fixo</b>, e o resultado é lido como &quot;a estratégia não presta&quot;.
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <tbody>
                {recap.plan.map((p) => (
                  <tr key={p.source} style={{ borderTop: "1px solid var(--adm-border)" }}>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-2)", whiteSpace: "nowrap" }}>
                      {p.label}
                    </td>
                    <td style={{ padding: "3px 5px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {usd(p.fromUsd)} → <b style={{ color: "var(--adm-cyan)" }}>{usd(p.toUsd)}</b>
                    </td>
                    <td style={{ padding: "3px 5px", textAlign: "right", color: "var(--adm-ink-4)", whiteSpace: "nowrap" }}>
                      {p.openPositions + p.closedPositions > 0
                        ? `arquiva ${p.openPositions + p.closedPositions}`
                        : "sem posição"}
                    </td>
                    {/* O PORQUÊ do número, vindo do registro. Capital sem
                        justificativa vira constante que ninguém confere. */}
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)", fontSize: 10 }}>
                      {p.why}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ⚠️ A CONSEQUÊNCIA VEM ANTES DO BOTÃO, não depois. */}
          <div style={{
            border: "1px solid var(--adm-amber)", borderRadius: 3, padding: "5px 7px",
            margin: "7px 0", fontSize: 11, color: "var(--adm-amber)", lineHeight: 1.6,
          }}>
            ⚠️ Isto <b>ARQUIVA a rodada atual</b> e recomeça a medição. Não é um ajuste de
            coluna: somar a diferença em <code>starting_usd</code> reescreveria o retorno
            histórico — uma perda de 2% em $1.000 viraria 0,4% em $5.000 sem nenhum trade
            novo ter acontecido. O histórico continua consultável; o que não acontece é o
            número velho ser recalculado com a régua nova.
          </div>

          <label style={{ display: "block", fontSize: 11, color: "var(--adm-ink-4)" }}>
            motivo (obrigatório, mínimo 15 caracteres — sem ele, daqui a um mês ninguém sabe
            se o degrau na curva foi decisão ou acidente)
            <input
              value={recapMotivo}
              onChange={(e) => setRecapMotivo(e.target.value)}
              placeholder="ex.: capital corrigido para o que cada estratégia exige (Fase 1)"
              style={{
                display: "block", width: "100%", marginTop: 3, padding: "4px 6px",
                background: "transparent", border: "1px solid var(--adm-border)",
                borderRadius: 3, color: "var(--adm-ink-2)", fontSize: 12, fontFamily: "inherit",
              }}
            />
          </label>

          <button
            className="adm-btn" style={{ marginTop: 6 }}
            onClick={runRecap}
            disabled={recapando || recapMotivo.trim().length < 15}
          >
            {recapando
              ? "recapitalizando…"
              : recapMotivo.trim().length < 15
                ? `⚖ escreva o motivo (${recapMotivo.trim().length}/15)`
                : `⚖ RECAPITALIZAR ${recap.plan.length} mesa(s) e arquivar a rodada`}
          </button>
          {recapErro && (
            <div style={{ color: "var(--adm-red)", fontSize: 11, marginTop: 4 }}>{recapErro}</div>
          )}
        </div>
      )}

      {recap && recap.plan.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginBottom: 8, lineHeight: 1.6 }}>
          ✓ toda mesa viva está com o capital que a estratégia dela pede
          {recap.last && (
            <> · última recapitalização em {new Date(recap.last.at).toLocaleString("pt-BR")}
              {" — "}<i>&quot;{recap.last.reason}&quot;</i></>
          )}
        </div>
      )}

      {data && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[
              { label: "PATRIMÔNIO", v: usd(data.totals.equity), sub: pctS(totalRet, 2), subColor: col(totalRet) },
              // O caixa REAL ao lado do contábil. Antes só o contábil aparecia,
              // e ele somava $9.350 a mais que a soma de `cash_usd`.
              { label: "CAIXA REAL", v: usd(data.totals.cashUsd),
                sub: data.totals.buracoUsd < -0.01 ? `buraco ${usd(data.totals.buracoUsd)}` : "bate",
                subColor: data.totals.buracoUsd < -0.01 ? "var(--adm-amber)" : "var(--adm-green)" },
              { label: "REALIZADO", v: usdc(data.totals.realizedPnl), subColor: col(data.totals.realizedPnl) },
              { label: "ABERTAS", v: `${data.totals.openPositions}`, sub: `exp ${usd(data.totals.exposure)}` },
              /**
               * ⚠️ "TODAS AS MESAS ESTÃO RODANDO?" era pergunta que só o SQL
               * respondia. Mas o card CONTA, não absolve.
               *
               * A primeira versão dizia "11/11 · nenhuma pede ação" — verde,
               * tranquilizador, e ao lado de quatro mesas que não operam há
               * dez dias. Silêncio explicado não é defeito, e mesmo assim é
               * silêncio: quem olha o topo do painel precisa saber quantas
               * mesas estão de fato COM DINHEIRO NA RUA, não quantas foram
               * absolvidas. O número que pede ação vira o subtítulo, e a
               * ausência dele não vira um selo verde.
               */
              { label: "OPERANDO", v: `${vivas.filter((r) => r.silencio.kind === "operando").length}/${vivas.length}`,
                sub: data.totals.comProblema > 0
                  ? `${data.totals.comProblema} pede(m) ação`
                  : `${vivas.filter((r) => r.silencio.kind !== "operando").length} calada(s), com motivo`,
                subColor: data.totals.comProblema > 0 ? "var(--adm-amber)" : "var(--adm-ink-4)" },
            ].map((t) => (
              <div key={t.label} style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 8px" }}>
                <div style={{ fontSize: 11, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{t.label}</div>
                <div style={{ fontSize: 17, color: "var(--adm-cyan)", fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
                {t.sub && <div style={{ fontSize: 11, color: t.subColor ?? "var(--adm-ink-4)" }}>{t.sub}</div>}
              </div>
            ))}
          </div>

          {/* ── ARQUIVO. Decisão do dono: "mesa aposentada vira arquivo".
                 O painel operacional mostra quem está VIVO; a cicatriz do
                 vazamento de julho vira histórico que se abre quando alguém
                 quer ver, em vez de dez linhas vermelhas permanentes. */}
          {arquivadas.length > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <button
                className="adm-btn" onClick={() => { setVerArquivo(!verArquivo); setOpen(null); }}
                style={{ padding: "3px 8px", fontSize: 11 }}
              >
                {verArquivo
                  ? `◀ voltar às ${todas.length - arquivadas.length} mesas VIVAS`
                  : `🗄 ver o arquivo (${arquivadas.length} aposentadas)`}
              </button>
              {verArquivo && (
                <span style={{ fontSize: 11, color: "var(--adm-amber)", lineHeight: 1.5 }}>
                  cicatriz preservada do vazamento de julho — <b>não é desempenho</b>.
                  Recreditá-las apagaria o registro.
                </span>
              )}
            </div>
          )}

          <table className="adm-table">
            {/* ⚠️ FECHADOS É A AMOSTRA, e ela estava escondida atrás de um
                clique (06/08). A tabela dá MEDALHA por retorno — 🥇🥈🥉 — e o
                número de trades só aparecia ao expandir a linha. Uma mesa com 2
                trades e +8% recebia a medalha de uma com 200 e +5%, e não havia
                como ver isso sem clicar. Mesma forma do `avgTrades` no painel
                do que funcionou, e do LÍQ/ANO fora de ordem no do funding. */}
            <thead><tr><th style={{ width: 26 }}></th><th>CARTEIRA</th><th>EQUITY</th><th>RET</th><th>WR</th><th>FECH.</th><th>AB</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const flat = r.closedTrades === 0 && r.openPositions === 0;
                const isOpen = open === r.source;
                return (
                  <Fragment key={r.source}>
                    <tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : r.source)}>
                      <td>{MEDAL[i] ?? `#${i + 1}`}</td>
                      {/* ⚠️ O MOTIVO DO SILÊNCIO VIAJA COM O NOME, não atrás de
                          um clique. A pergunta "todos os agentes estão rodando
                          corretamente?" tinha que ser respondível SEM expandir
                          linha nenhuma — foi por não ser que a FREYJA passou
                          dias parecendo desligada enquanto recusava 9 candidatos
                          a cada 30 minutos, com o motivo escrito de cada um. */}
                      <td style={{ maxWidth: 150 }}>
                        <div style={{ color: "var(--adm-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.label}
                          {r.divergencia && <span style={{ color: "var(--adm-amber)" }} title="esta linha soma dois livros — abra para a conferência"> ⚠</span>}
                        </div>
                        {r.silencio.kind !== "operando" && (
                          <div style={{ fontSize: 10, color: COR_DO_SILENCIO[r.silencio.kind] ?? "var(--adm-ink-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {r.silencio.label}
                          </div>
                        )}
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{usd(r.equity)}</td>
                      <td style={{ color: flat ? "var(--adm-ink-4)" : col(r.returnPct) }}>{flat ? "—" : pctS(r.returnPct)}</td>
                      <td>{r.winRate == null ? "—" : `${r.winRate.toFixed(0)}%`}</td>
                      {/* Abaixo de 10 fechados o retorno é anedota, e a medalha
                          ao lado afirma o contrário. O âmbar desfaz. */}
                      <td style={{
                        fontVariantNumeric: "tabular-nums",
                        color: r.closedTrades < 10 ? "var(--adm-amber)" : "var(--adm-ink-4)",
                      }}>{r.closedTrades}{r.closedTrades < 10 ? " ⚠" : ""}</td>
                      <td style={{ color: "var(--adm-cyan)" }}>{r.openPositions} {isOpen ? "▲" : "▼"}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ padding: "8px 4px 10px", background: "var(--adm-bg-raise)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
                            <Stat label="REALIZADO" value={usdc(r.realizedPnl)} color={col(r.realizedPnl)} />
                            <Stat label="N-REALIZADO" value={usdc(r.unrealizedPnl)} color={col(r.unrealizedPnl)} />
                            <Stat label="PROFIT F." value={r.profitFactor == null ? "—" : r.profitFactor.toFixed(2)} color={r.profitFactor != null && r.profitFactor >= 1 ? "var(--adm-green)" : undefined} />
                            <Stat label="FECHADOS" value={String(r.closedTrades)} />
                            <Stat label="MELHOR" value={usdc(r.best)} color="var(--adm-green)" />
                            <Stat label="PIOR" value={usdc(r.worst)} color="var(--adm-red)" />
                            <Stat label="EXPOSIÇÃO" value={usd(r.exposure)} />
                            <Stat label="CAIXA" value={usd(r.cashUsd)} />
                          </div>

                          {/* ⚠️ A CONFERÊNCIA DOS DOIS LIVROS. Não escolhe um
                              lado: a conta guarda o que houve antes do
                              arquivamento, o livro guarda o que ainda está
                              sendo medido, e a tela mostrava os dois como se
                              fossem um retrato só. */}
                          {r.divergencia && (
                            <div style={{ fontSize: 11, color: "var(--adm-amber)", lineHeight: 1.6, marginBottom: 8, border: "1px solid var(--adm-border)", borderRadius: 4, padding: "4px 6px" }}>
                              ⚠ esta linha soma <b>dois livros</b>. A CONTA diz{" "}
                              {r.wins + r.losses} decisão(ões) e {usdc(r.realizedPnl)}; o LIVRO VIVO diz{" "}
                              {r.divergencia.livroTrades} e {usdc(r.divergencia.livroUsd)}.
                              <div style={{ color: "var(--adm-ink-4)", marginTop: 2 }}>
                                A diferença é o que foi ARQUIVADO e saiu da medição — o passado não
                                se apaga nem se recalcula. <b>RET</b> e <b>WR</b> acima vêm da conta;{" "}
                                <b>FECH.</b>, <b>PROFIT F.</b> e a curva vêm do livro vivo.
                              </div>
                            </div>
                          )}

                          {/* O silêncio por extenso: o rótulo cabe na tabela, a
                              AÇÃO não — e sem a ação a leitura vira decoração. */}
                          {r.silencio.kind !== "operando" && (
                            <div style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 8 }}>
                              <span style={{ color: COR_DO_SILENCIO[r.silencio.kind] ?? "var(--adm-ink-4)" }}>
                                {r.silencio.isProblem ? "⚠" : "✓"} {r.silencio.label}
                              </span>
                              {r.silencio.action && (
                                <div style={{ color: "var(--adm-ink-4)" }}>{r.silencio.action}</div>
                              )}
                            </div>
                          )}
                          {r.curve.length > 1 && (
                            <div style={{ marginBottom: r.openBook.length ? 8 : 0 }}>
                              <Sparkline curve={r.curve} />
                              <div style={{ fontSize: 10, color: "var(--adm-ink-4)", marginTop: 2 }}>curva realizada · base 100 → <span style={{ color: col(r.curve[r.curve.length - 1] - 100) }}>{r.curve[r.curve.length - 1].toFixed(0)}</span></div>
                            </div>
                          )}
                          {r.openBook.length > 0 && (
                            <div style={{ marginBottom: (r.recentTrades ?? []).length ? 8 : 0 }}>
                              <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 3 }}>LIVRO ABERTO</div>
                              {r.openBook.map((p, j) => (
                                <div key={j} style={{ display: "flex", gap: 6, fontSize: 11, padding: "1px 0", alignItems: "center" }}>
                                  <span style={{ color: p.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", width: 26 }}>{p.side}</span>
                                  <span style={{ color: "var(--adm-ink-2)", flex: 1, fontFamily: "monospace" }}>{p.symbol}</span>
                                  <span style={{ color: "var(--adm-ink-4)" }}>{usd(p.costUsd)}</span>
                                  <span style={{ color: col(p.unrealized), width: 42, textAlign: "right" }}>{usdc(p.unrealized)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {(r.recentTrades ?? []).length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 3 }}>ÚLTIMAS ORDENS</div>
                              {r.recentTrades.map((t, j) => (
                                <div key={j} style={{ display: "flex", gap: 6, fontSize: 11, padding: "1px 0", alignItems: "center" }}>
                                  <span style={{ color: t.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", width: 26 }}>{t.side}</span>
                                  <span style={{ color: "var(--adm-ink-2)", fontFamily: "monospace", width: 44 }}>{t.symbol}</span>
                                  <span style={{ color: "var(--adm-ink-4)", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.route ?? "—"}</span>
                                  <span style={{ color: t.pnlPct == null ? "var(--adm-ink-4)" : col(t.pnlPct), width: 46, textAlign: "right" }}>{t.pnlPct == null ? "—" : pctS(t.pnlPct, 2)}</span>
                                  <span style={{ color: col(t.pnlUsd), width: 46, textAlign: "right" }}>{`${t.pnlUsd >= 0 ? "+" : "−"}$${Math.abs(t.pnlUsd).toFixed(2)}`}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 6 }}>
            Fills no preço vivo da Gate.io · equity = capital + realizado + não-realizado (mark-to-market).
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
