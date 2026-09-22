/**
 * ⚠️⚠️⚠️ CRX-1 — A VARREDURA SÓ SABIA PERGUNTAR "CRESCEU?".
 *
 * O retest independente reproduziu o defeito com o produto inteiro rodando:
 * snapshot sintético diz `quote = 100`, a projeção aplica e o dia fica em
 * −32; os trades REAIS chegam com 80 e o processo é interrompido antes da
 * projeção. Três ciclos de cron depois a varredura seguia devolvendo `[]` —
 * a quantidade não cresceu, a taxa não cresceu, e o recebido **diminuiu**.
 *
 * O dia ficava em −32 quando o resultado verdadeiro era −52, e uma COMPRA
 * nova saía com o stop de 50 já ultrapassado.
 *
 * ⚠️ O CÁLCULO JÁ EXISTIA. Desde o CR-2 a projeção corrige a queda do
 * recebido numa venda. Quem não sabia era a DESCOBERTA — duas peças
 * respondendo "há trabalho pendente?" com critérios diferentes, a família do
 * A113 no lugar mais caro.
 *
 * ⚠️ E CADA SENTIDO TEM A SUA MARCA D'ÁGUA. Crescimento mede contra
 * `applied_*` (o que já entrou na posição); regressão mede contra `ledger_*`
 * (o que o livro já disse) — porque a liquidação adianta `applied` antes da
 * ingestão, de propósito, e comparar com ele acusaria regressão onde não há.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { ingerirSnapshotDaOrdem, ingerirTrades } from "@/lib/cex/execucao/intents";
import { projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";
import {
  pendenciasFinanceiras, recuperarPendenciaFinanceira,
} from "@/lib/autopilot/recuperacao-financeira";
import { avaliarRisco, lerEstadoFinanceiroDaSessao } from "@/lib/autopilot/estado-financeiro";

const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
const hoje = () => new Date().toISOString().slice(0, 10);

let banco: ReturnType<typeof bancoFalso>;
const chamar = (n: string, a: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (x: string, y: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(n, a).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });
const S = () => banco.sessoes[0];
const oEfeito = () => banco.efeitos.find((x) => x.intent_id === "V")!;
const portao = async () =>
  avaliarRisco(await lerEstadoFinanceiroDaSessao("S1", { db: banco.cliente }));

function montar(over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id: "S1", wallet_address: "0xX", exchange_id: "binance",
    is_active: true, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(),
    pnl_today: -30, daily_loss_stop_usd: 50, frozen_until_day: null,
    last_reset_day: hoje(), trades_today: 0, max_trades_per_day: 20,
    max_trade_usd: 1000, conexao_id: "C1", quarentena_em: null,
    contabilidade_incompleta_em: null, risk_mode: "moderado", ...over });
  banco.posicoes.push({ id: "p1", session_id: "S1", wallet_address: "0xX",
    exchange_id: "binance", base: "BTC", pair: "BTC/USDT", entry_price: 10_000,
    base_amount: 0.01, cost_usd: 100, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null });
  banco.intents.push({ id: "V", client_order_id: "cV", wallet_address: "0xX",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    fee_total: null, fee_currency: null, canceled_qty: 0, conexao_id: "C1",
    external_order_id: "ORD-V" });
}

/** O estado exato do retest: 100 projetado, 80 no livro, projeção interrompida. */
async function ateAInterrupcao() {
  montar();
  await ingerirSnapshotDaOrdem(banco.cliente, "V", "ORD-V", {
    cumulativeQty: 0.01, avgPrice: 10_000, cumulativeQuote: 100,
    fee: 2, feeCurrency: "USDT", executedAt: null });
  const p1 = await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
  expect(p1.ok && p1.realizado).toBeCloseTo(-2, 10);
  expect(Number(S().pnl_today)).toBeCloseTo(-32, 10);

  // Os trades REAIS dizem 80 — e a projeção NÃO é chamada. Interrupção.
  const ing = await ingerirTrades(banco.cliente, "V", "ORD-V", [{
    tradeId: "T1", qty: 0.01, price: 8000, quote: 80,
    fee: 2, feeCurrency: "USDT", orderId: "ORD-V" }]);
  expect(ing.ok, ing.ok ? "" : ing.porque).toBe(true);
  expect(Number(banco.intents[0].filled_quote)).toBeCloseTo(80, 10);
  expect(Number(oEfeito().applied_quote)).toBeCloseTo(100, 10);
}

beforeEach(() => { banco = bancoFalso(); });

describe("CRX-1 — a redução do recebido não some da varredura", () => {
  it("crx1_reducao_de_quote_e_descoberta_apos_interrupcao", async () => {
    await ateAInterrupcao();
    const p = await pendenciasFinanceiras(50, { chamarRpc: chamar });
    expect(p, "a varredura tem de enxergar a queda").toHaveLength(1);
    expect(p![0]).toMatchObject({ intentId: "V", motivo: "recebido_regrediu" });
    // ⚠️ O livro já tem a verdade: não é preciso ir à corretora.
    expect(p![0].precisaVenue).toBe(false);
  });

  it("crx1_recovery_aplica_o_delta_e_cruza_o_loss_stop", async () => {
    await ateAInterrupcao();
    const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))![0];
    const r = await recuperarPendenciaFinanceira(p, {
      db: banco.cliente, chamarRpc: chamar });
    expect(r.ok, r.ok ? "" : r.porque).toBe(true);

    // 80 − 100 − 2 = −22, e −2 já estava aplicado ⇒ delta −20.
    expect(r.ok && r.realizado).toBeCloseTo(-20, 10);
    expect(Number(S().pnl_today)).toBeCloseTo(-52, 10);
    expect(S().frozen_until_day).toBe(hoje());
    // ⚠️ E a COMPRA nova não sai mais.
    const g = await portao();
    expect(g.ok).toBe(false);
  });

  it("crx1_tres_ciclos_convergem_e_a_pendencia_fecha", async () => {
    await ateAInterrupcao();
    for (let i = 0; i < 3; i++) {
      const lista = await pendenciasFinanceiras(50, { chamarRpc: chamar });
      for (const pend of lista ?? []) {
        await recuperarPendenciaFinanceira(pend, { db: banco.cliente, chamarRpc: chamar });
      }
    }
    // ⚠️ Converge no primeiro ciclo e NÃO oscila nos seguintes.
    expect(Number(S().pnl_today)).toBeCloseTo(-52, 10);
    expect(Number(oEfeito().applied_quote)).toBeCloseTo(80, 10);
    expect(Number(oEfeito().ledger_quote)).toBeCloseTo(80, 10);
    // ⚠️ E a pendência FECHA — uma que nunca converge é a mesma doença pelo
    // avesso: a sessão ficaria presa para sempre.
    expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(0);
  });

  it("crx1_quantidade_que_regride_tambem_e_descoberta", async () => {
    montar();
    await ingerirSnapshotDaOrdem(banco.cliente, "V", "ORD-V", {
      cumulativeQty: 0.01, avgPrice: 10_000, cumulativeQuote: 100,
      fee: 2, feeCurrency: "USDT", executedAt: null });
    await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    // O livro regride em QUANTIDADE — divergência, não correção.
    banco.intents[0].filled_qty = 0.004;

    const p = await pendenciasFinanceiras(50, { chamarRpc: chamar });
    expect(p).toHaveLength(1);
    expect(p![0].motivo).toBe("quantidade_regrediu");
    const r = await recuperarPendenciaFinanceira(p![0], {
      db: banco.cliente, chamarRpc: chamar });
    expect(r.ok).toBe(false);
    // ⚠️ Fail-closed E visível: a divergência fica gravada e prende a COMPRA.
    expect(oEfeito().divergencia).toBe("regressao_de_quantidade");
    expect((await portao()).ok).toBe(false);
    expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(1);
  });

  it("crx1_a_liquidacao_que_adianta_applied_NAO_vira_falso_positivo", async () => {
    /**
     * ⚠️ A razão de a regressão medir contra `ledger_*` e não contra
     * `applied_*`: a liquidação adianta o marcador ANTES de os fills serem
     * ingeridos (desenho do A136/A142). Medir contra `applied` acusaria
     * regressão onde há só uma ingestão que ainda não chegou — e a varredura
     * viveria cheia de pendências falsas.
     */
    montar();
    const e = { intent_id: "V", session_id: "S1", exchange_id: "binance",
      base: "BTC", side: "sell", applied_qty: 0.01, applied_quote: 100,
      ledger_qty: 0, ledger_quote: 0, reservado_qty: 0, reservado_usd: 0,
      fee_aplicada_usd: 2, custo_removido_usd: 100, pnl_aplicado_usd: -2,
      taxa_opaca: false, divergencia: null };
    banco.efeitos.push(e);
    // O livro ainda está em zero: os fills não foram ingeridos.
    expect(Number(banco.intents[0].filled_qty)).toBe(0);
    const p = await pendenciasFinanceiras(50, { chamarRpc: chamar });
    // ⚠️ `filled_qty > 0` é pré-requisito da varredura, então este intent nem
    // entra — e é o comportamento certo: não há fato no livro para projetar.
    expect(p).toHaveLength(0);
  });

  it("⚠️ o SQL pergunta nos DOIS sentidos, com a marca certa em cada um", () => {
    const i = SQL.indexOf("create or replace function public.autopilot_projecao_pendente");
    expect(i).toBeGreaterThan(-1);
    const corpo = SQL.slice(i, SQL.indexOf("$$;", i));
    // cresceu → contra applied_*
    expect(corpo).toMatch(/p_filled_qty, 0\) {3}> coalesce\(p_applied_qty, 0\)/);
    expect(corpo).toMatch(/p_filled_quote, 0\) > coalesce\(p_applied_quote, 0\)/);
    // regrediu → contra ledger_*
    expect(corpo).toMatch(/p_filled_qty, 0\) {3}< coalesce\(p_ledger_qty, 0\)/);
    expect(corpo).toMatch(/p_filled_quote, 0\) < coalesce\(p_ledger_quote, 0\)/);
    expect(corpo).toMatch(/p_taxa_usd is not null and p_taxa_usd < coalesce\(p_fee_aplicada, 0\)/);
    // e a varredura usa ESTA função, não uma segunda cópia da regra
    expect(SQL).toMatch(/public\.autopilot_projecao_pendente\(\s*\n?\s*c\.filled_qty/);
    // a marca do livro acompanha a correção na venda
    expect(SQL).toMatch(/ledger_quote\s+= case when v_i\.side = 'sell' then v_i\.filled_quote/);
  });
});
