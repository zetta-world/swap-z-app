/**
 * ⚠️⚠️⚠️ I9 — A ORDEM EM QUE OS FATOS CHEGAM NÃO PODE MUDAR O RESULTADO.
 *
 * Quantidade, recebido e taxa chegam da corretora em ordens diferentes
 * conforme a venue, o endpoint e o momento: o ACK traz `filled` sem `cost`,
 * os trades trazem a comissão depois, um snapshot posterior corrige o custo.
 * Um sistema que só fecha a conta numa dessas ordens tem um remendo, não um
 * invariante.
 *
 * Cada teste aqui monta a MESMA venda por um caminho diferente e exige o
 * MESMO estado financeiro final, em números absolutos:
 *
 *     base de custo 100 · recebido 100 · taxa 2  ⇒  P&L −2
 *
 * ⚠️ Nada é escrito à mão no intent: tudo entra pela ingestão de verdade.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { ingerirSnapshotDaOrdem, ingerirTrades } from "@/lib/cex/execucao/intents";
import { projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";
import { pendenciasFinanceiras } from "@/lib/autopilot/recuperacao-financeira";
import { entradaAutorizadaNaSessao } from "@/lib/autopilot/autorizacao-de-execucao";

let banco: ReturnType<typeof bancoFalso>;
const chamar = (nome: string, args: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(nome, args).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });

function montar() {
  banco.sessoes.push({ id: "S1", wallet_address: "0xO", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: 0, daily_loss_stop_usd: 500,
    frozen_until_day: null, quarentena_em: null, contabilidade_incompleta_em: null });
  banco.posicoes.push({ id: "p1", session_id: "S1", wallet_address: "0xO",
    exchange_id: "binance", base: "BTC", pair: "BTC/USDT", entry_price: 10_000,
    base_amount: 0.01, cost_usd: 100, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null });
  banco.intents.push({ id: "v1", client_order_id: "cv1", wallet_address: "0xO",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    fee_total: null, fee_currency: null, canceled_qty: 0, conexao_id: "C1",
    external_order_id: "ORD-1" });
}
const aSessao = () => banco.sessoes.find((s) => s.id === "S1")!;
const oIntent = () => banco.intents.find((i) => i.id === "v1")!;
const oEfeito = () => banco.efeitos.find((e) => e.intent_id === "v1");
const aPosicao = () => banco.posicoes.find((p) => p.base === "BTC");

const snap = (o: { qty: number; quote: number | null; fee: number | null }) =>
  ingerirSnapshotDaOrdem(banco.cliente, "v1", "ORD-1", {
    cumulativeQty: o.qty, avgPrice: 10_000, cumulativeQuote: o.quote,
    fee: o.fee, feeCurrency: o.fee == null ? null : "USDT", executedAt: null });
const trade = (t: { id: string; qty: number; quote: number; fee: number | null }) =>
  ingerirTrades(banco.cliente, "v1", "ORD-1", [{
    tradeId: t.id, qty: t.qty, price: t.quote / t.qty, quote: t.quote,
    fee: t.fee, feeCurrency: t.fee == null ? null : "USDT",
    executedAt: null, orderId: "ORD-1" }]);
const projetar = () => projetarEfeitoDoIntent("v1", { chamarRpc: chamar });

/** O ÚNICO estado final aceitável, seja qual for o caminho. */
async function exigirConvergencia() {
  expect(Number(oIntent().filled_qty), "filled_qty").toBeCloseTo(0.01, 12);
  expect(Number(oIntent().filled_quote), "filled_quote").toBeCloseTo(100, 10);
  expect(Number(oIntent().fee_total), "fee_total").toBeCloseTo(2, 10);
  expect(Number(oEfeito()!.applied_qty), "applied_qty").toBeCloseTo(0.01, 12);
  expect(Number(oEfeito()!.applied_quote), "applied_quote").toBeCloseTo(100, 10);
  expect(Number(oEfeito()!.fee_aplicada_usd), "fee_aplicada").toBeCloseTo(2, 10);
  expect(Number(oEfeito()!.pnl_aplicado_usd), "pnl_aplicado").toBeCloseTo(-2, 10);
  expect(Number(aSessao().pnl_today), "pnl_today").toBeCloseTo(-2, 10);
  // a posição fechou: 0,01 vendidos de 0,01
  expect(aPosicao()).toBeUndefined();
  // nada pendente, e a compra liberada
  expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(0);
  expect(aSessao().contabilidade_incompleta_em).toBe(null);
  expect(entradaAutorizadaNaSessao({
    emQuarentena: false,
    contabilidadeIncompleta: Boolean(aSessao().contabilidade_incompleta_em),
  }).ok).toBe(true);
  // ⚠️ E o replay não move mais nada.
  for (let i = 0; i < 2; i++) {
    const r = await projetar();
    expect(r.ok && r.realizado).toBe(0);
  }
  expect(Number(aSessao().pnl_today)).toBeCloseTo(-2, 10);
}

beforeEach(() => { banco = bancoFalso(); montar(); });

describe("I9 — o mesmo dinheiro por caminhos diferentes", () => {
  it("⚠️ qty → quote → fee (ACK mudo, custo depois, comissão por último)", async () => {
    await snap({ qty: 0.01, quote: null, fee: null }); await projetar();
    await snap({ qty: 0.01, quote: 100,  fee: null }); await projetar();
    await snap({ qty: 0.01, quote: 100,  fee: 2    }); await projetar();
    await exigirConvergencia();
  });

  it("⚠️ qty → fee → quote (a comissão aparece antes do custo)", async () => {
    await snap({ qty: 0.01, quote: null, fee: null }); await projetar();
    await snap({ qty: 0.01, quote: null, fee: 2    }); await projetar();
    await snap({ qty: 0.01, quote: 100,  fee: 2    }); await projetar();
    await exigirConvergencia();
  });

  it("⚠️ tudo de uma vez (o caso feliz do market order)", async () => {
    await snap({ qty: 0.01, quote: 100, fee: 2 }); await projetar();
    await exigirConvergencia();
  });

  it("⚠️⚠️ sintético → real: o trade substitui e a conta fecha igual", async () => {
    await snap({ qty: 0.01, quote: 100, fee: null }); await projetar();
    // a sessão está presa aqui: a taxa não é conhecida
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();
    await trade({ id: "T1", qty: 0.01, quote: 100, fee: 2 }); await projetar();
    await exigirConvergencia();
  });

  it("⚠️⚠️ parcial → parcial → FILLED, com a taxa só no fim", async () => {
    await snap({ qty: 0.004, quote: 40, fee: null }); await projetar();
    await snap({ qty: 0.007, quote: 70, fee: null }); await projetar();
    await snap({ qty: 0.01,  quote: 100, fee: 2   }); await projetar();
    await exigirConvergencia();
  });

  it("⚠️⚠️ RESTART no meio: nada projetado até o fim, e converge igual", async () => {
    /**
     * Simula o processo morrendo depois de cada ingestão: os fatos entram no
     * livro e NINGUÉM projeta. A recuperação faz a conta inteira de uma vez —
     * e tem de dar o mesmo número de quem projetou a cada passo.
     */
    await snap({ qty: 0.004, quote: 40, fee: null });
    await snap({ qty: 0.01,  quote: 100, fee: null });
    await trade({ id: "T1", qty: 0.01, quote: 100, fee: 2 });
    expect(oEfeito()).toBeUndefined();          // nada foi projetado ainda

    const p = await pendenciasFinanceiras(50, { chamarRpc: chamar });
    expect(p).toHaveLength(1);
    expect(p![0]).toMatchObject({ motivo: "sem_marcador", precisaVenue: false });
    await projetar();
    await exigirConvergencia();
  });

  it("⚠️⚠️ projetar DUAS vezes entre cada fato não muda nada", async () => {
    await snap({ qty: 0.01, quote: null, fee: null });
    await projetar(); await projetar();
    await snap({ qty: 0.01, quote: 100, fee: null });
    await projetar(); await projetar();
    await trade({ id: "T1", qty: 0.01, quote: 100, fee: 2 });
    await projetar(); await projetar();
    await exigirConvergencia();
  });
});

describe("I9 — parciais e cancelamento", () => {
  it("⚠️⚠️ parcial → CANCELED: só o executado entra, o resto volta", async () => {
    await snap({ qty: 0.004, quote: 40, fee: 1 });
    oIntent().state = "CANCELED";
    oIntent().canceled_qty = 0.006;
    await projetar();

    // 40 recebidos − 40 de custo proporcional − 1 de taxa = −1
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-1, 10);
    const pos = aPosicao()!;
    expect(Number(pos.base_amount)).toBeCloseTo(0.006, 12);
    expect(Number(pos.cost_usd)).toBeCloseTo(60, 10);
    // ⚠️ E o compromisso do que foi cancelado SEM preencher não existe mais,
    // mas o que preencheu e já foi projetado também não compromete (A144).
    expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(0);
  });

  it("⚠️⚠️⚠️ PARCIAL projetado duas vezes NÃO reduz a posição duas vezes", async () => {
    /**
     * ⚠️ ESTE TESTE NASCEU DE UMA QUEBRA DELIBERADA QUE NINGUÉM PEGOU.
     *
     * Apagar o watermark (`delta = filled_qty − applied_qty` virando
     * `delta = filled_qty`) passou por toda a suíte. O motivo é que a conta
     * ACUMULADA do A142 protege o P&L mesmo com o watermark errado, e todos
     * os casos de convergência FECHAVAM a posição na primeira projeção — uma
     * posição apagada não pode ser reduzida de novo.
     *
     * O estrago de um watermark perdido mora exatamente onde faltava cobrir:
     * um PARCIAL que continua aberto, projetado mais de uma vez. Cada
     * repetição comeria a posição de novo — e é assim que o bot passa a
     * acreditar que não tem uma bolsa que tem.
     */
    await snap({ qty: 0.004, quote: 40, fee: 1 });

    const primeira = await projetar();
    expect(primeira.ok && primeira.motivo).toBe("aplicado");
    expect(Number(aPosicao()!.base_amount)).toBeCloseTo(0.006, 12);
    expect(Number(aPosicao()!.cost_usd)).toBeCloseTo(60, 10);
    expect(Number(oEfeito()!.applied_qty)).toBeCloseTo(0.004, 12);

    // ⚠️ Três repetições: a posição NÃO pode se mexer mais.
    for (let i = 0; i < 3; i++) {
      const r = await projetar();
      expect(r.ok && r.motivo, `repeticao ${i}`).toBe("sem_delta");
      expect(r.ok && r.realizado).toBe(0);
      expect(Number(aPosicao()!.base_amount), `base na repeticao ${i}`)
        .toBeCloseTo(0.006, 12);
      expect(Number(aPosicao()!.cost_usd), `custo na repeticao ${i}`)
        .toBeCloseTo(60, 10);
    }
    // 40 recebidos − 40 de custo − 1 de taxa = −1, uma única vez.
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-1, 10);
    expect(Number(oEfeito()!.pnl_aplicado_usd)).toBeCloseTo(-1, 10);
  });

  it("⚠️⚠️ UNKNOWN → FILLED converge para o mesmo número", async () => {
    oIntent().state = "UNKNOWN";
    await snap({ qty: 0.01, quote: 100, fee: 2 });
    expect(oIntent().state).toBe("FILLED");
    await projetar();
    await exigirConvergencia();
  });
});
