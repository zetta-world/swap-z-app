/**
 * ⚠️⚠️ A125 — O PIPELINE END-TO-END: `lerOrdemNaVenue` REAL contra uma
 * exchange mockada, dentro do `reconciliarIntent` REAL (§15).
 *
 * O defeito: `buscarTrades(orderId)` chamava `fetchMyTrades(symbol, ...)` —
 * que devolve o SÍMBOLO INTEIRO da conta — e descartava tudo que não fosse
 * da ordem alvo ANTES de devolver. O reconciliador recebia o mesmo array
 * filtrado para o settlement E para a deriva: um trade manual externo do
 * mesmo símbolo nunca chegava ao `detectarDeriva`. O A124 tinha o escopo
 * certo e recebia a entrada incompleta.
 *
 * O que estes testes provam, com a leitura de verdade (só `instanciarExchange`
 * é mockado — o ccxt não sai do laboratório):
 *
 *   · o settlement ingere SÓ `tradesDaOrdem` (§9: trade externo NUNCA vira
 *     fill deste intent);
 *   · a deriva recebe o histórico ACCOUNT-WIDE — o trade manual é visto;
 *   · `fetchMyTrades` executa NO MÁXIMO 1× por leitura (slot lazy §37);
 *   · falha na leitura account-wide NUNCA vira `[]` nem "sem drift" (§39/§40);
 *   · página cheia (200) sem órfãos é INDETERMINADO, nunca "sem drift" (§13B);
 *   · `createOrder` não é chamado NUNCA — reconciliar é LER (A125.6).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { bancoFalso, type BancoFalso } from "@/lib/cex/execucao/banco-falso";
import { reconciliarIntent } from "@/lib/cex/execucao/reconciliador";
import { lerOrdemNaVenue } from "@/lib/cex/execucao/venue-leitura";
import type { IntentRow } from "@/lib/cex/execucao/intents";
import type { CexCredentials } from "@/lib/cex/types";

/** Os erros do ccxt chegam pelo NOME do construtor — como na vida real. */
class OrderNotFound extends Error {}
class NotSupported extends Error {}

interface ExchangeFalso {
  fetchOrder: ReturnType<typeof vi.fn>;
  fetchMyTrades: ReturnType<typeof vi.fn>;
  fetchClosedOrders: ReturnType<typeof vi.fn>;
  createOrder: ReturnType<typeof vi.fn>;
}

/** O slot que o mock de `instanciarExchange` devolve — trocado a cada teste. */
const hoisted = vi.hoisted(() => ({ exchange: null as ExchangeFalso | null }));

vi.mock("@/lib/cex/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cex/server")>();
  return {
    ...real,
    instanciarExchange: vi.fn(async () => {
      if (!hoisted.exchange) throw new Error("exchange falsa não montada");
      return hoisted.exchange;
    }),
  };
});

const CREDS: CexCredentials = { apiKey: "k", apiSecret: "s" };
const VELHO = new Date(Date.now() - 10 * 60_000).toISOString();

/** Ordem no formato cru do ccxt, como `fetchOrder` devolve. */
function ordemRaw(id: string, filled: number, status = "closed") {
  return { id, symbol: "BTC/USDT", side: "buy", type: "market", status,
           amount: 10, filled, remaining: Math.max(0, 10 - filled),
           average: 100, cost: filled * 100, timestamp: Date.now() };
}

/** Trade no formato cru do ccxt, como `fetchMyTrades` devolve. */
function tradeRaw(id: string, order: string | null, qty = 1) {
  return { id, order, symbol: "BTC/USDT", side: "buy", type: "market",
           amount: qty, price: 100, cost: qty * 100,
           fee: { cost: 0.01, currency: "USDT" }, timestamp: Date.now() };
}

function montarExchange(opts: {
  ordem?: ReturnType<typeof ordemRaw>;
  erroOrdem?: Error;
  trades?: unknown[];
  erroTrades?: Error;
  fechadas?: unknown[];
}): ExchangeFalso {
  const ex: ExchangeFalso = {
    fetchOrder: opts.erroOrdem
      ? vi.fn(async () => { throw opts.erroOrdem; })
      : vi.fn(async () => opts.ordem ?? ordemRaw("ORD-Z", 10)),
    fetchMyTrades: opts.erroTrades
      ? vi.fn(async () => { throw opts.erroTrades; })
      : vi.fn(async () => opts.trades ?? []),
    fetchClosedOrders: vi.fn(async () => opts.fechadas ?? []),
    // ⚠️ A125.6: este spy NUNCA pode sair do zero — reconciliar é LER.
    createOrder: vi.fn(async () => { throw new Error("PROIBIDO na reconciliação"); }),
  };
  hoisted.exchange = ex;
  return ex;
}

/** Intent padrão: UNKNOWN, conta identificada pela conexão C1. */
function plantarIntent(b: BancoFalso, extra: Record<string, unknown> = {}): IntentRow {
  const linha = {
    id: `i${b.intents.length + 1}`, client_order_id: "zsA125",
    origin: "dca_cron", autonomous: true,
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: 10, limit_price: null,
    requested_notional_usd: 100, simulated: false, state: "UNKNOWN",
    state_reason: null, external_order_id: null,
    filled_qty: 0, filled_quote: 0, canceled_qty: 0,
    fee_total: null, fee_currency: null,
    wallet_address: null, session_id: null, plan_id: null, cycle_number: null,
    conexao_id: "C1", strategy_id: null, strategy_version: null,
    strategy_hash: null, certificate_id: null, credential_fingerprint: null,
    created_at: VELHO, submitted_at: null, last_reconciled_at: null,
    reconcile_attempts: 0,
    ...extra,
  };
  b.intents.push(linha);
  return linha as unknown as IntentRow;
}

/** Reconcilia com a `lerOrdemNaVenue` REAL (sem `ler` injetado) — §15. */
function reconciliar(b: BancoFalso, intent: IntentRow) {
  return reconciliarIntent({
    db: b.cliente, credenciais: async () => CREDS,
  }, intent);
}

const fillsDe = (b: BancoFalso, intentId: string) =>
  b.fills.filter((f) => f.intent_id === intentId);

let ex: ExchangeFalso;
beforeEach(() => { ex = montarExchange({}); });

describe("A125.1 — TZ (ordem alvo) + TM (manual externo) na MESMA página", () => {
  it("⚠️⚠️ TM vai ao detector → deriva → QUARENTENA; TM NUNCA vira fill do intent", async () => {
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "i1" });
    ex = montarExchange({
      ordem: ordemRaw("ORD-Z", 10),
      trades: [tradeRaw("TZ", "ORD-Z", 10), tradeRaw("TM", "MANUAL-1", 3)],
    });

    const r = await reconciliar(b, intent);

    // O trade manual chegou ao detector PELO HISTÓRICO — no contrato antigo
    // ele era filtrado fora antes (é o break §41: este teste FALHA).
    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT");
    expect(r.detalhe).toContain("1 trade(s)");   // só TM é órfão; TZ é nosso
    expect(b.intents[0].state).toBe("QUARANTINED");
    // ⚠️ Fail-closed: em deriva NADA é liquidado — e TM nunca tocou o livro.
    expect(fillsDe(b, "i1")).toHaveLength(0);
    expect(Number(b.intents[0].filled_qty)).toBe(0);
    // §37: uma chamada ao histórico por leitura, custe o caminho que custar.
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    // A125.6: reconciliar é LER.
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ §9: o settlement ingere SÓ tradesDaOrdem — trade de OUTRA ordem na página não contamina o livro", async () => {
    // A contrapartida: quando NÃO há deriva (a outra ordem é conhecida da
    // conta), o settlement acontece — e mesmo assim só TZ entra. É este teste
    // que pega o break §42 (historico → ingerirTrades = filled_qty contaminado).
    const b = bancoFalso();
    // ORD-OUTRA é da MESMA conta (outro intent de C1): explicada na deriva…
    plantarIntent(b, { id: "iOutro", external_order_id: "ORD-OUTRA", state: "FILLED" });
    const intent = plantarIntent(b, { id: "i1" });
    ex = montarExchange({
      ordem: ordemRaw("ORD-Z", 10),
      // …e nada mais: o trade SEM id de ordem saiu daqui de propósito — R8/A128
      // o torna INDETERMINADO (não acusa nem absolve), coberto à parte.
      trades: [tradeRaw("TZ", "ORD-Z", 10), tradeRaw("T-OUTRO", "ORD-OUTRA", 4)],
    });

    const r = await reconciliar(b, intent);

    expect(r.desfecho).toBe("resolvido");
    const livroI1 = b.intents.find((i) => i.id === "i1")!;
    expect(livroI1.state).toBe("FILLED");
    // filled_qty sobe SÓ por TZ (10) — T-OUTRO (4) é da mesma conta mas de
    // OUTRA ordem: explicado na deriva, NUNCA absorvido pelo settlement.
    expect(Number(livroI1.filled_qty)).toBe(10);
    const fills = fillsDe(b, "i1");
    expect(fills.map((f) => f.external_trade_id)).toEqual(["TZ"]);
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125.2 — o manual externo do MESMO símbolo chega ao detector", () => {
  it("⚠️⚠️ assert explícito do caminho: o motivo da quarentena nomeia o órfão", async () => {
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "i1" });
    ex = montarExchange({
      ordem: ordemRaw("ORD-Z", 10),
      trades: [tradeRaw("TZ", "ORD-Z", 10), tradeRaw("TM", "MANUAL-9", 1)],
    });
    const r = await reconciliar(b, intent);
    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT: 1 trade(s) na corretora sem intent correspondente");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125.3 — a leitura do histórico é POR SÍMBOLO", () => {
  it("⚠️ fetchMyTrades é chamado com o símbolo DO INTENT (ETH não participa da reconciliação BTC)", async () => {
    // O desenho já é por símbolo: `fetchMyTrades(symbol, ...)` — o escopo da
    // deriva é (conta × corretora × símbolo × janela). Este teste trava o
    // argumento para que uma "otimização" account-wide não passe em silêncio.
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "iEth", symbol: "ETH/USDT" });
    ex = montarExchange({
      ordem: { ...ordemRaw("ORD-E", 10), symbol: "ETH/USDT" },
      trades: [{ ...tradeRaw("TE", "ORD-E", 10), symbol: "ETH/USDT" }],
    });
    const r = await reconciliar(b, intent);
    expect(r.desfecho).toBe("resolvido");
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(ex.fetchMyTrades.mock.calls[0][0]).toBe("ETH/USDT");
    expect(ex.fetchClosedOrders).not.toHaveBeenCalled(); // achada antes do caminho 3
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125.4 — Cenário D + deriva AO MESMO TEMPO (OrderNotFound, TZ+TM)", () => {
  it("⚠️⚠️ o recovery por TZ acontece (atribuição) E o manual derruba em quarentena — nesta ordem", async () => {
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "i1", external_order_id: "ORD-D" });
    ex = montarExchange({
      erroOrdem: new OrderNotFound("binance does not have order ORD-D"),
      trades: [tradeRaw("TZ", "ORD-D", 7), tradeRaw("TM", "MANUAL-1", 2)],
    });

    const r = await reconciliar(b, intent);

    /**
     * O comportamento observado, documentado: a leitura recuperou a ordem
     * pelo histórico (`so_trades` — o Cenário D funcionou: TZ foi atribuído
     * a ESTE intent, tanto que NÃO aparece como órfão), e IMEDIATAMENTE a
     * deriva falou mais alto — fail-closed, a quarentena vem ANTES do
     * settlement, então o fill de TZ fica para depois da mão humana.
     *
     * A prova dos DOIS fatos ao mesmo tempo está no motivo: exatamente UM
     * órfão (TM). Se o recovery por TZ tivesse falhado, seriam DOIS.
     */
    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT: 1 trade(s)");
    expect(b.intents[0].state).toBe("QUARANTINED");
    expect(fillsDe(b, "i1")).toHaveLength(0);
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️ e sem o manual, o MESMO Cenário D liquida por TZ (o recovery segue inteiro)", async () => {
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "i1", external_order_id: "ORD-D" });
    ex = montarExchange({
      erroOrdem: new OrderNotFound("binance does not have order ORD-D"),
      trades: [tradeRaw("TZ", "ORD-D", 7)],
    });
    const r = await reconciliar(b, intent);
    expect(r.desfecho).toBe("resolvido");
    expect(Number(b.intents[0].filled_qty)).toBe(7);
    expect(fillsDe(b, "i1").map((f) => f.external_trade_id)).toEqual(["TZ"]);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125.5 — fetchOrder ok + fetchMyTrades FALHA → atribuição indeterminada", () => {
  it("⚠️⚠️ NUNCA 'sem drift', NUNCA CANCELED por isso: RECONCILIATION_REQUIRED e segue em dúvida", async () => {
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "i1" });
    ex = montarExchange({
      ordem: ordemRaw("ORD-Z", 10),
      erroTrades: new NotSupported("binance fetchMyTrades is not supported"),
    });

    const r = await reconciliar(b, intent);

    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("historico account-wide falhou");
    expect(b.intents[0].state).toBe("RECONCILIATION_REQUIRED");
    // O financeiro NÃO conclui nada por cima de uma leitura quebrada.
    expect(fillsDe(b, "i1")).toHaveLength(0);
    expect(Number(b.intents[0].filled_qty)).toBe(0);
    // §39: a falha vira `historico: null`, NUNCA um array vazio disfarçado.
    const leitura = await lerOrdemNaVenue("binance", CREDS, {
      symbol: "BTC/USDT", externalOrderId: null, clientOrderId: "zsA125",
    });
    if (leitura.tipo !== "achada") throw new Error(`esperava achada, veio ${leitura.tipo}`);
    expect(leitura.historico).toBeNull();
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(2); // reconciliacao + leitura direta
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125 — página cheia (200): completude NÃO provada (§13B)", () => {
  const paginaCheia = (comOrfao: boolean) => {
    const trades = Array.from({ length: 200 }, (_, i) =>
      tradeRaw(`T${i}`, "ORD-Z", 0.05));
    if (comOrfao) trades[199] = tradeRaw("T199", "MANUAL-ESCONDIDO", 0.05);
    return trades;
  };

  it("⚠️⚠️ 200 trades TODOS nossos → INDETERMINADO, nunca 'sem drift' sobre página possivelmente curta", async () => {
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "i1" });
    ex = montarExchange({ ordem: ordemRaw("ORD-Z", 10), trades: paginaCheia(false) });
    const r = await reconciliar(b, intent);
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("completude nao provada");
    expect(b.intents[0].state).toBe("RECONCILIATION_REQUIRED");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ 200 trades COM um órfão à vista → DERIVA (órfão visível é evidência, truncamento ou não)", async () => {
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "i1" });
    ex = montarExchange({ ordem: ordemRaw("ORD-Z", 10), trades: paginaCheia(true) });
    const r = await reconciliar(b, intent);
    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT: 1 trade(s)");
    expect(b.intents[0].state).toBe("QUARANTINED");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️ 199 trades (página NÃO cheia) sem órfãos → ok, e o settlement liquida", async () => {
    // A fronteira: completude provada porque a página veio ABAIXO do limite.
    const b = bancoFalso();
    const intent = plantarIntent(b, { id: "i1" });
    const trades = [tradeRaw("TZ", "ORD-Z", 10),
      ...Array.from({ length: 198 }, (_, i) => tradeRaw(`T${i}`, "ORD-Z", 0.01))];
    // qty total 10 + 198×0.01 = 11.98: requested_qty folgado para o livro
    // fechar coerente (a linha do banco É o intent — mesma referência).
    b.intents[0].requested_qty = 100;
    ex = montarExchange({ ordem: ordemRaw("ORD-Z", 11.98), trades });
    const r = await reconciliar(b, intent);
    expect(r.desfecho).toBe("resolvido");
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});

describe("A125 — a normalização é ÚNICA e o slot é LAZY (§37/§38)", () => {
  it("⚠️ tradesDaOrdem é FILTRO do histórico — o MESMO objeto normalizado, não uma renormalização", async () => {
    ex = montarExchange({
      ordem: ordemRaw("ORD-Z", 10),
      trades: [tradeRaw("TZ", "ORD-Z", 10), tradeRaw("TM", "MANUAL-1", 1)],
    });
    const leitura = await lerOrdemNaVenue("binance", CREDS, {
      symbol: "BTC/USDT", externalOrderId: null, clientOrderId: "zsA125",
    });
    if (leitura.tipo !== "achada") throw new Error("esperava achada");
    expect(leitura.tradesDaOrdem).toHaveLength(1);
    expect(leitura.historico?.trades).toHaveLength(2);
    // Identidade de referência: o subset não é uma cópia renormalizada.
    expect(leitura.historico?.trades).toContain(leitura.tradesDaOrdem[0]);
    expect(leitura.historico?.trades.map((t) => t.tradeId)).toEqual(["TZ", "TM"]);
    // §14: trade sem timestamp segue na análise (não é descartado na leitura).
    expect(leitura.historico?.possivelmenteIncompleto).toBe(false);
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
  });

  it("⚠️ `ausente_em_todos` segue de pé: negado nos três caminhos, histórico vazio DE VERDADE", async () => {
    ex = montarExchange({
      erroOrdem: new OrderNotFound("não tem"),
      trades: [],            // [] com SUCESSO é fato: sem trades no símbolo
      fechadas: [],
    });
    const leitura = await lerOrdemNaVenue("binance", CREDS, {
      symbol: "BTC/USDT", externalOrderId: "ORD-X", clientOrderId: "zsA125",
    });
    expect(leitura.tipo).toBe("ausente_em_todos");
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);   // slot lazy, 1× no máximo
    // §54 (R8): a ausência viaja COM o destino do histórico — aqui, lido e
    // vazio DE VERDADE ([] com sucesso é fato, não ausência de leitura).
    if (leitura.tipo !== "ausente_em_todos") throw new Error("inalcançável");
    expect(leitura.historico).toEqual({ trades: [], possivelmenteIncompleto: false,
      registrosInvalidos: { total: 0, porMotivo: {} } });
  });

  it("⚠️⚠️ §54: externalOrderId NULL — o histórico é buscado ANTES de declarar ausência", async () => {
    // O buraco do baseline: sem id externo o caminho 1 era pulado e o slot
    // lazy podia NUNCA rodar — a ausência saía sem ninguém ter olhado o
    // histórico da conta. Agora o retorno de ausência executa
    // `buscarHistorico()` antes, custe o que custar.
    ex = montarExchange({
      erroOrdem: new OrderNotFound("não tem"),
      trades: [],
      fechadas: [],
    });
    const leitura = await lerOrdemNaVenue("binance", CREDS, {
      symbol: "BTC/USDT", externalOrderId: null, clientOrderId: "zsA125",
    });
    expect(leitura.tipo).toBe("ausente_em_todos");
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    if (leitura.tipo !== "ausente_em_todos") throw new Error("inalcançável");
    expect(leitura.historico?.trades).toEqual([]);
  });
});

describe("§35 — COMBINADO A125×escopo (R8): dois intents da MESMA conexão + manual externo", () => {
  /**
   * ⚠️ R8 supera R7/A126 (§66): o vínculo de conta é o `conexao_id` gravado
   * NO INTENT — não mais o join pela sessão (mutável, não é prova histórica).
   * O cenário combinado sobrevive intacto com os dois intents marcados C1.
   */
  function plantarCenario() {
    const b = bancoFalso();
    // Intent A: conexão C1, ordem O-A já liquidada, trade T-A no livro.
    plantarIntent(b, { id: "iA", origin: "autopilot_browser",
                       conexao_id: "C1", external_order_id: "O-A", state: "FILLED" });
    b.fills.push({
      id: "fA", intent_id: "iA", exchange_id: "binance",
      external_order_id: "O-A", external_trade_id: "T-A", client_order_id: null,
      symbol: "BTC/USDT", side: "buy", qty: 1, price: 100, quote_amount: 100,
      fee: null, fee_currency: null, executed_at: VELHO, sintetico: false,
      dedupe_key: "kA", raw_hash: null, created_at: VELHO,
    });
    // Intent B: MESMA conexão C1, UNKNOWN a reconciliar.
    const iB = plantarIntent(b, { id: "iB", origin: "autopilot_browser",
                                  conexao_id: "C1" });
    return { b, iB };
  }

  it("⚠️⚠️ T-A é explicado pelo escopo C1 (A126), T-MANUAL é deriva, e NADA entra no livro de B", async () => {
    const { b, iB } = plantarCenario();
    ex = montarExchange({
      ordem: ordemRaw("ORD-B", 5),
      trades: [tradeRaw("T-B", "ORD-B", 5), tradeRaw("T-A", "O-A", 1),
               tradeRaw("T-MANUAL", "M-1", 2)],
    });

    const r = await reconciliar(b, iB);

    // Exatamente UM órfão: T-MANUAL. T-B é a ordem descoberta (idDescoberto)
    // e T-A é do irmão de conta — explicado pelo escopo conexão C1 (R8: o
    // `conexao_id` gravado no intent, sem join de sessão).
    // No baseline A126 isto era falso drift de T-A; no baseline A125 o manual
    // nem chegava ao detector. Os dois consertos, numa asserção.
    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT: 1 trade(s)");
    expect(String(b.intents.find((i) => i.id === "iB")?.state)).toBe("QUARANTINED");
    // Fail-closed: quarentena ANTES do settlement — o livro de B segue virgem.
    expect(fillsDe(b, "iB")).toHaveLength(0);
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ sem o manual: resolve, e os fills de B trazem SÓ os trades da ordem de B (T-A fica fora do livro)", async () => {
    const { b, iB } = plantarCenario();
    ex = montarExchange({
      ordem: ordemRaw("ORD-B", 5),
      trades: [tradeRaw("T-B", "ORD-B", 5), tradeRaw("T-A", "O-A", 1)],
    });

    const r = await reconciliar(b, iB);

    expect(r.desfecho).toBe("resolvido");
    // A deriva absolve T-A pelo escopo (é da mesma conta)…
    // …mas o settlement de B ingere SÓ T-B: mesmo da mesma conta, o trade do
    // irmão NUNCA vira fill deste intent. §9 no cenário combinado.
    const fillsB = fillsDe(b, "iB");
    expect(fillsB.map((f) => f.external_trade_id)).toEqual(["T-B"]);
    expect(Number(b.intents.find((i) => i.id === "iB")?.filled_qty)).toBe(5);
    expect(ex.fetchMyTrades).toHaveBeenCalledTimes(1);
    expect(ex.createOrder).not.toHaveBeenCalled();
  });
});
