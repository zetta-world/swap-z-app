/**
 * ⚠️⚠️⚠️ A137 / A138 / A139 — A RESERVA TEM DONO, O P&L TEM MARCADOR, E A
 * SAÍDA TEM IDENTIDADE HISTÓRICA.
 *
 * Os três achados vieram da auditoria direta da branch, e os três atacam a
 * mesma ilusão: que um número agregado, ou um identificador conveniente, basta
 * para descrever dinheiro.
 *
 *   A137 — a reserva expirava em dez minutos. O que ela esquecia não era um
 *          fantasma: era uma ordem possivelmente VIVA.
 *   A138 — o P&L era gravado numa chamada separada da que reduzia a posição.
 *          Gravando um e falhando o outro, ou o resultado dobrava, ou sumia.
 *   A139 — a liquidação redescobria o intent por `external_order_id`, que não
 *          é identificador global, e consultava a venue com a credencial
 *          ATUAL da sessão — não a que criou a ordem.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  reservarVendaDoBot, reservarExposicaoDoBot, liberarReservaDoIntent,
} from "@/lib/autopilot/reserva-de-inventario";
import {
  projetarEfeitoDoIntent, liquidarSaidaArmada,
} from "@/lib/autopilot/projecao-de-posicao";

const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
const HOJE = "2026-09-20";

let banco: ReturnType<typeof bancoFalso>;
const chamar = (nome: string, args: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(nome, args).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });
const deps = { chamarRpc: chamar };

function sessao(id = "S1", over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id, wallet_address: "0xA137", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: 0, daily_loss_stop_usd: 50,
    frozen_until_day: null, ...over });
}
function posicao(over: Record<string, unknown> = {}) {
  banco.posicoes.push({ id: `pos-${banco.posicoes.length + 1}`, session_id: "S1",
    wallet_address: "0xA137", exchange_id: "binance", base: "BTC", pair: "BTC/USDT",
    entry_price: 60_000, base_amount: 0.01, cost_usd: 600, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null, ...over });
}
function intent(over: Record<string, unknown> = {}): string {
  const id = `i${banco.intents.length + 1}`;
  banco.intents.push({ id, client_order_id: `c${id}`, wallet_address: "0xA137",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    canceled_qty: 0, conexao_id: "C1", external_order_id: null, ...over });
  return id;
}
const daPosicao = () => banco.posicoes.find((p) => p.base === "BTC" && p.session_id === "S1");
const marcador = (id: string) => banco.efeitos.find((e) => e.intent_id === id)!;

beforeEach(() => { banco = bancoFalso(); sessao(); });

describe("A137 — compromisso vivo não é esquecido por relógio", () => {
  it("⚠️⚠️ limitada aceita SEM fill: a segunda venda não passa por cima dela", async () => {
    /**
     * O cenário exato do achado: a primeira ordem existe, não preencheu, e o
     * tempo passou. Com prazo de validade, a segunda venda encontrava a bolsa
     * "livre" — e as duas podiam preencher.
     */
    posicao();
    const primeira = intent({ state: "SUBMITTED" });
    expect((await reservarVendaDoBot(primeira, 0.01, deps)).ok).toBe(true);

    const segunda = intent();
    const r = await reservarVendaDoBot(segunda, 0.01, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("quantidade_ja_reservada");
  });

  it("⚠️⚠️ UNKNOWN também segura — dúvida não é prova de morte", async () => {
    posicao();
    const emDuvida = intent({ state: "UNKNOWN" });
    expect((await reservarVendaDoBot(emDuvida, 0.01, deps)).ok).toBe(true);
    expect((await reservarVendaDoBot(intent(), 0.01, deps)).ok).toBe(false);
  });

  it("⚠️⚠️ e o mesmo vale para a EXPOSIÇÃO de uma compra em voo", async () => {
    banco.posicoes.push({ id: "pe", session_id: "S1", base: "ETH", cost_usd: 150, status: "open" });
    const compraEmVoo = intent({ side: "buy", state: "SUBMITTED", symbol: "ETH/USDT" });
    expect((await reservarExposicaoDoBot(compraEmVoo, 40, 200, deps)).ok).toBe(true);
    const outra = intent({ side: "buy", symbol: "ETH/USDT" });
    expect((await reservarExposicaoDoBot(outra, 20, 200, deps)).ok).toBe(false);
  });

  it("⚠️⚠️ MORTO libera na hora — e só o provadamente morto", async () => {
    posicao();
    const recusada = intent();
    expect((await reservarVendaDoBot(recusada, 0.01, deps)).ok).toBe(true);
    // A corretora respondeu e disse não: nada saiu, nada mais sai.
    banco.intents.find((i) => i.id === recusada)!.state = "CANCELED";
    expect((await reservarVendaDoBot(intent(), 0.01, deps)).ok).toBe(true);
  });

  it("⚠️⚠️ a ordem ANTIGA não consome o compromisso da NOVA", async () => {
    /**
     * O segundo defeito do contador agregado: A expira, B reserva, A preenche
     * tarde — e a projeção de A subtraía do agregado, comendo a reserva de B.
     * Com dono, cada uma mexe só na sua.
     */
    posicao({ base_amount: 0.02, cost_usd: 1_200 });
    const antiga = intent();
    const nova = intent();
    expect((await reservarVendaDoBot(antiga, 0.01, deps)).ok).toBe(true);
    expect((await reservarVendaDoBot(nova, 0.01, deps)).ok).toBe(true);

    // A antiga preenche tarde e é projetada.
    const linha = banco.intents.find((i) => i.id === antiga)!;
    linha.filled_qty = 0.01; linha.filled_quote = 620; linha.state = "FILLED";
    await projetarEfeitoDoIntent(antiga, { chamarRpc: chamar, hoje: HOJE });

    // O compromisso da NOVA continua de pé, intacto.
    expect(Number(marcador(nova).reservado_qty)).toBeCloseTo(0.01, 12);
    expect(Number(marcador(antiga).reservado_qty) - Number(marcador(antiga).applied_qty))
      .toBeLessThanOrEqual(1e-12);
  });

  it("⚠️⚠️ parcial VIVO mantém o remanescente reservado", async () => {
    posicao();
    const parcial = intent({ state: "PARTIALLY_FILLED" });
    expect((await reservarVendaDoBot(parcial, 0.01, deps)).ok).toBe(true);
    const linha = banco.intents.find((i) => i.id === parcial)!;
    linha.filled_qty = 0.004; linha.filled_quote = 250;
    await projetarEfeitoDoIntent(parcial, { chamarRpc: chamar, hoje: HOJE });

    // 0,004 viraram posição reduzida; 0,006 continuam prometidos.
    expect(Number(marcador(parcial).reservado_qty) - Number(marcador(parcial).applied_qty))
      .toBeCloseTo(0.006, 12);
    // E por isso uma segunda venda não cabe.
    expect((await reservarVendaDoBot(intent(), 0.006, deps)).ok).toBe(false);
  });

  it("⚠️ devolver é por INTENT, e não mexe no compromisso alheio", async () => {
    posicao({ base_amount: 0.02 });
    const a = intent(), b = intent();
    await reservarVendaDoBot(a, 0.01, deps);
    await reservarVendaDoBot(b, 0.01, deps);
    await liberarReservaDoIntent(a, deps);
    expect(Number(marcador(a).reservado_qty)).toBe(0);
    expect(Number(marcador(b).reservado_qty)).toBeCloseTo(0.01, 12);
  });
});

describe("A138 — o P&L entra exatamente uma vez", () => {
  async function posicaoComprada() {
    const compra = intent({ side: "buy", filled_qty: 0.01, filled_quote: 600, state: "FILLED" });
    await projetarEfeitoDoIntent(compra, { chamarRpc: chamar, hoje: HOJE });
  }
  const sessaoAtual = () => banco.sessoes.find((x) => x.id === "S1")!;

  it("⚠️⚠️ venda projetada soma o resultado UMA vez, e repetir não soma de novo", async () => {
    await posicaoComprada();
    const venda = intent({ filled_qty: 0.01, filled_quote: 640, state: "FILLED" });
    const primeira = await projetarEfeitoDoIntent(venda, { chamarRpc: chamar, taxaUsd: 1, hoje: HOJE });
    expect(primeira.ok && primeira.realizado).toBeCloseTo(39, 9);   // 640 − 600 − 1
    expect(Number(sessaoAtual().pnl_today)).toBeCloseTo(39, 9);

    const segunda = await projetarEfeitoDoIntent(venda, { chamarRpc: chamar, taxaUsd: 1, hoje: HOJE });
    expect(segunda.ok && segunda.motivo).toBe("sem_delta");
    expect(Number(sessaoAtual().pnl_today)).toBeCloseTo(39, 9);
  });

  it("⚠️⚠️ falha da transação NÃO deixa P&L sem posição, nem posição sem P&L", async () => {
    await posicaoComprada();
    const venda = intent({ filled_qty: 0.01, filled_quote: 640, state: "FILLED" });
    banco.falhas.rpc = "deadlock detected";
    const r = await projetarEfeitoDoIntent(venda, { chamarRpc: chamar, hoje: HOJE });
    expect(r.ok).toBe(false);
    expect(Number(sessaoAtual().pnl_today)).toBe(0);
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.01, 12);

    // E a retentativa aplica os dois, uma vez só.
    delete banco.falhas.rpc;
    const retry = await projetarEfeitoDoIntent(venda, { chamarRpc: chamar, hoje: HOJE });
    expect(retry.ok).toBe(true);
    expect(Number(sessaoAtual().pnl_today)).toBeCloseTo(40, 9);
    expect(daPosicao()).toBeUndefined();
  });

  it("⚠️⚠️ parcial crescente soma só o DELTA do resultado", async () => {
    /**
     * ⚠️ OS NÚMEROS SÃO ABSOLUTOS DE PROPÓSITO. A primeira versão deste teste
     * comparava o `pnl_today` com o `realizado` que a própria chamada devolveu
     * — e um cálculo que ignorasse o marcador inflaria os DOIS, passando
     * incólume. Medir contra o próprio resultado é não medir nada.
     *
     * Posição: 0,01 BTC a US$ 600.
     *   1º parcial: vendeu 0,005 por 320 · custo removido 300 → +20
     *   2º parcial: vendeu mais 0,005 por 320 · custo removido 300 → +20
     *   total: 40 — e NUNCA 360 (que é o que sai somando o recebido inteiro).
     */
    await posicaoComprada();
    const venda = intent({ filled_qty: 0.005, filled_quote: 320, state: "PARTIALLY_FILLED" });
    const primeira = await projetarEfeitoDoIntent(venda, { chamarRpc: chamar, hoje: HOJE });
    expect(primeira.ok && primeira.realizado).toBeCloseTo(20, 9);
    expect(Number(sessaoAtual().pnl_today)).toBeCloseTo(20, 9);

    const linha = banco.intents.find((i) => i.id === venda)!;
    linha.filled_qty = 0.01; linha.filled_quote = 640;
    const segunda = await projetarEfeitoDoIntent(venda, { chamarRpc: chamar, hoje: HOJE });
    expect(segunda.ok && segunda.aplicadoQty).toBeCloseTo(0.005, 12);
    expect(segunda.ok && segunda.realizado, "o delta, nunca o recebido inteiro")
      .toBeCloseTo(20, 9);
    expect(Number(sessaoAtual().pnl_today)).toBeCloseTo(40, 9);
  });

  it("⚠️⚠️ prejuízo que cruza o stop CONGELA — uma vez", async () => {
    await posicaoComprada();
    const venda = intent({ filled_qty: 0.01, filled_quote: 500, state: "FILLED" });
    const r = await projetarEfeitoDoIntent(venda, { chamarRpc: chamar, hoje: HOJE });
    expect(r.ok && r.realizado).toBeCloseTo(-100, 9);
    expect(sessaoAtual().frozen_until_day).toBe(HOJE);
    const pnlDepois = Number(sessaoAtual().pnl_today);

    await projetarEfeitoDoIntent(venda, { chamarRpc: chamar, hoje: HOJE });
    expect(Number(sessaoAtual().pnl_today)).toBeCloseTo(pnlDepois, 9);
  });

  it("⚠️⚠️ a COMPRA não mexe no P&L", async () => {
    const compra = intent({ side: "buy", filled_qty: 0.01, filled_quote: 600, state: "FILLED" });
    await projetarEfeitoDoIntent(compra, { chamarRpc: chamar, hoje: HOJE });
    expect(Number(sessaoAtual().pnl_today)).toBe(0);
  });

  it("⚠️ e o marcador guarda quanto DESTE intent já entrou", () => {
    expect(SQL).toMatch(/pnl_aplicado_usd numeric  not null default 0/);
    expect(SQL).toMatch(/pnl_aplicado_usd = pnl_aplicado_usd \+ v_realizado/);
  });
});

describe("A139 — a saída armada tem identidade histórica", () => {
  function armada(over: Record<string, unknown> = {}) {
    const venda = intent({ external_order_id: "EXT-1", conexao_id: "C1" });
    posicao({ status: "exit_armed", exit_order_id: "EXT-1", exit_intent_id: venda, ...over });
    return venda;
  }

  it("⚠️⚠️ a liquidação aplica quando a identidade bate inteira", async () => {
    const venda = armada();
    const r = await liquidarSaidaArmada(venda, 0.004, 250, 0, HOJE, deps);
    expect(r.ok && r.aplicadoQty).toBeCloseTo(0.004, 12);
  });

  it("⚠️⚠️ intent de OUTRA saída não liquida esta posição", async () => {
    armada();
    const outro = intent({ external_order_id: "EXT-2" });
    const r = await liquidarSaidaArmada(outro, 0.004, 250, 0, HOJE, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("intent_nao_e_a_saida_armada");
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️ número de ordem divergente do intent RECUSA", async () => {
    /**
     * `external_order_id` não é identificador global da corretora: duas contas
     * podem trazer o mesmo número. Se ele não bater com o do intent, a
     * atribuição seria entre contas — e é isso que falha fechado aqui.
     */
    const venda = intent({ external_order_id: "EXT-DE-OUTRA-CONTA" });
    posicao({ status: "exit_armed", exit_order_id: "EXT-1", exit_intent_id: venda });
    const r = await liquidarSaidaArmada(venda, 0.004, 250, 0, HOJE, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("ordem_externa_divergente");
  });

  it("⚠️⚠️ LEGADO sem `exit_intent_id` não é adivinhado — mão humana", async () => {
    const venda = intent({ external_order_id: "EXT-1" });
    posicao({ status: "exit_armed", exit_order_id: "EXT-1", exit_intent_id: null });
    const r = await liquidarSaidaArmada(venda, 0.004, 250, 0, HOJE, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("saida_sem_identidade");
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️ e a credencial da liquidação é a do INTENT, não a da sessão atual", () => {
    /**
     * O cenário do A127 aplicado à saída: S1 armou em C1 e foi rearmada para
     * C2. Perguntar a C2 por uma ordem que nasceu em C1 é perguntar na conta
     * errada. O cron carrega a credencial por `intent.conexao_id`.
     */
    /**
     * ⚠️ ESTA TRAVA JÁ PASSOU SEM O CONSERTO, e eu a reescrevi por isso: o
     * primeiro regex casava com o import que o RECONCILIADOR usa, não com a
     * liquidação. Medir "a palavra aparece no arquivo" não é medir o caminho.
     */
    const CRON = readFileSync("src/app/api/autopilot/cron/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(CRON).toMatch(/const credenciaisDaSaida = await credenciaisDaSaidaArmada\(pos\);/);
    expect(CRON).toMatch(/fetchCexOrderStatus\(\s*exchange, credenciaisDaSaida,/);
    expect(CRON).toMatch(/async function credenciaisDaSaidaArmada/);
    expect(CRON).toMatch(/\.eq\("id", pos\.exit_intent_id\)/);
    expect(CRON).toMatch(/return credenciaisDoIntentParaRecovery\(db, data\);/);
    expect(CRON).toMatch(/if \(!db \|\| !pos\.exit_intent_id\) return null;/);
    expect(CRON).toMatch(/autopilot_saida_sem_credencial_historica/);
    expect(CRON).not.toMatch(/\.eq\("external_order_id", ordemExterna\)/);
  });

  it("⚠️ a RPC confere sessão, corretora e lado — tudo ou nada", () => {
    expect(SQL).toMatch(/if v_pos\.exit_intent_id is null then/);
    expect(SQL).toMatch(/if v_pos\.exit_intent_id <> p_intent_id then/);
    expect(SQL).toMatch(/if v_i\.exchange_id <> v_pos\.exchange_id then/);
    expect(SQL).toMatch(/if v_i\.side <> 'sell' then/);
    // A posição é achada por (sessão, base) — nunca por número de ordem.
    expect(SQL).not.toMatch(/where external_order_id = /);
  });
});
