/**
 * ⚠️⚠️ A118 — FEE CUMULATIVA DUPLICADA EM SNAPSHOTS + COBERTURA SYNTHETIC→REAL
 *
 * Dois fatos medidos no reteste:
 *
 *   1. `p_fee` é CUMULATIVO da ordem (`order.fee.cost` do CCXT), igual
 *      `p_cumulative_qty`. A 0051 gravava o cumulativo INTEIRO em cada fill
 *      sintético (que carrega qty DELTA) e `cex_recalcular_intent` soma por
 *      linha: snapshots 0.03 → 0.05 fechavam `fee_total = 0.08`. A invariante
 *      correta: o fee_total final INDEPENDE do número de snapshots.
 *
 *   2. `fetchMyTrades` é página única de 200 SEM prova de completude, e a
 *      ingestão deletava os sintéticos na mesma transação: um lote parcial
 *      substituía a estimativa por um fato menor, para sempre. Agora o
 *      sintético só cede quando o real cobre o estimado; lote parcial é
 *      ADIADO (ok:false 'cobertura_incompleta'), sem deletar nem inserir.
 *
 * O comportamento é exercitado contra o banco-falso (que reproduz a 0059) e
 * a guarda estrutural LÊ a migration de verdade — parser vazio aprovaria o
 * vazio, então o primeiro teste existe para impedir isso.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { ingerirSnapshotDaOrdem, ingerirTrades, type IntentRow }
  from "@/lib/cex/execucao/intents";
import { reconciliarIntent } from "@/lib/cex/execucao/reconciliador";
import type { EstadoDoIntent } from "@/lib/cex/execucao/estados";
import type { LeituraDaOrdem } from "@/lib/cex/execucao/venue-leitura";

const SQL_0059 = readFileSync(
  "supabase/migrations/0059_fee_cumulativa_e_cobertura.sql", "utf8");

/** Intent pós-envio (SUBMITTED) de 5 unidades, pronto para receber fills. */
async function comIntent(b: ReturnType<typeof bancoFalso>,
                         estado: EstadoDoIntent = "SUBMITTED") {
  await b.cliente.from("cex_execution_intents").insert({
    id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: 5, client_order_id: "zsFEE",
    origin: "dca_cron", autonomous: true, state: estado,
  });
  return b.intents[0];
}

const snap = (b: ReturnType<typeof bancoFalso>, s: {
  qty: number; quote: number; fee?: number | null; moeda?: string | null;
}) => ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-1", {
  cumulativeQty: s.qty, avgPrice: s.qty > 0 ? s.quote / s.qty : 0,
  cumulativeQuote: s.quote, fee: s.fee ?? null, feeCurrency: s.moeda ?? "USDT",
});

const feeTotal = (b: ReturnType<typeof bancoFalso>) => Number(b.intents[0].fee_total);

describe("① a fee é CUMULATIVA — grava-se o DELTA, nunca o inteiro (A118)", () => {
  it("⚠️⚠️ A: 3/300/0.03 → B: 5/500/0.05 ⇒ fee_total 0.05, NUNCA 0.08", async () => {
    const b = bancoFalso();
    await comIntent(b);
    const a = await snap(b, { qty: 3, quote: 300, fee: 0.03 });
    expect(a.ok).toBe(true);
    const r = await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    expect(r.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
    expect(Number(b.intents[0].filled_quote)).toBe(500);
    // O defeito medido: 0.03 + 0.05 = 0.08. O delta correto: 0.03 + 0.02.
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
    expect(b.fills).toHaveLength(2);
    expect(Number(b.fills[1].fee)).toBeCloseTo(0.02, 12);
  });

  it("replay do MESMO snapshot 2× não soma nada (dedupe com fee na chave)", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 3, quote: 300, fee: 0.03 });
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const r2 = await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.inseridos).toBe(0);
    expect(b.fills).toHaveLength(2);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
  });

  it("⚠️ mesma qty 5 com fee corrigida 0.03→0.05: ajuste de qty ZERO, final 0.05", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 5, quote: 500, fee: 0.03 });
    const r = await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inseridos).toBe(1);
    // O ajuste é um fill de qty zero e quote zero carregando só o delta.
    const ajuste = b.fills.find((f) => Number(f.qty) === 0);
    expect(ajuste).toBeDefined();
    expect(Number(ajuste!.quote_amount)).toBe(0);
    expect(Number(ajuste!.fee)).toBeCloseTo(0.02, 12);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
    // E o replay do ajuste não soma de novo.
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
    expect(b.fills).toHaveLength(2);
  });

  it("fee null não inventa fee — fee_total permanece null", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 3, quote: 300, fee: null, moeda: null });
    await snap(b, { qty: 5, quote: 500, fee: null, moeda: null });
    expect(b.intents[0].fee_total).toBeNull();
    expect(Number(b.intents[0].filled_qty)).toBe(5);
  });

  it("⚠️⚠️ moeda de fee muda entre snapshots → EXCEÇÃO (fail-closed, sem somar moedas)", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 3, quote: 300, fee: 0.03, moeda: "USDT" });
    const r = await snap(b, { qty: 5, quote: 500, fee: 0.05, moeda: "BNB" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toMatch(/fee_currency incompativel/i);
    // Nada mudou: nem fill novo, nem fee misturada.
    expect(b.fills).toHaveLength(1);
    expect(feeTotal(b)).toBeCloseTo(0.03, 12);
  });
});

describe("② guarda de cobertura synthetic→real (A118)", () => {
  const tradesCompletos = [
    { tradeId: "T1", qty: 2, price: 100, quote: 200, fee: 0.02, feeCurrency: "USDT" },
    { tradeId: "T2", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" },
  ];

  it("⚠️⚠️ cobertura completa: snapshot 5/0.05 + trades 2/0.02+3/0.03 ⇒ qty 5, fee 0.05", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", tradesCompletos);
    expect(r.ok).toBe(true);
    // O sintético cedeu lugar aos dois fatos; nada dobrou.
    expect(b.fills).toHaveLength(2);
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(5);   // não 10, não 0
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);         // não 0.10
  });

  it("⚠️⚠️ trades parciais (2 < sintético 5): NADA deleta, NADA insere, ok:false adiado", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1",
      [tradesCompletos[0]]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.porque).toBe("cobertura_incompleta");
      expect(r.adiado).toBe(true);
    }
    // O sintético está intacto e o trade parcial NÃO entrou (senão dobrava
    // quando o lote completo chegasse).
    expect(b.fills).toHaveLength(1);
    expect(b.fills[0].sintetico).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
    // A próxima tentativa, com o lote completo, fecha a cobertura.
    const r2 = await ingerirTrades(b.cliente, "i-fee", "ORD-1", tradesCompletos);
    expect(r2.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
  });

  it("sem sintético na ordem, trades reais entram normalmente (guarda não atrapalha)", async () => {
    const b = bancoFalso();
    await comIntent(b);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", tradesCompletos);
    expect(r.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
  });

  it("⚠️ o reconciliador trata cobertura_incompleta como ADIADO, não como divergência", async () => {
    const b = bancoFalso();
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: 10, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: "UNKNOWN",
      external_order_id: "ORD-1",
    });
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    // O snapshot promoveu UNKNOWN → PARTIALLY_FILLED (recálculo do livro).
    expect(b.intents[0].state).toBe("PARTIALLY_FILLED");
    const leitura: LeituraDaOrdem = { tipo: "so_trades", trades: [
      { tradeId: "T1", orderId: "ORD-1", qty: 2, price: 100, quote: 200,
        fee: 0.02, feeCurrency: "USDT", executedAt: null },
    ] };
    const r = await reconciliarIntent({
      db: b.cliente, credenciais: async () => ({ apiKey: "k", apiSecret: "s" }),
      ler: vi.fn(async () => leitura),
    }, b.intents[0] as unknown as IntentRow);
    // Adiado: segue em dúvida NO MESMO ESTADO — não RECONCILIATION_REQUIRED,
    // não QUARANTINED, e o sintético continua valendo.
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(b.intents[0].state).toBe("PARTIALLY_FILLED");
    expect(b.fills).toHaveLength(1);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
  });
});

describe("③ revisão round 3 — a base do delta da fee é o LIVRO INTEIRO da ordem", () => {
  const tradesCompletos = [
    { tradeId: "T1", qty: 2, price: 100, quote: 200, fee: 0.02, feeCurrency: "USDT" },
    { tradeId: "T2", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" },
  ];

  it("⚠️⚠️ (a) snapshot 5/0.05 → trades completos (2/0.02+3/0.03) → snapshot 8/0.08 ⇒ qty 8, fee 0.08", async () => {
    // O defeito medido pelo revisor: depois da substituição synthetic→real
    // não há mais sintético; o delta que olhava só sintéticos via zero e
    // regravava a fee cumulativa INTEIRA — fee_total fechava 0.13.
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const r1 = await ingerirTrades(b.cliente, "i-fee", "ORD-1", tradesCompletos);
    expect(r1.ok).toBe(true);
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    const r2 = await snap(b, { qty: 8, quote: 800, fee: 0.08 });
    expect(r2.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    // 0.05 já estava no livro (nos trades reais): o delta é 0.03, não 0.08.
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);
  });

  it("⚠️⚠️ (b) snapshot 5/0.05 → trades completos → REPLAY do 5/0.05 ⇒ fee_total continua 0.05", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const r1 = await ingerirTrades(b.cliente, "i-fee", "ORD-1", tradesCompletos);
    expect(r1.ok).toBe(true);
    // O replay do snapshot PRÉ-trades não pode somar nada: qty parada, fee
    // já contabilizada nos fills reais da mesma ordem.
    const r2 = await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.inseridos).toBe(0);
    expect(b.fills).toHaveLength(2);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
  });

  it("⚠️⚠️ livro USDT 0.03 → snapshot 0.05 com moeda NULL ⇒ EXCEÇÃO (fail-closed)", async () => {
    // O CCXT pode trazer `cost` sem `currency`: somar como se fosse USDT
    // seria mistura cega de moedas. O null fecha como qualquer divergência.
    // (chamada direta: o helper `snap` defaulta moeda null para "USDT")
    const b = bancoFalso();
    await comIntent(b);
    await snap(b, { qty: 3, quote: 300, fee: 0.03, moeda: "USDT" });
    const r = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-1", {
      cumulativeQty: 5, avgPrice: 100, cumulativeQuote: 500,
      fee: 0.05, feeCurrency: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toMatch(/fee_currency incompativel/i);
    expect(b.fills).toHaveLength(1);
    expect(feeTotal(b)).toBeCloseTo(0.03, 12);
  });

  it("caminho feliz null+null: livro todo sem moeda, snapshot sem fee ⇒ sem exceção, fee null", async () => {
    const b = bancoFalso();
    await comIntent(b);
    const semMoeda = (qty: number, quote: number) =>
      ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-1", {
        cumulativeQty: qty, avgPrice: quote / qty, cumulativeQuote: quote,
        fee: null, feeCurrency: null,
      });
    expect((await semMoeda(3, 300)).ok).toBe(true);
    expect((await semMoeda(5, 500)).ok).toBe(true);
    expect(b.intents[0].fee_total).toBeNull();
    expect(Number(b.intents[0].filled_qty)).toBe(5);
  });
});

describe("④ guarda estrutural — a 0059 é lida de verdade", () => {  it("⚠️ o parser achou as duas funções — vazio aprovaria tudo", () => {
    expect(SQL_0059).toMatch(
      /create\s+or\s+replace\s+function\s+public\.cex_ingest_order_snapshot\(/i);
    expect(SQL_0059).toMatch(
      /create\s+or\s+replace\s+function\s+public\.cex_ingest_trades\(/i);
  });

  it("⚠️⚠️ a fee é gravada como DELTA por mesma moeda, nunca o cumulativo inteiro", () => {
    expect(SQL_0059).toMatch(/greatest\(p_fee - v_fee_ja, 0\)/);
    // ⚠️ A base do delta é o LIVRO INTEIRO da ordem (reais + sintéticos) na
    // mesma moeda — filtrar `sintetico` aqui regravava a fee cumulativa
    // inteira depois da substituição synthetic→real (achado 1, round 3).
    const iInicio = SQL_0059.indexOf("sum(f.fee)");
    expect(iInicio).toBeGreaterThan(-1);
    const bloco = SQL_0059.slice(iInicio, SQL_0059.indexOf("v_fee_delta :=", iInicio));
    expect(bloco).toMatch(/f\.fee_currency is not distinct from p_fee_currency/);
    expect(bloco).not.toMatch(/sintetico/);
  });

  it("a dedupe key passa a incluir o fee (replay idêntico é no-op, correção entra)", () => {
    expect(SQL_0059).toMatch(/'ordercum:'[\s\S]{0,160}p_fee::text/);
  });

  it("⚠️ moeda de fee incompatível é raise exception — fail-closed, e o NULL também fecha", () => {
    expect(SQL_0059).toMatch(/raise exception 'fee_currency incompativel/);
    // CCXT traz `cost` sem `currency`: a guarda dispara com o snapshot
    // trazendo fee e o livro divergindo — `is distinct from` cobre
    // null↔'USDT' nos dois sentidos (achado 2, round 3).
    expect(SQL_0059).toMatch(/p_fee is not null or p_fee_currency is not null/);
    expect(SQL_0059).toMatch(/f\.fee_currency is distinct from p_fee_currency/);
  });

  it("o ajuste de fee com qty parada é um fill de qty ZERO e quote zero", () => {
    // A constraint original (qty > 0) impediria o ajuste; a 0059 a relaxa
    // SÓ para quote zero.
    expect(SQL_0059).toMatch(/drop constraint if exists cex_fills_qty_check/);
    expect(SQL_0059).toMatch(/check \(qty > 0 or \(qty = 0 and quote_amount = 0\)\)/);
    expect(SQL_0059).toMatch(/0, v_preco, 0, v_fee_delta/);
  });

  it("⚠️⚠️ a guarda de cobertura existe: lote parcial não deleta nem insere", () => {
    expect(SQL_0059).toMatch(/cobertura_incompleta/);
    expect(SQL_0059).toMatch(/v_real < v_sint - 1e-12/);
    // E o retorno ok:false vem ANTES do delete dos sintéticos.
    const iRetorno = SQL_0059.indexOf("'cobertura_incompleta'");
    const iDelete = SQL_0059.indexOf("delete from public.cex_fills",
      SQL_0059.indexOf("function public.cex_ingest_trades"));
    expect(iRetorno).toBeGreaterThan(-1);
    expect(iDelete).toBeGreaterThan(iRetorno);
  });

  it("⚠️ ACL repetida na 0059 (idempotente): REVOKE de public/anon/authenticated + GRANT service_role", () => {
    for (const nome of ["cex_ingest_trades", "cex_ingest_order_snapshot"]) {
      expect(SQL_0059).toMatch(new RegExp(
        `revoke\\s+execute\\s+on function public\\.${nome}\\([\\s\\S]*?\\)\\s*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, "i"));
      expect(SQL_0059).toMatch(new RegExp(
        `grant\\s+execute\\s+on function public\\.${nome}\\([\\s\\S]*?\\)\\s*to\\s+service_role`, "i"));
    }
  });

  it("o CATALOGO da guarda de ACL aponta as duas funções para a 0059", () => {
    const guarda = readFileSync("src/lib/cex/execucao/rpcs-acl.test.ts", "utf8");
    expect(guarda).toMatch(
      /cex_ingest_trades:\s*"0059_fee_cumulativa_e_cobertura\.sql"/);
    expect(guarda).toMatch(
      /cex_ingest_order_snapshot:\s*"0059_fee_cumulativa_e_cobertura\.sql"/);
  });
});
