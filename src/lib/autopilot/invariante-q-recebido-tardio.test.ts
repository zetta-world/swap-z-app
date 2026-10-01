/**
 * ⚠️⚠️⚠️ INVARIANTE Q — O RECEBIDO TARDIO PRECISA ENTRAR NO LEDGER.
 *
 * O A143 mandou assentar antes de liquidar, e assentar é
 * `cex_ingest_order_snapshot`. Só que a definição herdada da 0059 escreveu a
 * suposição errada por extenso:
 *
 *     "fill sem qty só existe para carregar correção de fee, nunca quote"
 *
 * O mundo da ordem limitada não é esse. O ACK traz `filled` e NÃO traz `cost`
 * — a venue só materializa o dinheiro quando os trades aparecem:
 *
 *     snapshot 1:  qty = 0,01   quote = (ausente)
 *     snapshot 2:  qty = 0,01   quote = 600
 *
 * O segundo caía no ramo "qty não cresceu", que só sabia tratar fee. O
 * recebido era DESCARTADO. `filled_quote` ficava 0 para sempre — e é ele que o
 * A143 (liquidação) e o A145 (custo da compra) leem.
 *
 * ⚠️ POR ISSO NENHUM TESTE AQUI MEXE EM `intent.filled_quote` À MÃO. Todos
 * passam pela MESMA ingestão que o assentamento usa; o que se mede é a linha
 * durável depois dela.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { ingerirSnapshotDaOrdem, ingerirTrades } from "@/lib/cex/execucao/intents";
import {
  assentarFatosDaSaida, assentarELiquidarSaida,
} from "@/lib/autopilot/assentamento-da-saida";
import { projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";
import { reservarExposicaoDoBot } from "@/lib/autopilot/reserva-de-inventario";
import {
  avaliarAutorizacaoDaSessaoParaExecucao,
} from "@/lib/autopilot/autorizacao-de-execucao";

const SQL64 = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
const SQL59 = readFileSync("supabase/migrations/0059_fee_cumulativa_e_cobertura.sql", "utf8");
const hojeUtc = () => new Date().toISOString().slice(0, 10);

let banco: ReturnType<typeof bancoFalso>;
const chamar = (nome: string, args: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(nome, args).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });
const deps = () => ({ db: banco.cliente, chamarRpc: chamar });

function sessao(over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id: "S1", wallet_address: "0xQ", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: 0, daily_loss_stop_usd: 50,
    frozen_until_day: null, ...over });
}
function posicao(over: Record<string, unknown> = {}) {
  banco.posicoes.push({ id: `pos-${banco.posicoes.length + 1}`, session_id: "S1",
    wallet_address: "0xQ", exchange_id: "binance", base: "BTC", pair: "BTC/USDT",
    entry_price: 10_000, base_amount: 0.01, cost_usd: 100, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null, ...over });
}
function intent(id: string, over: Record<string, unknown> = {}): string {
  banco.intents.push({ id, client_order_id: `c-${id}`, wallet_address: "0xQ",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    fee_total: null, fee_currency: null, canceled_qty: 0, conexao_id: "C1",
    external_order_id: null, ...over });
  return id;
}
const oIntent = (id: string) => banco.intents.find((i) => i.id === id)!;
const aSessao = () => banco.sessoes.find((s) => s.id === "S1")!;
const aPosicao = () => banco.posicoes.find((p) => p.session_id === "S1" && p.base === "BTC");
const oEfeito = (id: string) => banco.efeitos.find((e) => e.intent_id === id);

/** O ACK da limitada: quantidade sim, dinheiro ainda não. */
const ackSemCusto = (qty: number) => ({
  cumulativeQty: qty, avgPrice: 10_000, cumulativeQuote: null,
  fee: null, feeCurrency: null, executedAt: null,
});

beforeEach(() => { banco = bancoFalso(); });

describe("Q.1 — o recebido que chega depois ENTRA no livro", () => {
  it("⚠️⚠️⚠️ snapshot(0,01 · ausente) → snapshot(0,01 · 600) ⇒ filled_quote = 600", async () => {
    intent("i1", { side: "buy", order_type: "limit", external_order_id: "ORD-1" });

    const um = await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    expect(um.ok, um.ok ? "" : um.porque).toBe(true);
    expect(Number(oIntent("i1").filled_qty)).toBeCloseTo(0.01, 12);
    // ⚠️ Ausente NÃO virou zero afirmado: virou "ainda não medido".
    expect(Number(oIntent("i1").filled_quote)).toBe(0);

    const dois = await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: null, feeCurrency: null, executedAt: null,
    });
    expect(dois.ok, dois.ok ? "" : dois.porque).toBe(true);
    if (!dois.ok) return;
    expect(dois.inseridos).toBe(1);
    expect(dois.regrediu).toBe(false);

    // ⚠️ O QUE O ACHADO PEDE, na linha durável.
    expect(Number(oIntent("i1").filled_qty)).toBeCloseTo(0.01, 12);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(600, 10);
    // ⚠️ E o ajuste não inventou quantidade: a base segue 0,01.
    const ajuste = banco.fills.find((f) => Number(f.qty) === 0);
    expect(ajuste).toBeDefined();
    expect(Number(ajuste!.quote_amount)).toBeCloseTo(600, 10);
    expect(String(ajuste!.dedupe_key)).toMatch(/^ordadj:/);
  });

  it("⚠️⚠️ replay do MESMO snapshot é no-op", async () => {
    intent("i1", { side: "buy", external_order_id: "ORD-1" });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    const cheio = { cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
                    fee: null, feeCurrency: null, executedAt: null };
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", cheio);
    const dedois = await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", cheio);
    expect(dedois.ok && dedois.inseridos).toBe(0);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(600, 10);
  });

  it("⚠️⚠️ 600 → 620 entra como delta de 20, não como 620 de novo", async () => {
    intent("i1", { side: "buy", external_order_id: "ORD-1" });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: null, feeCurrency: null, executedAt: null });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 62_000, cumulativeQuote: 620,
      fee: null, feeCurrency: null, executedAt: null });
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(620, 10);
    expect(Number(oIntent("i1").filled_qty)).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️ `null` NÃO É ZERO: ausência depois do recebido não zera nem acusa", async () => {
    intent("i1", { side: "buy", external_order_id: "ORD-1" });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: null, feeCurrency: null, executedAt: null });

    const mudo = await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    expect(mudo.ok && mudo.regrediu).toBe(false);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(600, 10);
  });

  it("⚠️⚠️⚠️ recebido MEDIDO abaixo do livro é REGRESSÃO — fail-closed", async () => {
    intent("i1", { side: "buy", external_order_id: "ORD-1" });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: null, feeCurrency: null, executedAt: null });

    const menor = await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 58_000, cumulativeQuote: 580,
      fee: null, feeCurrency: null, executedAt: null });
    expect(menor.ok).toBe(true);
    if (!menor.ok) return;
    // ⚠️ Ninguém "desrecebe" dinheiro. O livro NÃO é rebaixado por um snapshot,
    // e quem chama recebe a bandeira — é ela que fecha a passada no A143.
    expect(menor.regrediu).toBe(true);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(600, 10);
  });

  it("⚠️ regressão de QUANTIDADE continua sendo regressão", async () => {
    intent("i1", { side: "buy", external_order_id: "ORD-1", requested_qty: 1 });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: null, feeCurrency: null, executedAt: null });
    const menos = await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.004, avgPrice: 60_000, cumulativeQuote: 600,
      fee: null, feeCurrency: null, executedAt: null });
    expect(menos.ok && menos.regrediu).toBe(true);
  });

  it("⚠️⚠️ taxa e recebido descobertos JUNTOS entram numa linha só", async () => {
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: 2, feeCurrency: "USDT", executedAt: null });
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(600, 10);
    expect(Number(oIntent("i1").fee_total)).toBeCloseTo(2, 10);
    expect(oIntent("i1").fee_currency).toBe("USDT");
    expect(banco.fills.filter((f) => Number(f.qty) === 0)).toHaveLength(1);
  });
});

describe("Q.2 — synthetic → real continua de pé", () => {
  it("⚠️⚠️⚠️ lote TODO DEDUPADO não apaga o ajuste de recebido", async () => {
    /**
     * `v_sint` soma QTY, e o ajuste de recebido tem qty zero. Sem esta
     * guarda, um lote sem trade novo passava na cobertura, o delete levava o
     * ajuste junto e `filled_quote` desabava de 600 para 0 — sem um único
     * trade novo. É o buraco que a 0059 já havia tapado para a FEE.
     */
    intent("i1", { side: "buy", external_order_id: "ORD-1" });
    // O trade REAL já chegou: nenhum sintético de quantidade sobra no livro.
    const real = await ingerirTrades(banco.cliente, "i1", "ORD-1", [
      { tradeId: "T1", qty: 0.01, price: 58_000, quote: 580, orderId: "ORD-1" },
    ]);
    expect(real.ok, real.ok ? "" : real.porque).toBe(true);
    // A venue corrige o custo para cima DEPOIS: ajuste de qty ZERO com quote.
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: null, feeCurrency: null, executedAt: null });
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(600, 10);
    expect(banco.fills.filter((f) => f.sintetico === true)).toHaveLength(1);

    // Releitura do histórico: os mesmos trades, nada novo. `sum(qty)` dos
    // sintéticos é ZERO — a cobertura de QUANTIDADE não tem o que dizer.
    const dedupado = await ingerirTrades(banco.cliente, "i1", "ORD-1", [
      { tradeId: "T1", qty: 0.01, price: 58_000, quote: 580, orderId: "ORD-1" },
    ]);
    const vazio = dedupado;
    expect(vazio.ok).toBe(false);
    if (vazio.ok) return;
    expect(vazio.porque).toBe("cobertura_quote_incompleta");
    // ⚠️ ADIADO, nunca fatal: a próxima leitura pode fechar a cobertura.
    expect(vazio.adiado).toBe(true);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(600, 10);
  });

  it("⚠️⚠️ trades reais SUBSTITUEM — inclusive somando menos (o real é fato)", async () => {
    intent("i1", { side: "buy", external_order_id: "ORD-1" });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: null, feeCurrency: null, executedAt: null });

    const reais = await ingerirTrades(banco.cliente, "i1", "ORD-1", [
      { tradeId: "T1", qty: 0.01, price: 58_000, quote: 580, orderId: "ORD-1" },
    ]);
    expect(reais.ok, reais.ok ? "" : reais.porque).toBe(true);
    // ⚠️ Recusar aqui deixaria o livro MENTINDO para sempre. O que pega a
    // regressão resultante é a guarda do autopilot, com o livro já correto.
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(580, 10);
    expect(banco.fills.filter((f) => f.sintetico === true)).toHaveLength(0);
  });

  it("⚠️ cobertura de FEE não foi afrouxada pelo conserto", async () => {
    intent("i1", { side: "buy", external_order_id: "ORD-1" });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 60_000, cumulativeQuote: 600,
      fee: 2, feeCurrency: "USDT", executedAt: null });
    const semFee = await ingerirTrades(banco.cliente, "i1", "ORD-1", [
      { tradeId: "T1", qty: 0.01, price: 60_000, quote: 600, orderId: "ORD-1" },
    ]);
    expect(semFee.ok).toBe(false);
    if (!semFee.ok) expect(semFee.porque).toBe("cobertura_fee_incompleta");
    expect(Number(oIntent("i1").fee_total)).toBeCloseTo(2, 10);
  });
});

describe("Q.3 — a cadeia inteira: assentar → projetar → liquidar", () => {
  it("⚠️⚠️⚠️ assentarFatosDaSaida devolve o recebido DURÁVEL, não o da resposta", async () => {
    sessao();
    intent("i1", { side: "buy", external_order_id: "ORD-1" });
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    expect(Number(oIntent("i1").filled_quote)).toBe(0);

    const r = await assentarFatosDaSaida("i1", "ORD-1",
      { filled: 0.01, cost: 600, average: 60_000 }, 0.01, deps());
    expect(r.ok, r.ok ? "" : r.porque).toBe(true);
    if (!r.ok) return;
    expect(r.qty).toBeCloseTo(0.01, 12);
    expect(r.quote).toBeCloseTo(600, 10);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(600, 10);
  });

  it("⚠️⚠️⚠️ A145 pela ingestão de verdade: cost_usd 0 → 600, exatamente uma vez", async () => {
    sessao();
    intent("c1", { side: "buy", order_type: "limit", external_order_id: "ORD-C1" });

    // 1. o ACK: quantidade sim, dinheiro não. A posição nasce com custo ZERO.
    await ingerirSnapshotDaOrdem(banco.cliente, "c1", "ORD-C1", ackSemCusto(0.01));
    const abre = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(abre.ok && abre.motivo).toBe("aplicado");
    expect(Number(aPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
    expect(Number(aPosicao()!.cost_usd)).toBe(0);

    // 2. o dinheiro aparece — PELA MESMA INGESTÃO do assentamento.
    const assentou = await assentarFatosDaSaida("c1", "ORD-C1",
      { filled: 0.01, cost: 600, average: 60_000 }, 0.01, deps());
    expect(assentou.ok && assentou.quote).toBeCloseTo(600, 10);

    const aplica = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(aplica.ok && aplica.motivo).toBe("ajuste_sem_quantidade");
    expect(Number(aPosicao()!.cost_usd)).toBeCloseTo(600, 10);
    expect(Number(aPosicao()!.base_amount)).toBeCloseTo(0.01, 12);

    // 3. EXATAMENTE UMA VEZ.
    const replay = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(replay.ok && replay.motivo).toBe("sem_delta");
    expect(Number(aPosicao()!.cost_usd)).toBeCloseTo(600, 10);
    expect(Number(oEfeito("c1")!.applied_quote)).toBeCloseTo(600, 10);

    // 4. e a exposição conta os 600.
    intent("c2", { side: "buy" });
    const teto = await reservarExposicaoDoBot("c2", 100, 650, { chamarRpc: chamar });
    expect(teto.ok).toBe(false);
    if (!teto.ok) expect(teto.motivo).toBe("teto_estourado");
  });

  it("⚠️⚠️⚠️ O CENÁRIO DO BRIEFING: livro (0,01 · 0) + venue (0,01 · 100 · fee 2)", async () => {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });

    // O livro ANTES: quantidade sim, recebido ainda não.
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", ackSemCusto(0.01));
    expect(Number(oIntent("i1").filled_quote)).toBe(0);

    const r = await assentarELiquidarSaida("i1", "ORD-1", {
      filled: 0.01, cost: 100, average: 10_000,
      fee: { cost: 2, currency: "USDT" },
    }, 0.01, deps());
    expect(r.ok, r.ok ? "" : `${r.etapa}/${r.motivo}: ${r.porque}`).toBe(true);
    if (!r.ok) return;

    // ⚠️ O recebido ENTROU no ledger — sem isto a conta era 0 − 100 − 2.
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(100, 10);
    expect(Number(oIntent("i1").fee_total)).toBeCloseTo(2, 10);
    expect(r.quote).toBeCloseTo(100, 10);
    expect(r.resultado.realizado).toBeCloseTo(-2, 10);

    // ⚠️ ANTES DE QUALQUER BUY NOVA.
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);
    expect(aSessao().frozen_until_day).toBe(hojeUtc());
    const portao = avaliarAutorizacaoDaSessaoParaExecucao({
      ativa: true, expiraEm: new Date(Date.now() + 3_600_000).toISOString(),
      congeladaAte: aSessao().frozen_until_day as string | null,
      tradesHoje: 0, maxTradesPorDia: 5, maxTradeUsd: 1_000,
      conexaoId: "C1", emQuarentena: false, contabilidadeIncompleta: false,
    });
    expect(portao.ok).toBe(false);
    if (!portao.ok) expect(portao.motivo).toBe("sessao_congelada");
  });
});

describe("Q.4 — a 0059 ficou intacta; a 0064 redefiniu", () => {
  it("⚠️ a 0059 continua com a suposição antiga escrita — ninguém a reescreveu", () => {
    expect(SQL59).toMatch(
      /check \(qty > 0 or \(qty = 0 and quote_amount = 0\)\)/);
  });

  it("⚠️⚠️ a 0064 refaz a constraint e redefine as DUAS RPCs", () => {
    expect(SQL64).toMatch(/add constraint cex_fills_qty_check check \(qty >= 0\)/);
    expect(SQL64).toMatch(
      /create or replace function public\.cex_ingest_order_snapshot/);
    expect(SQL64).toMatch(/create or replace function public\.cex_ingest_trades/);
    // A guarda que preserva o ajuste de recebido na substituição.
    expect(SQL64).toMatch(/'porque', 'cobertura_quote_incompleta'/);
    // `null` = não medido, nos dois lados da conta.
    expect(SQL64).toMatch(/case when p_cumulative_quote is null then 0/);
    expect(SQL64).toMatch(
      /p_cumulative_quote is not null and p_cumulative_quote < v_quote - 1e-9/);
    // Chave própria do ajuste, com o quote dentro.
    expect(SQL64).toMatch(/'ordadj:'/);
  });

  it("⚠️ e os três call sites mandam `null`, nunca `0`, quando a venue cala", () => {
    for (const arquivo of [
      "src/lib/cex/execucao/executor.ts",
      "src/lib/cex/execucao/reconciliador.ts",
      "src/lib/autopilot/assentamento-da-saida.ts",
    ]) {
      const fonte = readFileSync(arquivo, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      expect(fonte, arquivo).not.toMatch(/cumulativeQuote:[^,\n]*\?[^,\n]*:\s*0\b/);
    }
  });
});
