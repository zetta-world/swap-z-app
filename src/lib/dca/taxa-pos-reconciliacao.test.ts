/**
 * ⚠️⚠️ A119 — A TAXA DO CICLO VEM DO INTENT RELIDO, NÃO DA FOTO VELHA.
 *
 * O cron do DCA reconciliava o intent vivo e relia o MESMO intent pelo id
 * (A117) — mas na hora de fechar o ciclo gravava:
 *
 *     taxaUsd: vivo.simulated ? null : vivo.fee_total
 *
 * `vivo` é a fotografia PRÉ-reconciliação: `fee_total` nela é a taxa VELHA
 * (ou null), e era exatamente quando a reconciliação FUNCIONAVA — corretora
 * confirmou, fee real no livro — que o ciclo fechava sem ela. Como
 * `decidirPeloIntent` não devolve fee, aquela linha era o ÚNICO caminho da
 * taxa até o extrato do ciclo.
 *
 * Estes testes exercem a cadeia real (reconciliar → reler por id → decidir)
 * sobre o banco falso e travam o fonte do cron: depois da linha da releitura,
 * NENHUM dado financeiro mutável pode vir de `vivo`.
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

async function plantarIntent(
  banco: ReturnType<typeof bancoFalso>, estado: IntentRow["state"], requestedQty: number,
): Promise<IntentRow> {
  const { data } = await banco.cliente.from("cex_execution_intents").insert({
    client_order_id: `zswap_a119_${estado}`,
    origin: "dca_cron", autonomous: true, wallet_address: "0xabc",
    plan_id: "plano-1", cycle_number: 2, conexao_id: "cx-1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: requestedQty,
    simulated: false, state: estado, created_at: VELHO,
  }).select("*").limit(1);
  return (data as IntentRow[])[0];
}

/** A leitura da corretora: 0.01 BTC a 61.000, com 0.61 de taxa em USDT. */
const LEITURA_COM_TAXA: LeituraDaOrdem = {
  tipo: "achada",
  ordem: { id: "ext-a119", status: "closed", filled: 0.01, average: 61_000,
           cost: 610, fee: { cost: 0.61, currency: "USDT" } } as never,
  trades: [{ tradeId: "t-a119", orderId: "ext-a119", qty: 0.01, price: 61_000,
             quote: 610, fee: 0.61, feeCurrency: "USDT", executedAt: VELHO }],
};

async function reconciliar(banco: ReturnType<typeof bancoFalso>, leitura: LeituraDaOrdem) {
  const vivo = (await intentVivoDoPlano(banco.cliente, "plano-1"))!;
  expect(vivo, "o intent plantado tem de aparecer como vivo").toBeTruthy();
  await reconciliarIntent({
    db: banco.cliente, credenciais: async () => CREDS, ler: async () => leitura,
  }, vivo);
  const atual = await intentPorId(banco.cliente, vivo.id);
  expect(atual, "o intent não pode ter sumido").toBeTruthy();
  return atual as IntentRow;
}

describe("A119.1 — UNKNOWN com fee 0 → FILLED 0.01/610/0.61 ⇒ o ciclo grava taxaUsd 0.61", () => {
  it("a taxa que chega ao fecharCiclo é a do intent RELIDO, não a da fotografia velha", async () => {
    const banco = bancoFalso();
    const plantado = await plantarIntent(banco, "UNKNOWN", 0.01);
    // ⚠️ A FOTO VELHA: fee_total null — era ISTO que o ciclo gravava (A119).
    // (Cópia profunda: o banco falso devolve a linha viva; o cron real lê um
    // SNAPSHOT pré-reconciliação, e é esse o contraste que importa aqui.)
    const fotoVelha = structuredClone(plantado);
    expect(fotoVelha.fee_total).toBeNull();

    const atual = await reconciliar(banco, LEITURA_COM_TAXA);
    expect(atual.state).toBe("FILLED");
    expect(Number(atual.filled_qty)).toBeCloseTo(0.01, 10);
    expect(Number(atual.filled_quote)).toBeCloseTo(610, 6);
    expect(Number(atual.fee_total)).toBeCloseTo(0.61, 10);
    expect(atual.fee_currency).toBe("USDT");

    const decisao = decidirPeloIntent(atual);
    if (decisao.acao !== "liquidar") throw new Error(`veio ${decisao.acao}`);
    expect(decisao.quantidade).toBeCloseTo(0.01, 10);
    expect(decisao.custoUsd).toBeCloseTo(610, 6);

    // ⚠️ A LINHA DO CRON, exercitada com o dado real: a expressão que o cron
    // usa para `taxaUsd` tem de devolver 0.61 sobre o intent RELIDO — e a
    // guarda estrutural abaixo trava que é exatamente esta a expressão.
    const taxaUsd = atual.simulated ? null : atual.fee_total;
    expect(taxaUsd).toBeCloseTo(0.61, 10);
    // E sobre a fotografia velha seria null — é essa a regressão proibida.
    const taxaDaFotoVelha = fotoVelha.simulated ? null : fotoVelha.fee_total;
    expect(taxaDaFotoVelha).toBeNull();
  });
});

describe("A119.2 — fee velha null não sobrevive: a NOVA (0.61) é a usada", () => {
  it("UNKNOWN com fee_total null reconcilia e o ciclo usa a taxa trazida pela venue", async () => {
    const banco = bancoFalso();
    await plantarIntent(banco, "UNKNOWN", 0.01);
    const atual = await reconciliar(banco, LEITURA_COM_TAXA);
    expect(Number(atual.fee_total)).toBeCloseTo(0.61, 10);
    const taxaUsd = atual.simulated ? null : atual.fee_total;
    expect(taxaUsd).not.toBeNull();
    expect(taxaUsd).toBeCloseTo(0.61, 10);
  });
});

describe("A119.3 — replay da MESMA reconciliação não soma a taxa duas vezes", () => {
  it("SUBMITTED parcial reconciliado 2× com os mesmos trades: fee_total continua 0.61", async () => {
    const banco = bancoFalso();
    // Pedido de 0.02, executado 0.01: o intent NÃO fecha, fica PARTIALLY_FILLED
    // e a passada seguinte reconcilia de novo com a mesma leitura (replay).
    await plantarIntent(banco, "SUBMITTED", 0.02);
    const leituraParcial: LeituraDaOrdem = {
      tipo: "achada",
      ordem: { id: "ext-a119", status: "open", filled: 0.01, average: 61_000,
               cost: 610, fee: { cost: 0.61, currency: "USDT" } } as never,
      trades: LEITURA_COM_TAXA.trades,
    };
    const primeira = await reconciliar(banco, leituraParcial);
    expect(primeira.state).toBe("PARTIALLY_FILLED");
    expect(Number(primeira.fee_total)).toBeCloseTo(0.61, 10);

    const segunda = await reconciliar(banco, leituraParcial);
    // ⚠️ 1.22 seria a taxa somada duas vezes — o dedupe por trade_id impede.
    expect(Number(segunda.fee_total)).toBeCloseTo(0.61, 10);
    expect(Number(segunda.filled_qty)).toBeCloseTo(0.01, 10);
    expect(Number(segunda.filled_quote)).toBeCloseTo(610, 6);
  });
});

describe("A119 — guarda estrutural do cron, ancorada na linha da releitura", () => {
  const iRele = CODIGO.indexOf("intentPorId(dbExec, vivo.id)");
  const TRECHO = iRele >= 0 ? CODIGO.slice(iRele) : "";

  it("⚠️⚠️⚠️ depois da releitura, NENHUM dado mutável do intent vem de `vivo`", () => {
    expect(iRele, "a releitura por id existe").toBeGreaterThan(-1);
    // A cicatriz é textual, mas ancorada na releitura — não um grep burro em
    // comentário (eles já foram removidos de CODIGO). `vivo.id` segue válido:
    // é a chave da releitura, não um dado financeiro.
    const proibidos = /\bvivo\.(filled_qty|filled_quote|avg_fill_price|fee_total|canceled_qty|external_order_id|state|simulated|cycle_number)\b/;
    const m = TRECHO.match(proibidos);
    expect(m, `dado pré-reconciliação usado depois da releitura: ${m?.[0]}`).toBeNull();
  });

  it("⚠️⚠️ taxaUsd, simulado e ciclo saem de `atual`", () => {
    expect(TRECHO).toContain("taxaUsd: atual.simulated ? null : atual.fee_total");
    expect(TRECHO).toContain("simulado: atual.simulated");
    expect(TRECHO).toContain("const ciclo = Number(atual.cycle_number)");
  });

  it("⚠️ a linha exata do A119 não voltou", () => {
    expect(CODIGO).not.toContain("vivo.fee_total");
    expect(CODIGO).not.toContain("taxaUsd: vivo.simulated");
  });
});
