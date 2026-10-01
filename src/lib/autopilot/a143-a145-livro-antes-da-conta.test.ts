/**
 * ⚠️⚠️⚠️ A143 / A144 / A145 — TRÊS MANEIRAS DE A CONTA DO DIA SAIR ERRADA.
 *
 *   A143 — a liquidação da saída armada acontecia ANTES de os fatos da
 *          corretora entrarem no livro de execuções. A RPC deriva a taxa do
 *          livro (A140), o livro estava vazio, e a taxa virava ZERO: o
 *          prejuízo chegava menor ao `pnl_today` e o stop de perda diária não
 *          disparava. Na MESMA passada o cron comprava.
 *   A144 — `autopilot_compromisso_vivo` mandava `CANCELED` para zero. Uma
 *          limitada cancelada DEPOIS de preencher parcialmente liberava a
 *          bolsa inteira, e a ordem seguinte vendia o que já saiu.
 *   A145 — o recebido de uma COMPRA que chegou atrasado avançava o marcador e
 *          NÃO entrava em `autopilot_positions.cost_usd`. Base de custo
 *          perdida para sempre: exposição subavaliada e lucro inventado.
 *
 * ⚠️ Os três medem NÚMERO, não texto de recusa: quanto entrou no livro, quanto
 * o `pnl_today` andou, quanto a próxima ordem consegue reservar.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  assentarFatosDaSaida, assentarELiquidarSaida,
} from "@/lib/autopilot/assentamento-da-saida";
import {
  projetarEfeitoDoIntent, liquidarSaidaArmada,
} from "@/lib/autopilot/projecao-de-posicao";
import {
  reservarVendaDoBot, reservarExposicaoDoBot,
} from "@/lib/autopilot/reserva-de-inventario";
import {
  avaliarAutorizacaoDaSessaoParaExecucao,
} from "@/lib/autopilot/autorizacao-de-execucao";

const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
const CRON = readFileSync("src/app/api/autopilot/cron/route.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** A chave do dia que o banco falso usa — a mesma de `autopilot_sessions`. */
const hojeUtc = () => new Date().toISOString().slice(0, 10);

let banco: ReturnType<typeof bancoFalso>;
const chamar = (nome: string, args: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(nome, args).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });
/** As dependências de PRODUÇÃO apontadas para o banco falso. */
const deps = () => ({ db: banco.cliente, chamarRpc: chamar });

function sessao(over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id: "S1", wallet_address: "0xA143", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: 0, daily_loss_stop_usd: 50,
    frozen_until_day: null, ...over });
}
function posicao(over: Record<string, unknown> = {}) {
  banco.posicoes.push({ id: `pos-${banco.posicoes.length + 1}`, session_id: "S1",
    wallet_address: "0xA143", exchange_id: "binance", base: "BTC", pair: "BTC/USDT",
    entry_price: 10_000, base_amount: 0.01, cost_usd: 100, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null, ...over });
}
function intent(id: string, over: Record<string, unknown> = {}): string {
  banco.intents.push({ id, client_order_id: `c-${id}`, wallet_address: "0xA143",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    fee_total: null, fee_currency: null, canceled_qty: 0, conexao_id: "C1",
    external_order_id: null, ...over });
  return id;
}
const aSessao = () => banco.sessoes.find((s) => s.id === "S1")!;
const aPosicao = (base = "BTC") =>
  banco.posicoes.find((p) => p.session_id === "S1" && p.base === base);
const oEfeito = (id: string) => banco.efeitos.find((e) => e.intent_id === id);
const oIntent = (id: string) => banco.intents.find((i) => i.id === id)!;

beforeEach(() => { banco = bancoFalso(); });

// ═══════════════════════════════════════════════════════════════════════════
// A143 — ASSENTAR ANTES DE LIQUIDAR
// ═══════════════════════════════════════════════════════════════════════════
describe("A143 — o fato da corretora entra no LIVRO antes de virar conta", () => {
  /** A saída armada do briefing: 0,01 BTC comprados por US$ 100. */
  function saidaArmada(over: Record<string, unknown> = {}) {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { state: "SUBMITTED", external_order_id: "ORD-1", ...over });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });
  }
  /** A resposta da venue: vendeu tudo por US$ 100, pagando US$ 2 de taxa. */
  const ordemCheia = {
    filled: 0.01, cost: 100, average: 10_000,
    fee: { cost: 2, currency: "USDT" }, timestamp: 1_700_000_000_000,
  };

  it("⚠️⚠️⚠️ O TESTE DO ACHADO: −49 + (−2) = −51, congela, e ZERO compra", async () => {
    saidaArmada();
    const r = await assentarELiquidarSaida("i1", "ORD-1", ordemCheia, 0.01, deps());

    expect(r.ok, r.ok ? "" : `${r.etapa}/${r.motivo}: ${r.porque}`).toBe(true);
    if (!r.ok) return;
    expect(r.resultado.motivo).toBe("aplicado");

    /**
     * ⚠️ A TAXA ENTROU NA CONTA. 100 recebidos − 100 de custo − 2 de taxa.
     * Sem o assentamento este número era ZERO: a RPC lia `fee_total = null`
     * do intent que ninguém atualizou, e o prejuízo simplesmente não existia.
     */
    expect(r.resultado.realizado).toBeCloseTo(-2, 10);
    expect(r.resultado.taxaNaoPrecificada).toBe(false);

    // ⚠️ O livro de execuções tem os fatos — é ele que a RPC lê.
    expect(Number(oIntent("i1").filled_qty)).toBeCloseTo(0.01, 12);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(100, 10);
    expect(Number(oIntent("i1").fee_total)).toBeCloseTo(2, 10);
    expect(oIntent("i1").fee_currency).toBe("USDT");

    // ⚠️ O STOP DE PERDA: o número durável, não o espelho da passada.
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);
    expect(aSessao().frozen_until_day).toBe(hojeUtc());

    /**
     * ⚠️⚠️ E ZERO COMPRA — pelo MESMO portão que o cron e o navegador usam.
     * A sessão congelada não autoriza execução nova nenhuma.
     */
    const portao = avaliarAutorizacaoDaSessaoParaExecucao({
      ativa: true,
      expiraEm: new Date(Date.now() + 3_600_000).toISOString(),
      congeladaAte: aSessao().frozen_until_day as string | null,
      tradesHoje: 0, maxTradesPorDia: 5, maxTradeUsd: 1_000,
      conexaoId: "C1", emQuarentena: false, contabilidadeIncompleta: false,
    });
    expect(portao.ok).toBe(false);
    if (!portao.ok) expect(portao.motivo).toBe("sessao_congelada");
  });

  it("⚠️⚠️ os números vão para a RPC vindos do LIVRO, não da resposta HTTP", async () => {
    /**
     * O caso que separa as duas fontes: o `fetchOrder` volta SEM `cost` (a
     * venue responde a quantidade e o dinheiro só aparece nos trades), e o
     * livro JÁ tem o recebido, ingerido pela reconciliação.
     *
     * Passando a resposta HTTP, `Number(undefined)` virava 0 e a conta era
     * `0 − 100 − 2 = −102`. Pelo livro, é `100 − 100 − 2 = −2`.
     */
    saidaArmada();
    banco.fills.push({ id: "f1", intent_id: "i1", exchange_id: "binance",
      external_order_id: "ORD-1", external_trade_id: "T1", symbol: "BTC/USDT",
      side: "sell", qty: 0.01, price: 10_000, quote_amount: 100,
      fee: 2, fee_currency: "USDT", sintetico: false, dedupe_key: "t:T1" });
    Object.assign(oIntent("i1"), { filled_qty: 0.01, filled_quote: 100,
      fee_total: 2, fee_currency: "USDT", state: "FILLED" });

    const vistos: Array<[string, number, number]> = [];
    const espiao = vi.fn(async (id: string, q: number, quote: number) => {
      vistos.push([id, q, quote]);
      return liquidarSaidaArmada(id, q, quote, { chamarRpc: chamar });
    });
    const semCusto = { filled: 0.01, average: 10_000,
                       fee: { cost: 2, currency: "USDT" } };
    const r = await assentarELiquidarSaida(
      "i1", "ORD-1", semCusto, 0.01, { ...deps(), liquidar: espiao });

    expect(r.ok, r.ok ? "" : r.porque).toBe(true);
    expect(vistos).toEqual([["i1", 0.01, 100]]);
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);
  });

  it("⚠️⚠️ ingestão RECUSADA: nada de P&L, saída segue armada, marcador parado", async () => {
    /**
     * Moeda de fee incompatível (o livro tem BNB, a venue traz USDT). A 0059
     * recusa sem converter — e `supabase-js` RESOLVE com `{ error }`, não
     * lança: liquidar em cima disso seria o defeito com uma linha a mais.
     */
    saidaArmada();
    banco.fills.push({ id: "f1", intent_id: "i1", exchange_id: "binance",
      external_order_id: "ORD-1", external_trade_id: "T1", symbol: "BTC/USDT",
      side: "sell", qty: 0.004, price: 10_000, quote_amount: 40,
      fee: 0.01, fee_currency: "BNB", sintetico: false, dedupe_key: "t:T1" });

    const r = await assentarELiquidarSaida("i1", "ORD-1", ordemCheia, 0.01, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.etapa).toBe("assentamento");
    expect(r.motivo).toBe("ingestao_recusada");

    // ⚠️ NADA de P&L pela metade — o freio não foi mexido.
    expect(Number(aSessao().pnl_today)).toBe(-49);
    expect(aSessao().frozen_until_day).toBe(null);
    // ⚠️ A saída fica RETENTÁVEL: segue armada, apontando para a mesma ordem.
    expect(aPosicao()!.status).toBe("exit_armed");
    expect(aPosicao()!.exit_order_id).toBe("ORD-1");
    expect(Number(aPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
    // ⚠️ E o marcador não avançou: a passada seguinte aplica o delta inteiro.
    expect(oEfeito("i1")).toBeUndefined();
  });

  it("⚠️⚠️ a venue reportando MENOS que o livro é divergência, não ruído", async () => {
    saidaArmada();
    banco.fills.push({ id: "f1", intent_id: "i1", exchange_id: "binance",
      external_order_id: "ORD-1", external_trade_id: "T1", symbol: "BTC/USDT",
      side: "sell", qty: 0.01, price: 10_000, quote_amount: 100,
      fee: 2, fee_currency: "USDT", sintetico: false, dedupe_key: "t:T1" });
    Object.assign(oIntent("i1"), { filled_qty: 0.01, filled_quote: 100,
      fee_total: 2, fee_currency: "USDT" });

    const r = await assentarELiquidarSaida(
      "i1", "ORD-1", { ...ordemCheia, filled: 0.004, cost: 40 }, 0.004, deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("regressao_na_venue");
    expect(Number(aSessao().pnl_today)).toBe(-49);
    expect(aPosicao()!.status).toBe("exit_armed");
  });

  it("⚠️ ingestão 'ok' com o livro parado em zero também fecha", async () => {
    /**
     * Defesa em profundidade: se a ingestão devolvesse sucesso sem que o fato
     * entrasse, liquidar seria liquidar sobre o vazio de novo. A releitura da
     * linha durável é o que prova que entrou.
     */
    saidaArmada();
    const r = await assentarFatosDaSaida("i1", "ORD-1", ordemCheia, 0.01, {
      ...deps(),
      ingerir: async () => ({ ok: true, inseridos: 0, regrediu: false }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("livro_sem_execucao");
  });

  it("⚠️⚠️ o CRON não liquida mais direto — e a pendência fecha a entrada", () => {
    // A porta única: a sequência inteira mora no módulo de assentamento.
    expect(CRON).toMatch(/assentarELiquidarSaida\(/);
    expect(CRON).not.toMatch(/liquidarSaidaArmada\(/);
    // Falhar no ASSENTAMENTO é o que fecha a sessão para entradas novas —
    // falhar na liquidação não, porque o fato já está no livro e a varredura
    // de pendências volta nele.
    expect(CRON).toMatch(/fatosPendentes: desfecho\.etapa === "assentamento"/);
    expect(CRON).toMatch(
      /if \(!leituraDoLivro\.ok \|\| !livroLegivelNoSettle \|\| fatosNaoAssentados\)/);
    // ⚠️ E a taxa NÃO volta a ser autoridade do TypeScript (A140).
    expect(CRON).not.toMatch(/taxaEmUsd\(/);
    /**
     * ⚠️ NADA LIQUIDADO NÃO É "SETTLED" — os DOIS ramos (fechada e cancelada
     * com parcial) saem pela linha honesta antes de escrever a nota. Dizer
     * "settled" com o fill fora do livro é o extrato contradizendo o evento
     * de severidade alta que acabou de ser emitido.
     */
    expect([...CRON.matchAll(/if \(liq(Cancel)?\.qty <= 0\) \{/g)]).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A144 — TERMINAL COM FILL AINDA COMPROMETE
// ═══════════════════════════════════════════════════════════════════════════
describe("A144 — `CANCELED` não desfaz preenchimento parcial", () => {
  it("⚠️⚠️⚠️ VENDA: A cancelou com 0,004 vendidos — B só pode vender 0,006", async () => {
    sessao();
    posicao({ base_amount: 0.01, cost_usd: 100 });
    intent("A", { side: "sell" });
    intent("B", { side: "sell" });

    const reservaA = await reservarVendaDoBot("A", 0.01, { chamarRpc: chamar });
    expect(reservaA.ok && reservaA.qtd).toBe(0.01);

    // A ordem viveu, preencheu 0,004 e foi cancelada. O fill é FATO IMUTÁVEL,
    // e a projeção dele ainda não aconteceu (`applied_qty` segue 0).
    Object.assign(oIntent("A"), { state: "CANCELED", filled_qty: 0.004,
      filled_quote: 40, canceled_qty: 0.006 });
    expect(Number(oEfeito("A")!.applied_qty ?? 0)).toBe(0);

    const reservaB = await reservarVendaDoBot("B", 0.01, { chamarRpc: chamar });
    expect(reservaB.ok).toBe(true);
    if (!reservaB.ok) return;
    // 0,01 na posição − 0,004 que já saiu = 0,006. Antes do A144 vinha 0,01,
    // e 0,004 + 0,01 = 0,014 sairiam de uma bolsa de 0,01.
    expect(reservaB.qtd).toBeCloseTo(0.006, 12);
    expect(reservaB.limitada).toBe(true);
  });

  it("⚠️ cancelada SEM preenchimento devolve a bolsa inteira", async () => {
    sessao();
    posicao({ base_amount: 0.01, cost_usd: 100 });
    intent("A", { side: "sell" });
    intent("B", { side: "sell" });
    await reservarVendaDoBot("A", 0.01, { chamarRpc: chamar });
    Object.assign(oIntent("A"), { state: "CANCELED", filled_qty: 0, canceled_qty: 0.01 });

    const b = await reservarVendaDoBot("B", 0.01, { chamarRpc: chamar });
    expect(b.ok && b.qtd).toBeCloseTo(0.01, 12);
    expect(b.ok && b.limitada).toBe(false);
  });

  it("⚠️ `FAILED_PRE_SUBMIT` é o único zero incondicional", async () => {
    sessao();
    posicao({ base_amount: 0.01, cost_usd: 100 });
    intent("A", { side: "sell" });
    intent("B", { side: "sell" });
    await reservarVendaDoBot("A", 0.01, { chamarRpc: chamar });
    // Um fill contra pré-envio é contradição; o que importa é que o estado
    // prova que a requisição NÃO chegou à corretora.
    Object.assign(oIntent("A"), { state: "FAILED_PRE_SUBMIT", filled_qty: 0 });

    const b = await reservarVendaDoBot("B", 0.01, { chamarRpc: chamar });
    expect(b.ok && b.qtd).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️ ainda preenchível: manda o RESERVADO, não o executado", async () => {
    sessao();
    posicao({ base_amount: 0.01, cost_usd: 100 });
    intent("A", { side: "sell" });
    intent("B", { side: "sell" });
    await reservarVendaDoBot("A", 0.01, { chamarRpc: chamar });
    // A ordem está VIVA com 0,004 preenchidos — os outros 0,006 podem sair a
    // qualquer momento. Medir pelo executado aqui liberaria o que ainda pode
    // ser vendido pela própria ordem A.
    Object.assign(oIntent("A"), { state: "PARTIALLY_FILLED", filled_qty: 0.004,
      filled_quote: 40 });

    const b = await reservarVendaDoBot("B", 0.01, { chamarRpc: chamar });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.motivo).toBe("quantidade_ja_reservada");
  });

  it("⚠️ `FILLED` já projetado não compromete nada", async () => {
    sessao();
    // A bolsa da linha é o que RESTA depois de A ter sido projetada.
    posicao({ base_amount: 0.01, cost_usd: 100 });
    intent("A", { side: "sell" });
    intent("B", { side: "sell" });
    await reservarVendaDoBot("A", 0.004, { chamarRpc: chamar });
    Object.assign(oIntent("A"), { state: "FILLED", filled_qty: 0.004, filled_quote: 40 });
    oEfeito("A")!.applied_qty = 0.004;

    const b = await reservarVendaDoBot("B", 0.01, { chamarRpc: chamar });
    expect(b.ok && b.qtd).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️⚠️ COMPRA: cancelada com 30 preenchidos ainda ocupa o teto", async () => {
    sessao();
    posicao({ base_amount: 0.01, cost_usd: 150 });   // exposição = 150
    intent("A", { side: "buy", order_type: "limit" });
    intent("B", { side: "buy", order_type: "limit" });

    const a = await reservarExposicaoDoBot("A", 40, 200, { chamarRpc: chamar });
    expect(a.ok).toBe(true);

    Object.assign(oIntent("A"), { state: "CANCELED", filled_qty: 0.002,
      filled_quote: 30 });
    expect(Number(oEfeito("A")!.applied_quote ?? 0)).toBe(0);

    // 150 de exposição + 30 comprometidos (o capital que JÁ saiu) + 30 novos
    // = 210 > 200. Antes do A144 o comprometido vinha 0 e a entrada passava.
    const b = await reservarExposicaoDoBot("B", 30, 200, { chamarRpc: chamar });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.motivo).toBe("teto_estourado");

    const cru = await chamar("autopilot_reservar_exposicao_do_intent",
      { p_intent_id: "B", p_usd: 30, p_teto: 200 }) as Record<string, unknown>;
    expect(Number(cru.comprometido)).toBeCloseTo(30, 10);
  });

  it("⚠️⚠️ depois de `applied_quote = 30` o compromisso vira ZERO", async () => {
    sessao();
    posicao({ base_amount: 0.01, cost_usd: 150 });
    intent("A", { side: "buy", order_type: "limit" });
    intent("B", { side: "buy", order_type: "limit" });
    await reservarExposicaoDoBot("A", 40, 200, { chamarRpc: chamar });
    Object.assign(oIntent("A"), { state: "CANCELED", filled_qty: 0.002,
      filled_quote: 30 });
    // A projeção aplicou: os 30 saíram do compromisso e entraram no CUSTO.
    oEfeito("A")!.applied_quote = 30;
    aPosicao()!.cost_usd = 180;

    const cru = await chamar("autopilot_reservar_exposicao_do_intent",
      { p_intent_id: "B", p_usd: 30, p_teto: 200 }) as Record<string, unknown>;
    expect(Number(cru.comprometido)).toBe(0);
    // ⚠️ E o dinheiro não sumiu: ele deixou de ser compromisso e virou
    // exposição. 180 + 0 + 30 = 210 continua passando do teto.
    expect(Number(cru.exposicao)).toBeCloseTo(180, 10);
    expect(cru.ok).toBe(false);

    const cabe = await reservarExposicaoDoBot("B", 20, 200, { chamarRpc: chamar });
    expect(cabe.ok).toBe(true);
    if (cabe.ok) expect(cabe.comprometidoUsd).toBeCloseTo(20, 10);
  });

  it("⚠️ o SQL carrega a regra das três faixas, com a unidade certa", () => {
    expect(SQL).toMatch(/when p_estado = 'FAILED_PRE_SUBMIT' then 0/);
    expect(SQL).toMatch(/when p_estado in \('FILLED', 'CANCELED'\)/);
    // ⚠️ venda mede BASE, compra mede QUOTE — misturar é comparar BTC com dólar.
    expect(SQL).toMatch(/e\.reservado_qty, e\.applied_qty, i\.state::text, i\.filled_qty/);
    expect(SQL).toMatch(/e\.reservado_usd, e\.applied_quote, i\.state::text, i\.filled_quote/);
    // A assinatura antiga não pode sobreviver como overload.
    expect(SQL).toMatch(
      /drop function if exists public\.autopilot_compromisso_vivo\(numeric, numeric, text\);/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A145 — O CUSTO DA COMPRA QUE CHEGOU ATRASADO
// ═══════════════════════════════════════════════════════════════════════════
describe("A145 — o recebido tardio da compra vira base de custo", () => {
  /**
   * O estado inicial é construído pelo caminho de PRODUÇÃO: uma compra cujo
   * ACK trouxe a quantidade e não o dinheiro. A posição nasce com `cost_usd`
   * zero, que é exatamente o buraco.
   */
  async function compraSemCusto() {
    sessao();
    intent("c1", { side: "buy", order_type: "market", requested_qty: 0.01,
      state: "FILLED", filled_qty: 0.01, filled_quote: 0,
      external_order_id: "ORD-C1" });
    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok && r.motivo).toBe("aplicado");
    expect(Number(aPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
    expect(Number(aPosicao()!.cost_usd)).toBe(0);
  }

  it("⚠️⚠️⚠️ 0 → 600: o custo entra, a quantidade NÃO muda", async () => {
    await compraSemCusto();
    oIntent("c1").filled_quote = 600;

    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.motivo).toBe("ajuste_sem_quantidade");
    expect(r.aplicadoQty).toBe(0);
    expect(r.aplicadoQuote).toBeCloseTo(600, 10);

    expect(Number(aPosicao()!.cost_usd)).toBeCloseTo(600, 10);
    // ⚠️ `delta_qty` é zero por definição deste ramo: somar base seria
    // inventar moeda.
    expect(Number(aPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
    expect(Number(aPosicao()!.entry_price)).toBeCloseTo(60_000, 6);
    expect(Number(oEfeito("c1")!.applied_quote)).toBeCloseTo(600, 10);
  });

  it("⚠️⚠️ replay não soma de novo", async () => {
    await compraSemCusto();
    oIntent("c1").filled_quote = 600;
    await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });

    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok && r.motivo).toBe("sem_delta");
    expect(Number(aPosicao()!.cost_usd)).toBeCloseTo(600, 10);
  });

  it("⚠️⚠️ 600 → 620 aplica só os 20 que faltavam", async () => {
    await compraSemCusto();
    oIntent("c1").filled_quote = 600;
    await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });

    oIntent("c1").filled_quote = 620;
    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok && r.motivo).toBe("ajuste_sem_quantidade");
    expect(r.ok && r.aplicadoQuote).toBeCloseTo(20, 10);
    expect(Number(aPosicao()!.cost_usd)).toBeCloseTo(620, 10);
    expect(Number(aPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️⚠️ sem posição onde o custo entre, o marcador NÃO avança", async () => {
    sessao();
    intent("c1", { side: "buy", order_type: "market", state: "FILLED",
      filled_qty: 0.01, filled_quote: 0 });
    await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    // A linha some (fechamento manual, correção, o que for) e o recebido chega.
    banco.posicoes.length = 0;
    oIntent("c1").filled_quote = 600;

    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("sem_posicao_para_custo");
    /**
     * ⚠️ O PONTO DO ACHADO: marcar como aplicado aqui faria a varredura de
     * pendências responder `sem_delta` para sempre — base de custo perdida
     * com um carimbo de "já tratado" por cima.
     */
    expect(Number(oEfeito("c1")!.applied_quote ?? 0)).toBe(0);
  });

  it("⚠️⚠️ falha de banco no meio também deixa o marcador parado", async () => {
    await compraSemCusto();
    oIntent("c1").filled_quote = 600;
    banco.falhas.rpc = "could not serialize access due to concurrent update";

    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok).toBe(false);
    expect(Number(oEfeito("c1")!.applied_quote ?? 0)).toBe(0);
    expect(Number(aPosicao()!.cost_usd)).toBe(0);
  });

  it("⚠️⚠️ a EXPOSIÇÃO passa a contar os 600", async () => {
    await compraSemCusto();
    oIntent("c1").filled_quote = 600;
    await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });

    intent("c2", { side: "buy", order_type: "limit" });
    const cru = await chamar("autopilot_reservar_exposicao_do_intent",
      { p_intent_id: "c2", p_usd: 100, p_teto: 650 }) as Record<string, unknown>;
    // Com `cost_usd` zerado a exposição vinha 0 e os 100 passavam folgados:
    // o teto contava um capital que já tinha saído.
    expect(Number(cru.exposicao)).toBeCloseTo(600, 10);
    expect(cru.ok).toBe(false);
    expect(cru.motivo).toBe("teto_estourado");
  });

  it("⚠️ o SQL faz a mesma coisa que o falso — e SEM tocar em `base_amount`", () => {
    /**
     * ⚠️ O banco falso é ESPELHO, não autoridade. Um espelho que conserta o
     * que o SQL não conserta é um teste provando a coisa errada — por isso o
     * ramo é lido aqui, na migration.
     */
    const i = SQL.indexOf("elsif v_i.side = 'buy' and v_delta_quote > v_eps then");
    expect(i).toBeGreaterThan(-1);
    const ramo = SQL.slice(i, i + 900);
    expect(ramo).toMatch(/where session_id = v_i\.session_id and base = v_base for update/);
    expect(ramo).toMatch(/'motivo', 'sem_posicao_para_custo'/);
    expect(ramo).toMatch(/set cost_usd    = cost_usd \+ v_delta_quote/);
    // ⚠️ Quantidade NÃO se toca: `delta_qty` é zero por definição do ramo.
    expect(ramo).not.toMatch(/base_amount\s*=/);
  });

  it("⚠️⚠️⚠️ a VENDA seguinte calcula contra 600, não contra zero", async () => {
    await compraSemCusto();
    oIntent("c1").filled_quote = 600;
    await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });

    // Vende a bolsa inteira por 700, sem taxa: resultado 700 − 600 = 100.
    intent("v1", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 700, external_order_id: "ORD-V1" });
    const r = await projetarEfeitoDoIntent("v1", { chamarRpc: chamar });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.custoRemovido).toBeCloseTo(600, 10);
    // ⚠️ Com a base de custo perdida, isto dava 700 de "lucro" inventado.
    expect(r.realizado).toBeCloseTo(100, 10);
    expect(Number(aSessao().pnl_today)).toBeCloseTo(100, 10);
    expect(r.fechou).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORIA OBRIGATÓRIA — SINTÉTICO → REAL
// ═══════════════════════════════════════════════════════════════════════════
describe("sintético → real: o recebido que REGRIDE não pode virar lucro", () => {
  it("⚠️⚠️⚠️ CR-2: na VENDA o recebido que cai é CORRIGIDO, não esquecido", async () => {
    /**
     * ⚠️⚠️ ESTE TESTE AFIRMAVA FAIL-CLOSED, e o retest independente mostrou o
     * preço: a projeção recusava, e `pnl_today`, freeze, bandeira e lista de
     * pendências ficavam exatamente como estavam. A divergência era detectada
     * uma vez e esquecida — com o lucro otimista preservado.
     *
     * Na VENDA a correção é ARITMÉTICA: o custo removido não muda quando o
     * recebido cai; só a receita muda. A conta acumulada do A142 produz o
     * delta negativo sozinha.
     */
    sessao({ pnl_today: -30, daily_loss_stop_usd: 50 });
    posicao({ base_amount: 0.01, cost_usd: 100 });
    intent("v1", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: 2, fee_currency: "USDT",
      external_order_id: "ORD-V1" });
    const primeira = await projetarEfeitoDoIntent("v1", { chamarRpc: chamar });
    expect(primeira.ok && primeira.realizado).toBeCloseTo(-2, 10);
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-32, 10);

    // Os trades reais dizem 80, não 100.
    oIntent("v1").filled_quote = 80;
    const segunda = await projetarEfeitoDoIntent("v1", { chamarRpc: chamar });
    expect(segunda.ok, segunda.ok ? "" : segunda.porque).toBe(true);
    if (!segunda.ok) return;
    // 80 − 100 − 2 = −22, e −2 já estava aplicado ⇒ delta −20.
    expect(segunda.realizado).toBeCloseTo(-20, 10);
    // ⚠️ O resultado econômico verdadeiro, e o stop CRUZA.
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-52, 10);
    expect(aSessao().frozen_until_day).toBe(hojeUtc());
  });

  it("⚠️⚠️ CR-2: na COMPRA a queda fecha a porta E FICA REGISTRADA", async () => {
    /**
     * Na compra o recebido virou `cost_usd`; devolvê-lo exigiria saber quanto
     * daquele custo ainda está na linha depois de vendas parciais, e a linha
     * pode já ter sido apagada. Fail-closed — mas com a divergência GRAVADA,
     * que é o que faltava.
     */
    sessao({ pnl_today: 0 });
    intent("c1", { side: "buy", order_type: "market", state: "FILLED",
      filled_qty: 0.01, filled_quote: 600, fee_total: 1, fee_currency: "USDT" });
    await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(Number(aPosicao()!.cost_usd)).toBeCloseTo(600, 10);

    oIntent("c1").filled_quote = 580;
    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("regressao_de_quote");
    // ⚠️⚠️ O PONTO DO CR-2: a divergência NÃO cai no chão.
    expect(oEfeito("c1")!.divergencia).toBe("regressao_de_quote");
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();
  });

  it("⚠️ o SQL sustenta os dois desfechos da regressão de quote", () => {
    // venda: corrige (a guarda só dispara na compra)
    expect(SQL).toMatch(
      /if v_i\.filled_quote < v_e\.ledger_quote - v_eps and v_i\.side = 'buy' then/);
    // e a recusa GRAVA a divergência
    expect(SQL).toMatch(/set divergencia = 'regressao_de_quote'/);
    expect(SQL).toMatch(/set divergencia = 'regressao_de_quantidade'/);
    expect(SQL).toMatch(/set divergencia = 'regressao_de_taxa'/);
});
});
