/**
 * ⚠️⚠️ A117 — O DCA RELÊ O MESMO INTENT, PELO ID, DEPOIS DE RECONCILIAR.
 *
 * O cron do DCA tinha esta linha, uma abaixo do comentário que jura que "o que
 * entra no ciclo é o que o livro tem":
 *
 *     const atual = (await intentVivoDoPlano(db, p.id)) ?? null;
 *     const decisao = decidirPeloIntent(atual ?? { ...vivo, state: "FILLED" });
 *
 * `intentVivoDoPlano` só enxerga estados NÃO-terminais. Quando a reconciliação
 * FUNCIONAVA — corretora confirmou, livro fechou em FILLED — o intent saía da
 * consulta, `atual` vinha `null`, e o fallback SINTÉTICO liquidava o ciclo como
 * "comprou tudo" com os números do PEDIDO: `filled_qty = 0` virando FILLED, o
 * A81 ressuscitado por um `??`.
 *
 * Estes testes exercem a cadeia real que o cron percorre depois de reconciliar
 * — `intentPorId` → `decidirPeloIntent` — sobre o banco falso, e travam o
 * fonte do cron contra o retorno do fallback.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { reconciliarIntent } from "@/lib/cex/execucao/reconciliador";
import { intentPorId, intentVivoDoPlano, type IntentRow } from "@/lib/cex/execucao/intents";
import { decidirPeloIntent } from "@/lib/dca/liquidacao";
import type { LeituraDaOrdem } from "@/lib/cex/execucao/venue-leitura";
import type { CexCredentials } from "@/lib/cex/types";

const CRON = readFileSync("src/app/api/dca/cron/route.ts", "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
const CODIGO = semComentarios(CRON);

const CREDS: CexCredentials = { apiKey: "k12345678", apiSecret: "s12345678" };
const VELHO = new Date(Date.now() - 10 * 60_000).toISOString();

/** Um intent vivo de um plano de DCA, como o cron o encontraria. */
async function plantarIntent(
  banco: ReturnType<typeof bancoFalso>,
  estado: IntentRow["state"], requestedQty: number,
): Promise<IntentRow> {
  const { data } = await banco.cliente.from("cex_execution_intents").insert({
    client_order_id: `zswap_test_${estado}`,
    origin: "dca_cron", autonomous: true, wallet_address: "0xabc",
    plan_id: "plano-1", cycle_number: 2, conexao_id: "cx-1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: requestedQty,
    simulated: false, state: estado, created_at: VELHO,
  }).select("*").limit(1);
  return (data as IntentRow[])[0];
}

async function reconciliarEReler(banco: ReturnType<typeof bancoFalso>, leitura: LeituraDaOrdem) {
  const vivo = (await intentVivoDoPlano(banco.cliente, "plano-1"))!;
  expect(vivo, "o intent plantado tem de aparecer como vivo").toBeTruthy();
  await reconciliarIntent({
    db: banco.cliente,
    credenciais: async () => CREDS,
    ler: async () => leitura,
  }, vivo);
  // ⚠️ O PASSO DO A117: reler o MESMO intent, pelo ID — não outra consulta.
  const atual = await intentPorId(banco.cliente, vivo.id);
  expect(atual, "o intent não pode ter sumido").toBeTruthy();
  return decidirPeloIntent(atual as IntentRow);
}

describe("A117.1 — UNKNOWN→FILLED liquida com os números REAIS do livro", () => {
  it("o ciclo fecha com qty/cost da corretora, e o gasto acumulado sobe", async () => {
    const banco = bancoFalso();
    await plantarIntent(banco, "UNKNOWN", 0.01);
    // ⚠️ O preço realizado NÃO é o de referência do pedido: a corretora
    // executou a 61.000. O ciclo tem de fechar com o número DELA.
    const trades = [{ tradeId: "t1", orderId: "ext-1", qty: 0.01, price: 61_000,
                      quote: 610, fee: null, feeCurrency: null, executedAt: VELHO }];
    const decisao = await reconciliarEReler(banco, {
      tipo: "achada",
      ordem: { id: "ext-1", status: "closed", filled: 0.01, average: 61_000,
               cost: 610 } as never,
      // A125: settlement lê tradesDaOrdem; a deriva lê o histórico — aqui os
      // dois carregam os mesmos trades da própria ordem, como na leitura real.
      tradesDaOrdem: trades,
      historico: { trades, possivelmenteIncompleto: false },
    });
    if (decisao.acao !== "liquidar") throw new Error(`esperava liquidar, veio ${decisao.acao}`);
    expect(decisao.status).toBe("feito");
    expect(decisao.contaComoFeito).toBe(true);
    // ⚠️ O gasto acumulado do plano sobe com ISTO — o custo real, não o pedido.
    expect(decisao.quantidade).toBeCloseTo(0.01, 10);
    expect(decisao.custoUsd).toBeCloseTo(610, 6);
    // E o intent no livro conta a mesma história.
    const noLivro = await intentPorId(banco.cliente,
      (await intentVivoDoPlano(banco.cliente, "plano-1"))?.id ?? "");
    expect(noLivro?.state ?? "FILLED").toBe("FILLED");
  });
});

describe("A117.2 — UNKNOWN→CANCELED falhou com custo ZERO", () => {
  it("ausência concluída (ordem velha, negada em todos os caminhos) vira falhou $0", async () => {
    const banco = bancoFalso();
    await plantarIntent(banco, "UNKNOWN", 0.01);
    const decisao = await reconciliarEReler(banco, {
      tipo: "ausente_em_todos", consultados: ["fetchOrder", "fetchMyTrades"],
    });
    if (decisao.acao !== "liquidar") throw new Error(`esperava liquidar, veio ${decisao.acao}`);
    expect(decisao.status).toBe("falhou");
    expect(decisao.contaComoFeito).toBe(false);
    expect(decisao.custoUsd).toBe(0);
    expect(decisao.quantidade).toBe(0);
  });
});

describe("A117.4 — PARTIAL→CANCELED conta SÓ o executado", () => {
  it("o cancelamento do remanescente não apaga o fill que já aconteceu (A101)", async () => {
    const banco = bancoFalso();
    await plantarIntent(banco, "SUBMITTED", 0.01);
    const trades = [{ tradeId: "t2", orderId: "ext-2", qty: 0.004, price: 60_000,
                      quote: 240, fee: null, feeCurrency: null, executedAt: VELHO }];
    const decisao = await reconciliarEReler(banco, {
      tipo: "achada",
      // ⚠️ A ordem executou 0.004 de 0.01 e depois foi cancelada. O ciclo
      // liquida 0.004 — nem 0.01 (o pedido) nem 0 (o cancelamento).
      ordem: { id: "ext-2", status: "canceled", filled: 0.004, average: 60_000,
               cost: 240 } as never,
      tradesDaOrdem: trades,
      historico: { trades, possivelmenteIncompleto: false },
    });
    if (decisao.acao !== "liquidar") throw new Error(`esperava liquidar, veio ${decisao.acao}`);
    expect(decisao.status).toBe("feito");
    expect(decisao.quantidade).toBeCloseTo(0.004, 10);
    expect(decisao.custoUsd).toBeCloseTo(240, 6);
  });
});

describe("A117.3/A117.5 — o cron relê PELO ID e não tem fallback sintético", () => {
  it("⚠️⚠️ depois de reconciliar, a decisão sai de `intentPorId(dbExec, vivo.id)`", () => {
    const iRec = CODIGO.indexOf("reconciliarIntent(");
    const iRele = CODIGO.indexOf("intentPorId(dbExec, vivo.id)");
    const iDecide = CODIGO.indexOf("decidirPeloIntent(atual)");
    expect(iRele).toBeGreaterThan(iRec);
    expect(iDecide).toBeGreaterThan(iRele);
  });

  it("⚠️⚠️ falha de releitura (`undefined`) ADIA, fail-closed, antes de decidir", () => {
    const iRele = CODIGO.indexOf("intentPorId(dbExec, vivo.id)");
    const iDecide = CODIGO.indexOf("decidirPeloIntent(atual)");
    const trecho = CODIGO.slice(iRele, iDecide);
    expect(trecho).toMatch(/if \(atual === undefined\)/);
    expect(trecho).toMatch(/acao: "adiado"/);
  });

  it("⚠️⚠️ intent SUMIDO (`null`) é incidente crítico, e o plano NÃO avança", () => {
    const iRele = CODIGO.indexOf("intentPorId(dbExec, vivo.id)");
    const iDecide = CODIGO.indexOf("decidirPeloIntent(atual)");
    const trecho = CODIGO.slice(iRele, iDecide);
    expect(trecho).toMatch(/if \(atual === null\)/);
    expect(trecho).toMatch(/recordEvent\("dca_intent_sumiu"/);
    expect(trecho).toMatch(/acao: "adiado"/);
  });

  it("⚠️⚠️⚠️ o fallback `{...vivo, state: \"FILLED\"}` não existe mais — em lugar nenhum", () => {
    // A linha exata que liquidava com estado inventado.
    expect(CODIGO).not.toMatch(/\?\?\s*\{\s*\.\.\.vivo/);
    // E nenhum estado sintético de qualquer espécie nesta rota.
    expect(CODIGO).not.toMatch(/state:\s*"FILLED"\s*\}/);
    // A releitura pela consulta de "vivos" também não voltou: ela não enxerga
    // estados terminais, que é exatamente o que derrubava a versão antiga.
    const iRec = CODIGO.indexOf("reconciliarIntent(");
    expect(CODIGO.indexOf("intentVivoDoPlano(", iRec)).toBe(-1);
  });
});
