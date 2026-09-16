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
 * A121 (round 4) corrige a guarda de cobertura: só os NOVOS trades únicos
 * provam o que veio depois do sintético (N≥S — o real anterior nunca cobre
 * sintético posterior), e a FEE do sintético também é coberta (fee null nos
 * novos → 'cobertura_fee_incompleta'; moeda divergente →
 * 'fee_currency_incompativel'; ambos ADIADOS, livro intacto).
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
    // ⚠️⚠️ A121: a cobertura é provada SÓ pelos NOVOS trades únicos (N≥S).
    // A fórmula R+N≥S (v_real = livro real + novos) permitia apagar um
    // sintético criado DEPOIS do real existente sem nenhum trade novo —
    // real 5, snapshot 8 → sint 3, lote só dedupado → 5≥3 → total 8→5.
    expect(SQL_0059).toMatch(/v_sint > 0 and v_novos < v_sint - 1e-12/);
    expect(SQL_0059).not.toMatch(/v_real/);
    // E o retorno ok:false vem ANTES do delete dos sintéticos.
    const iRetorno = SQL_0059.indexOf("'cobertura_incompleta'");
    const iDelete = SQL_0059.indexOf("delete from public.cex_fills",
      SQL_0059.indexOf("function public.cex_ingest_trades"));
    expect(iRetorno).toBeGreaterThan(-1);
    expect(iDelete).toBeGreaterThan(iRetorno);
  });

  it("⚠️⚠️ A121: a cobertura de FEE existe e os dois motivos novos vêm ANTES do delete", () => {
    const iFunc = SQL_0059.indexOf("function public.cex_ingest_trades");
    const iDelete = SQL_0059.indexOf("delete from public.cex_fills", iFunc);
    for (const motivo of ["'cobertura_fee_incompleta'", "'fee_currency_incompativel'"]) {
      const i = SQL_0059.indexOf(motivo, iFunc);
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(iDelete);   // atomicidade: valida antes de tocar o livro
    }
    // Fee null nos trades novos fecha a guarda; moeda divergente também
    // (`is not distinct from` — null é tratado explicitamente, nunca null=0).
    expect(SQL_0059).toMatch(/nullif\(t->>'fee',''\) is null/);
    expect(SQL_0059).toMatch(/m\.moeda is not distinct from n\.moeda/);
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

describe("⑤ A121 — cobertura provada SÓ pelos NOVOS trades únicos (N≥S) + cobertura de FEE", () => {
  /** Intent pós-envio com quantidade solicitada arbitrária. */
  async function comIntentQtd(b: ReturnType<typeof bancoFalso>, qtd: number,
                              estado: EstadoDoIntent = "SUBMITTED") {
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: qtd, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: estado,
    });
    return b.intents[0];
  }

  const T1 = { tradeId: "T1", qty: 2, price: 100, quote: 200, fee: 0.02, feeCurrency: "USDT" };
  const T2 = { tradeId: "T2", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" };

  it("⚠️⚠️⚠️ CENTRAL: real 5 + snapshot 8 (sintético 3), lote SÓ com trades antigos dedupados ⇒ ok:false, o total segue 8 — NUNCA 5", async () => {
    // O defeito medido na 0059 original: a fórmula R+N≥S somava o real
    // existente (ANTERIOR ao sintético) na cobertura — 5 ≥ 3 apagava os 3
    // sem nenhum trade novo, e o total caía de 8 para 5. Um fato sumia.
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const r1 = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    expect(r1.ok).toBe(true);                       // real 5 no livro
    const s = await snap(b, { qty: 8, quote: 800, fee: 0.08 });
    expect(s.ok).toBe(true);                        // sintético 3 DEPOIS do real
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    const ledgerAntes = JSON.stringify(b.fills);
    // O lote traz SÓ os trades antigos — dedupados, zero novidade.
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.porque).toBe("cobertura_incompleta");
      expect(r.adiado).toBe(true);
    }
    // Ledger intacto BYTE-A-BYTE e o sintético continua valendo.
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(b.fills.some((f) => f.sintetico)).toBe(true);
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);
  });

  it("cobertura N=3: lote com antigos dedupados + 3 NOVOS ⇒ sintético cede, real 8, replay não muda", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    await snap(b, { qty: 8, quote: 800, fee: 0.08 });
    // Os novos únicos (T3+T4 = 3) cobrem o sintético (3); os antigos não
    // entram na conta — entram por dedupe no insert, sem somar.
    const lote = [T1, T2,
      { tradeId: "T3", qty: 1, price: 100, quote: 100, fee: 0.01, feeCurrency: "USDT" },
      { tradeId: "T4", qty: 2, price: 100, quote: 200, fee: 0.02, feeCurrency: "USDT" }];
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", lote);
    expect(r.ok).toBe(true);
    expect(b.fills).toHaveLength(4);
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);   // 0.05 dos antigos + 0.03 dos novos
    const ledgerAntes = JSON.stringify(b.fills);
    const replay = await ingerirTrades(b.cliente, "i-fee", "ORD-1", lote);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.inseridos).toBe(0);
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);
  });

  it("⚠️⚠️ sintético com fee 0.05 USDT + trades novos com fee NULL ⇒ cobertura_fee_incompleta, ledger intacto byte-a-byte", async () => {
    // A qty cobre (5 ≥ 5), mas o sintético sabe a fee e os trades novos não
    // a trazem — substituir APAGARIA o fato. Null nunca é zero: é adiado.
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const fillsAntes = JSON.stringify(b.fills);
    const intentAntes = JSON.stringify(b.intents[0]);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1",
      [{ tradeId: "T9", qty: 5, price: 100, quote: 500, fee: null, feeCurrency: null }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.porque).toBe("cobertura_fee_incompleta");
      expect(r.adiado).toBe(true);
    }
    expect(JSON.stringify(b.fills)).toBe(fillsAntes);
    expect(JSON.stringify(b.intents[0])).toBe(intentAntes);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
  });

  it("fee MENOR mas explícita e completa (0.048 < 0.05) ⇒ substitui — o real é fato", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1",
      [{ tradeId: "T9", qty: 5, price: 100, quote: 500, fee: 0.048, feeCurrency: "USDT" }]);
    expect(r.ok).toBe(true);
    expect(b.fills).toHaveLength(1);
    expect(b.fills[0].sintetico).toBe(false);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
    expect(feeTotal(b)).toBeCloseTo(0.048, 12);   // não 0.05, não 0.098
  });

  it("⚠️⚠️ fee em MOEDA DIFERENTE (sintético USDT, trade BNB) ⇒ fee_currency_incompativel, ledger intacto", async () => {
    // Converter exigiria um preço inventado — proibido. Adiado, não soma.
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const ledgerAntes = JSON.stringify(b.fills);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1",
      [{ tradeId: "T9", qty: 5, price: 100, quote: 500, fee: 0.05, feeCurrency: "BNB" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.porque).toBe("fee_currency_incompativel");
      expect(r.adiado).toBe(true);
    }
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
  });

  it("sintético SEM fee: trades novos sem fee não destroem informação — substitui", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await snap(b, { qty: 5, quote: 500, fee: null, moeda: null });
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1",
      [{ tradeId: "T9", qty: 5, price: 100, quote: 500, fee: null, feeCurrency: null }]);
    expect(r.ok).toBe(true);
    expect(b.intents[0].fee_total).toBeNull();
    expect(Number(b.intents[0].filled_qty)).toBe(5);
  });

  it("⚠️⚠️ multi-ordem: o real da ordem A NUNCA cobre o sintético da ordem B", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    // Ordem B primeiro: livro vazio, acumulado 3 → sintético 3 EM B.
    const sb = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-B", {
      cumulativeQty: 3, avgPrice: 100, cumulativeQuote: 300,
      fee: null, feeCurrency: null,
    });
    expect(sb.ok).toBe(true);
    // Ordem A: 5 reais no livro.
    const ra = await ingerirTrades(b.cliente, "i-fee", "ORD-A", [T1, T2]);
    expect(ra.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    // Lote da ordem B com SÓ os trades dedupados da A: nada novo para B.
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-B", [T1, T2]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toBe("cobertura_incompleta");
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(b.fills.filter((f) => f.external_order_id === "ORD-B")).toHaveLength(1);
    // E quando os trades novos de B chegam, só o sintético de B cede.
    const r2 = await ingerirTrades(b.cliente, "i-fee", "ORD-B",
      [{ tradeId: "TB1", qty: 3, price: 100, quote: 300, fee: null, feeCurrency: null }]);
    expect(r2.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    expect(b.fills.filter((f) => f.external_order_id === "ORD-A")).toHaveLength(2);
  });

  it("snapshot DEPOIS do real vira sintético do DELTA (real 5 → snapshot 8 ⇒ sint 3, fee 0.03)", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    const s = await snap(b, { qty: 8, quote: 800, fee: 0.08 });
    expect(s.ok).toBe(true);
    expect(b.fills).toHaveLength(3);
    const sint = b.fills.find((f) => f.sintetico);
    expect(sint).toBeDefined();
    expect(Number(sint!.qty)).toBe(3);
    expect(Number(sint!.fee)).toBeCloseTo(0.03, 12);   // delta: 0.08 - 0.05
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);
  });

  it("real DEPOIS de múltiplos snapshots: 3/0.03 → 5/0.05 → 8/0.08, trades 8 cobrem tudo", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await snap(b, { qty: 3, quote: 300, fee: 0.03 });
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    await snap(b, { qty: 8, quote: 800, fee: 0.08 });
    expect(b.fills).toHaveLength(3);
    expect(b.fills.every((f) => f.sintetico)).toBe(true);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [
      T1, T2,
      { tradeId: "T3", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" },
    ]);
    expect(r.ok).toBe(true);
    expect(b.fills).toHaveLength(3);
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);
    // Replay do lote inteiro: nada muda.
    const ledgerAntes = JSON.stringify(b.fills);
    await ingerirTrades(b.cliente, "i-fee", "ORD-1", [
      T1, T2,
      { tradeId: "T3", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" },
    ]);
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
  });

  it("⚠️ o reconciliador trata os NOVOS motivos como ADIADO, como cobertura_incompleta", async () => {
    const cenario = async (trade: { fee: number | null; feeCurrency: string | null }) => {
      const b = bancoFalso();
      await b.cliente.from("cex_execution_intents").insert({
        id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
        order_type: "market", requested_qty: 10, client_order_id: "zsFEE",
        origin: "dca_cron", autonomous: true, state: "UNKNOWN",
        external_order_id: "ORD-1",
      });
      await snap(b, { qty: 5, quote: 500, fee: 0.05 });
      expect(b.intents[0].state).toBe("PARTIALLY_FILLED");
      const leitura: LeituraDaOrdem = { tipo: "so_trades", trades: [
        { tradeId: "T1", orderId: "ORD-1", qty: 5, price: 100, quote: 500,
          fee: trade.fee, feeCurrency: trade.feeCurrency, executedAt: null },
      ] };
      const r = await reconciliarIntent({
        db: b.cliente, credenciais: async () => ({ apiKey: "k", apiSecret: "s" }),
        ler: vi.fn(async () => leitura),
      }, b.intents[0] as unknown as IntentRow);
      // Adiado: segue em dúvida NO MESMO ESTADO, ledger e fee intactos.
      expect(r.desfecho).toBe("segue_em_duvida");
      expect(b.intents[0].state).toBe("PARTIALLY_FILLED");
      expect(b.fills).toHaveLength(1);
      expect(b.fills[0].sintetico).toBe(true);
      expect(feeTotal(b)).toBeCloseTo(0.05, 12);
    };
    await cenario({ fee: null, feeCurrency: null });        // cobertura_fee_incompleta
    await cenario({ fee: 0.05, feeCurrency: "BNB" });       // fee_currency_incompativel
  });
});

describe("⑥ A121 round 4 (revisão) — os 4 achados na cex_ingest_trades", () => {
  async function comIntentQtd(b: ReturnType<typeof bancoFalso>, qtd: number,
                              estado: EstadoDoIntent = "SUBMITTED") {
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: qtd, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: estado,
    });
    return b.intents[0];
  }

  const T1 = { tradeId: "T1", qty: 2, price: 100, quote: 200, fee: 0.02, feeCurrency: "USDT" };
  const T2 = { tradeId: "T2", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" };

  it("⚠️⚠️⚠️ ACHADO 1: ajuste de fee qty-ZERO (v_sint=0) NÃO é apagado por lote dedupado — fee_total fica em 0.07", async () => {
    // O cenário medido pelo revisor: snapshot 5/0.05 → trades completos →
    // corretora corrige a fee → snapshot 5/0.07 cria ajuste qty=0 fee 0.02 →
    // o reconciliador ingere os MESMOS trades (dedupados). Antes: v_sint=0
    // pulava as guardas e o delete apagava o ajuste — 0.07 → 0.05.
    const b = bancoFalso();
    await comIntentQtd(b, 5);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    expect((await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2])).ok).toBe(true);
    const ajuste = await snap(b, { qty: 5, quote: 500, fee: 0.07 });
    expect(ajuste.ok).toBe(true);
    const ajusteFill = b.fills.find((f) => f.sintetico && Number(f.qty) === 0);
    expect(ajusteFill).toBeDefined();
    expect(Number(ajusteFill!.fee)).toBeCloseTo(0.02, 12);
    expect(feeTotal(b)).toBeCloseTo(0.07, 12);
    const ledgerAntes = JSON.stringify(b.fills);
    // O lote dedupado NÃO é evidência substituta: adiado, NADA deleta/insere.
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.porque).toBe("cobertura_fee_incompleta");
      expect(r.adiado).toBe(true);
    }
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(feeTotal(b)).toBeCloseTo(0.07, 12);   // nunca 0.05
  });

  it("ACHADO 1 (outro lado): evidência substituta EXPLÍCITA libera a substituição, inclusive o ajuste zero-qty", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    await snap(b, { qty: 5, quote: 500, fee: 0.07 });       // ajuste qty=0 fee 0.02
    expect(feeTotal(b)).toBeCloseTo(0.07, 12);
    // Trade NOVO único com fee explícita na mesma moeda: o real é fato e
    // substitui — o ajuste zero-qty cede junto.
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2,
      { tradeId: "T3", qty: 1, price: 100, quote: 100, fee: 0.01, feeCurrency: "USDT" }]);
    expect(r.ok).toBe(true);
    expect(b.fills).toHaveLength(3);
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(6);
    expect(feeTotal(b)).toBeCloseTo(0.06, 12);   // 0.02+0.03+0.01: o real é fato
  });

  it("⚠️⚠️⚠️ ACHADO 2: ACK sem id → sintético NULL 5 → trades com ORD-1 ⇒ real 5, sintético 0, filled 5 (NUNCA 10)", async () => {
    // O sintético gravado com external_order_id NULL nunca entrava em v_sint
    // nem no delete quando os trades chegavam com o id descoberto — o null
    // (5) + o real (5) double-countavam. Agora o não-atribuído do MESMO
    // intent é atribuído pela ingestão que traz o id.
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const s = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", null, {
      cumulativeQty: 5, avgPrice: 100, cumulativeQuote: 500,
      fee: 0.05, feeCurrency: "USDT",
    });
    expect(s.ok).toBe(true);
    expect(b.fills[0].external_order_id).toBeNull();
    expect(b.intents[0].external_order_id).toBeNull();
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    expect(r.ok).toBe(true);
    expect(b.fills).toHaveLength(2);                        // o null CEDE
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    expect(b.fills.every((f) => f.external_order_id === "ORD-1")).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(5);        // NUNCA 10
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
    expect(b.intents[0].external_order_id).toBe("ORD-1");
  });

  it("ACHADO 2 (fronteira): sintético de OUTRA ordem continua fora — ordem A nunca cobre B", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const sa = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-A", {
      cumulativeQty: 5, avgPrice: 100, cumulativeQuote: 500,
      fee: 0.05, feeCurrency: "USDT",
    });
    expect(sa.ok).toBe(true);
    // Trades de ORD-1: não tocam o sintético de ORD-A (não é NULL, é outra).
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    expect(r.ok).toBe(true);
    expect(b.fills.filter((f) => f.external_order_id === "ORD-A"
                              && f.sintetico)).toHaveLength(1);
    expect(b.fills.filter((f) => f.external_order_id === "ORD-1"
                              && !f.sintetico)).toHaveLength(2);
    expect(Number(b.intents[0].filled_qty)).toBe(10);   // 5 sint A + 5 real ORD-1
  });

  it("⚠️⚠️ ACHADO 3: fee '' (string vazia) é SEM fee — cobertura_fee_incompleta, como o nullif do SQL", async () => {
    // O banco-falso aceitava "" (`t.fee == null` falso) e substituía apagando
    // a fee conhecida; o SQL (`nullif(t->>'fee','') is null`) recusa. Um
    // teste não pode aprovar o que o banco recusa — alinhados.
    const b = bancoFalso();
    await comIntentQtd(b, 5);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    const ledgerAntes = JSON.stringify(b.fills);
    const r = await b.cliente.rpc("cex_ingest_trades", {
      p_intent_id: "i-fee", p_external_order_id: "ORD-1",
      p_trades: [{ trade_id: "T9", qty: 5, price: 100, quote: 500,
                   fee: "", fee_currency: "USDT", executed_at: null }],
    });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ ok: false, porque: "cobertura_fee_incompleta" });
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
    // E fee não-numérica é tratada igual ("sem fee"), não como fee válida.
    const r2 = await b.cliente.rpc("cex_ingest_trades", {
      p_intent_id: "i-fee", p_external_order_id: "ORD-1",
      p_trades: [{ trade_id: "T9", qty: 5, price: 100, quote: 500,
                   fee: "abc", fee_currency: "USDT", executed_at: null }],
    });
    expect(r2.data).toMatchObject({ ok: false, porque: "cobertura_fee_incompleta" });
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
  });

  it("ACHADO 3 (paridade no insert): sintético SEM fee + trade com fee '' ⇒ substitui e grava fee NULL (nullif)", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await snap(b, { qty: 5, quote: 500, fee: null, moeda: null });
    const r = await b.cliente.rpc("cex_ingest_trades", {
      p_intent_id: "i-fee", p_external_order_id: "ORD-1",
      p_trades: [{ trade_id: "T9", qty: 5, price: 100, quote: 500,
                   fee: "", fee_currency: "", executed_at: null }],
    });
    expect(r.data).toMatchObject({ ok: true, inseridos: 1 });
    expect(b.fills).toHaveLength(1);
    expect(b.fills[0].sintetico).toBe(false);
    expect(b.fills[0].fee).toBeNull();
    expect(b.fills[0].fee_currency).toBeNull();
    expect(b.intents[0].fee_total).toBeNull();
  });

  it("⚠️⚠️ ACHADO 4: lote multi-ordem — só os trades DESTA ordem entram e contam; o de outra ordem é ignorado", async () => {
    // Defesa em profundidade no nível da RPC: sem o filtro, o trade de
    // ORD-A cobriria o sintético de ORD-B e seria carimbado com ORD-B.
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const sb = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-B", {
      cumulativeQty: 3, avgPrice: 100, cumulativeQuote: 300,
      fee: null, feeCurrency: null,
    });
    expect(sb.ok).toBe(true);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-B", [
      { tradeId: "TB1", qty: 3, price: 100, quote: 300, fee: null, feeCurrency: null,
        orderId: "ORD-B" },
      { tradeId: "TX9", qty: 9, price: 100, quote: 900, fee: null, feeCurrency: null,
        orderId: "ORD-A" },   // de OUTRA ordem: ignorado, não conta, não entra
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inseridos).toBe(1);
    expect(b.fills.some((f) => f.external_trade_id === "TX9")).toBe(false);
    const real = b.fills.find((f) => f.external_trade_id === "TB1");
    expect(real).toBeDefined();
    expect(real!.external_order_id).toBe("ORD-B");
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(3);        // nunca 12
  });

  it("ACHADO 4 (fronteira): lote SÓ com trades de outra ordem ⇒ v_novos = 0 → cobertura_incompleta, ledger intacto", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-B", {
      cumulativeQty: 3, avgPrice: 100, cumulativeQuote: 300,
      fee: null, feeCurrency: null,
    });
    const ledgerAntes = JSON.stringify(b.fills);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-B", [
      { tradeId: "TX9", qty: 9, price: 100, quote: 900, fee: null, feeCurrency: null,
        orderId: "ORD-A" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toBe("cobertura_incompleta");
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(3);
  });

  it("⚠️ guarda estrutural: a 0059 carrega as 4 correções do round 4", () => {
    const iFunc = SQL_0059.indexOf("function public.cex_ingest_trades");
    const iFim = SQL_0059.indexOf("revoke execute on function public.cex_ingest_trades", iFunc);
    expect(iFunc).toBeGreaterThan(-1);
    expect(iFim).toBeGreaterThan(iFunc);
    const corpo = SQL_0059.slice(iFunc, iFim);
    // (1) o gate de fee NÃO é mais condicionado a v_sint > 0, e recusa quando
    // não há NENHUM trade novo único (sem evidência substituta explícita).
    expect(corpo).not.toMatch(/v_sint\s*>\s*0\s+and\s+exists/);
    expect(corpo).toMatch(/v_qtd_novos\s*=\s*0\s+or\s+exists/);
    // (2) sintéticos não atribuídos (external_order_id NULL) entram em v_sint,
    // no gate de fee e no delete — os de outra ordem, nunca.
    expect(corpo.match(/or\s+(f\.)?external_order_id is null/g)?.length)
      .toBeGreaterThanOrEqual(4);
    // (4) itens de outra ordem são ignorados ANTES de tudo, e o insert itera
    // o lote FILTRADO — p_trades cru é lido uma única vez (na filtragem).
    expect(corpo).toMatch(
      /u\.t->>'order' is null or u\.t->>'order' = p_external_order_id/);
    expect(corpo.match(/jsonb_array_elements\(coalesce\(p_trades/g)).toHaveLength(1);
    expect(corpo).toMatch(/for v_t in select \* from jsonb_array_elements\(v_lote\)/);
  });
});

describe("⑦ brecha do verificador (round 4) — o SNAPSHOT enxerga o sintético NULL na base de fee/moeda", () => {
  // A base de qty (`v_ja`) já era do intent inteiro, mas a base de fee
  // (`v_fee_ja`) e a guarda de moeda filtravam só `is not distinct from` e
  // ficavam CEGAS ao sintético com external_order_id NULL do mesmo intent
  // (ACK sem id). A correção espelha o achado 2 na cex_ingest_order_snapshot:
  // predicado "não atribuído" = `is not distinct from` OU `is null`.
  const snapNull = (b: ReturnType<typeof bancoFalso>, qty: number,
                    quote: number, fee: number | null, moeda: string | null) =>
    ingerirSnapshotDaOrdem(b.cliente, "i-fee", null, {
      cumulativeQty: qty, avgPrice: qty > 0 ? quote / qty : 0,
      cumulativeQuote: quote, fee, feeCurrency: moeda,
    });

  it("⚠️⚠️⚠️ NULL 5/0.05 → snapshot ORD-1 5/0.05 ⇒ ZERO inserções, fee_total 0.05 (NUNCA 0.10)", async () => {
    // O cenário medido: qty parada, mas v_fee_ja=0 (cego ao NULL) inseria um
    // ajuste zero-qty de 0.05 — fee_total fechava 0.10.
    const b = bancoFalso();
    await comIntent(b);
    const s0 = await snapNull(b, 5, 500, 0.05, "USDT");
    expect(s0.ok).toBe(true);
    expect(b.fills[0].external_order_id).toBeNull();
    const r = await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inseridos).toBe(0);          // nenhum ajuste zero-qty
    expect(b.fills).toHaveLength(1);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);      // NUNCA 0.10
  });

  it("⚠️⚠️⚠️ NULL 5/0.05 → snapshot ORD-1 8/0.08 ⇒ qty 8, fee_total 0.08 (NUNCA 0.13)", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snapNull(b, 5, 500, 0.05, "USDT");
    const r = await snap(b, { qty: 8, quote: 800, fee: 0.08 });
    expect(r.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    // O delta de fee enxerga os 0.05 do sintético NULL: entra 0.03, não 0.08.
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);      // NUNCA 0.13
    const delta = b.fills.find((f) => f.external_order_id === "ORD-1");
    expect(delta).toBeDefined();
    expect(Number(delta!.fee)).toBeCloseTo(0.03, 12);
  });

  it("⚠️⚠️ sintético NULL USDT + snapshot ORD-1 BNB ⇒ EXCEÇÃO fee_currency_incompativel (fail-closed)", async () => {
    const b = bancoFalso();
    await comIntent(b);
    await snapNull(b, 5, 500, 0.05, "USDT");
    const ledgerAntes = JSON.stringify(b.fills);
    const r = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-1", {
      cumulativeQty: 8, avgPrice: 100, cumulativeQuote: 800,
      fee: 0.08, feeCurrency: "BNB",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toMatch(/fee_currency incompativel/i);
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);
  });

  it("⚠️ regressão multi-ordem: sintético de ORD-A NÃO entra na base de fee de ORD-B", async () => {
    // NULL é "não atribuído"; ordem nomeada de OUTRA ordem segue fora — se
    // ORD-A entrasse na base de ORD-B, o delta seria 0.03 e o total 0.08.
    const b = bancoFalso();
    await comIntent(b);
    const sa = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-A", {
      cumulativeQty: 5, avgPrice: 100, cumulativeQuote: 500,
      fee: 0.05, feeCurrency: "USDT",
    });
    expect(sa.ok).toBe(true);
    const r = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-B", {
      cumulativeQty: 8, avgPrice: 100, cumulativeQuote: 800,
      fee: 0.08, feeCurrency: "USDT",
    });
    expect(r.ok).toBe(true);
    const deltaB = b.fills.find((f) => f.external_order_id === "ORD-B");
    expect(deltaB).toBeDefined();
    expect(Number(deltaB!.fee)).toBeCloseTo(0.08, 12);   // inteiro, não 0.03
    expect(feeTotal(b)).toBeCloseTo(0.13, 12);           // 0.05 (A) + 0.08 (B)
  });

  it("⚠️ guarda estrutural: `or ... is null` na base de fee E na guarda de moeda da função SNAPSHOT na 0059", () => {
    const iFunc = SQL_0059.indexOf("function public.cex_ingest_order_snapshot");
    const iFim = SQL_0059.indexOf("end; $$;", iFunc);
    expect(iFunc).toBeGreaterThan(-1);
    expect(iFim).toBeGreaterThan(iFunc);
    const corpo = SQL_0059.slice(iFunc, iFim);
    const pred = /or\s+f\.external_order_id is null/;
    // Guarda de moeda (select count(*) ... fee_currency is distinct from).
    const iGuarda = corpo.indexOf("into v_incomp, v_moeda_livro");
    expect(iGuarda).toBeGreaterThan(-1);
    expect(pred.test(corpo.slice(iGuarda, iGuarda + 400))).toBe(true);
    // Base do delta de fee (sum(f.fee) into v_fee_ja).
    const iFee = corpo.indexOf("sum(f.fee)");
    expect(iFee).toBeGreaterThan(-1);
    expect(pred.test(corpo.slice(iFee, iFee + 400))).toBe(true);
    // E a base de qty/quote segue INTENT-WIDE (sem filtro de ordem).
    expect(corpo).toMatch(
      /into v_ja, v_quote from public\.cex_fills where intent_id = p_intent_id;/);
  });
});

/**
 * A122 (round 5) — DUPLICATA DE trade_id DENTRO DO MESMO LOTE.
 *
 * O NOT EXISTS da cobertura só olhava fills PERSISTIDOS: duas cópias do
 * MESMO trade_id no mesmo lote somavam 2× em v_novos, mas colidiam na dedupe
 * key na inserção e entravam 1× — a cobertura era enganada e o livro
 * regredia (real 5, sintético 3, lote [T9 1.5, T9 1.5] → 8 virava 6.5).
 *
 * A regra (ordem obrigatória do §26): LOTE BRUTO → valida ids
 * ('trade_sem_id') → filtro de ordem → dedupe intra-lote por trade_id
 * (payload idêntico conta UMA vez; divergente é 'trade_id_conflitante',
 * fail-closed, livro byte-a-byte intacto) → remove persistidos → N →
 * coberturas de qty/fee sobre o lote NORMALIZADO → delete → insert → recalc.
 */
describe("⑧ A122 — duplicata intra-lote NÃO engana a cobertura", () => {
  /** Intent pós-envio com quantidade solicitada arbitrária. */
  async function comIntentQtd(b: ReturnType<typeof bancoFalso>, qtd: number) {
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: qtd, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: "SUBMITTED",
    });
    return b.intents[0];
  }
  const T1 = { tradeId: "T1", qty: 2, price: 100, quote: 200, fee: 0.02, feeCurrency: "USDT" };
  const T2 = { tradeId: "T2", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" };
  /** Real 5 no livro + snapshot 8 ⇒ sintético 3 com fee 0.03. */
  async function real5Sint3(b: ReturnType<typeof bancoFalso>) {
    await comIntentQtd(b, 8);
    const r1 = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    expect(r1.ok).toBe(true);
    const s = await snap(b, { qty: 8, quote: 800, fee: 0.08 });
    expect(s.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(b.fills).toHaveLength(3);
  }

  it("⚠️⚠️⚠️ CENTRAL: real 5, sint 3, lote [T9 1.5, T9 1.5] ⇒ N=1.5 < 3 → cobertura_incompleta, o livro segue 8 — NUNCA 6.5", async () => {
    // O defeito medido: N=3 (2×1.5) ≥ 3 liberava a substituição, o T9
    // colidia na dedupe e entrava uma vez — o livro caía de 8 para 6.5.
    const b = bancoFalso();
    await real5Sint3(b);
    const ledgerAntes = JSON.stringify(b.fills);
    const intentAntes = JSON.stringify(b.intents[0]);
    const copia = { tradeId: "T9", qty: 1.5, price: 100, quote: 150,
                    fee: 0.015, feeCurrency: "USDT" };
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [copia, { ...copia }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.porque).toBe("cobertura_incompleta");
      expect(r.adiado).toBe(true);
    }
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(JSON.stringify(b.intents[0])).toBe(intentAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(8);        // NUNCA 6.5
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);
    // E a resposta crua do banco confessa N=1.5, não 3.
    const cru = await b.cliente.rpc("cex_ingest_trades", {
      p_intent_id: "i-fee", p_external_order_id: "ORD-1",
      p_trades: [{ trade_id: "T9", qty: 1.5, price: 100, quote: 150,
                   fee: 0.015, fee_currency: "USDT", executed_at: null, order: null },
                 { trade_id: "T9", qty: 1.5, price: 100, quote: 150,
                   fee: 0.015, fee_currency: "USDT", executed_at: null, order: null }],
    });
    expect(cru.error).toBeNull();
    const d = cru.data as { ok: boolean; porque: string; novos: number; sintetico: number };
    expect(d.ok).toBe(false);
    expect(d.porque).toBe("cobertura_incompleta");
    expect(Number(d.novos)).toBeCloseTo(1.5, 12);           // NUNCA 3
    expect(Number(d.sintetico)).toBeCloseTo(3, 12);
  });

  it("⚠️⚠️ [T9 3, T9 3] IDÊNTICOS cobrem o sintético 3: real 8, T9 UMA vez, replay estável", async () => {
    const b = bancoFalso();
    await real5Sint3(b);
    const copia = { tradeId: "T9", qty: 3, price: 100, quote: 300,
                    fee: 0.03, feeCurrency: "USDT" };
    const lote = [copia, { ...copia }];
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", lote);
    expect(r.ok).toBe(true);
    expect(b.fills).toHaveLength(3);                        // T1, T2, T9
    expect(b.fills.filter((f) => f.external_trade_id === "T9")).toHaveLength(1);
    expect(b.fills.every((f) => f.sintetico === false)).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(8);        // NUNCA 11 nem 6.5
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);              // NUNCA 0.11
    const ledgerAntes = JSON.stringify(b.fills);
    const replay = await ingerirTrades(b.cliente, "i-fee", "ORD-1", lote);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.inseridos).toBe(0);
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
  });

  it("payload idêntico com escala numérica diferente (1.5 ≡ 1.50) NÃO é conflito", async () => {
    // A comparação é NUMÉRICA, como o `is distinct from` do SQL: a mesma
    // quantidade com outra serialização é o mesmo fato, não duas versões.
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const cru = await b.cliente.rpc("cex_ingest_trades", {
      p_intent_id: "i-fee", p_external_order_id: "ORD-1",
      p_trades: [{ trade_id: "T9", qty: 1.5, price: 100, quote: 150,
                   fee: 0.02, fee_currency: "USDT", executed_at: null, order: null },
                 { trade_id: "T9", qty: "1.50", price: "100.0", quote: "150.00",
                   fee: "0.020", fee_currency: "USDT", executed_at: null, order: null }],
    });
    expect(cru.error).toBeNull();
    const d = cru.data as { ok: boolean; inseridos: number };
    expect(d.ok).toBe(true);
    expect(d.inseridos).toBe(1);
    expect(b.fills.filter((f) => f.external_trade_id === "T9")).toHaveLength(1);
    expect(Number(b.intents[0].filled_qty)).toBeCloseTo(1.5, 12);
  });

  it("TRÊS duplicatas idênticas contam UMA vez", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const copia = { tradeId: "T9", qty: 1, price: 100, quote: 100,
                    fee: 0.01, feeCurrency: "USDT" };
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1",
      [copia, { ...copia }, { ...copia }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inseridos).toBe(1);
    expect(b.fills).toHaveLength(1);
    expect(Number(b.intents[0].filled_qty)).toBe(1);
    expect(feeTotal(b)).toBeCloseTo(0.01, 12);              // NUNCA 0.03
  });

  it("lote PARCIALMENTE dedupado no banco: T1 já persistido, T9 novo duplicado ⇒ N=2 cobre o sint 2", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);   // real 5
    const s = await snap(b, { qty: 7, quote: 700, fee: 0.07 });   // sint 2, fee 0.02
    expect(s.ok).toBe(true);
    const copia = { tradeId: "T9", qty: 2, price: 100, quote: 200,
                    fee: 0.02, feeCurrency: "USDT" };
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, copia, { ...copia }]);
    expect(r.ok).toBe(true);
    expect(b.fills).toHaveLength(3);                        // T1, T2, T9
    expect(b.fills.filter((f) => f.external_trade_id === "T9")).toHaveLength(1);
    expect(Number(b.intents[0].filled_qty)).toBe(7);
    expect(feeTotal(b)).toBeCloseTo(0.07, 12);
  });

  it("lote TODO dedupado (sem sintético): replay é no-op, ledger intacto", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    const ledgerAntes = JSON.stringify(b.fills);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T1, T2]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inseridos).toBe(0);
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
  });
});

describe("⑨ A122 — duas cópias de T9 qty 3 fee 0.02 NUNCA viram 6/0.04", () => {
  async function comIntentQtd(b: ReturnType<typeof bancoFalso>, qtd: number) {
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: qtd, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: "SUBMITTED",
    });
    return b.intents[0];
  }
  const T9 = { tradeId: "T9", qty: 3, price: 100, quote: 300, fee: 0.02, feeCurrency: "USDT" };

  it("sem sintético: entra UMA vez — filled 3, fee_total 0.02, um fill", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [T9, { ...T9 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inseridos).toBe(1);
    expect(b.fills).toHaveLength(1);
    expect(Number(b.intents[0].filled_qty)).toBe(3);        // NUNCA 6
    expect(feeTotal(b)).toBeCloseTo(0.02, 12);              // NUNCA 0.04
  });

  it("sintético 5/0.05: N=3 < 5 → cobertura_incompleta, o banco confessa novos=3 (NUNCA 6)", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const s = await snap(b, { qty: 5, quote: 500, fee: 0.05 });
    expect(s.ok).toBe(true);
    const ledgerAntes = JSON.stringify(b.fills);
    const cru = await b.cliente.rpc("cex_ingest_trades", {
      p_intent_id: "i-fee", p_external_order_id: "ORD-1",
      p_trades: [{ trade_id: "T9", qty: 3, price: 100, quote: 300,
                   fee: 0.02, fee_currency: "USDT", executed_at: null, order: null },
                 { trade_id: "T9", qty: 3, price: 100, quote: 300,
                   fee: 0.02, fee_currency: "USDT", executed_at: null, order: null }],
    });
    expect(cru.error).toBeNull();
    const d = cru.data as { ok: boolean; porque: string; novos: number };
    expect(d.ok).toBe(false);
    expect(d.porque).toBe("cobertura_incompleta");
    expect(Number(d.novos)).toBeCloseTo(3, 12);             // NUNCA 6
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(feeTotal(b)).toBeCloseTo(0.05, 12);              // NUNCA 0.04/0.02
    expect(Number(b.intents[0].filled_qty)).toBe(5);
  });
});

describe("⑩ A122 — trade_id CONFLITANTE é fail-closed ('trade_id_conflitante')", () => {
  async function real5Sint3(b: ReturnType<typeof bancoFalso>) {
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: 8, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: "SUBMITTED",
    });
    await ingerirTrades(b.cliente, "i-fee", "ORD-1", [
      { tradeId: "T1", qty: 2, price: 100, quote: 200, fee: 0.02, feeCurrency: "USDT" },
      { tradeId: "T2", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" },
    ]);
    await snap(b, { qty: 8, quote: 800, fee: 0.08 });
  }

  it("⚠️⚠️ mesmo T9 com QTY divergente (3 vs 3.5): ZERO mudança, livro byte-a-byte intacto", async () => {
    // Duas versões do mesmo fato = leitura corrompida. Nunca escolher uma.
    const b = bancoFalso();
    await real5Sint3(b);
    const ledgerAntes = JSON.stringify(b.fills);
    const intentAntes = JSON.stringify(b.intents[0]);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [
      { tradeId: "T9", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" },
      { tradeId: "T9", qty: 3.5, price: 100, quote: 350, fee: 0.03, feeCurrency: "USDT" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.porque).toBe("trade_id_conflitante");
      expect(r.adiado).toBeFalsy();        // contradição não é página curta
    }
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(JSON.stringify(b.intents[0])).toBe(intentAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);
    expect(b.fills.some((f) => f.sintetico)).toBe(true);
  });

  it("⚠️⚠️ mesmo T9 com FEE divergente (0.03 vs 0.04): idem — nada é deletado nem inserido", async () => {
    const b = bancoFalso();
    await real5Sint3(b);
    const ledgerAntes = JSON.stringify(b.fills);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [
      { tradeId: "T9", qty: 3, price: 100, quote: 300, fee: 0.03, feeCurrency: "USDT" },
      { tradeId: "T9", qty: 3, price: 100, quote: 300, fee: 0.04, feeCurrency: "USDT" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toBe("trade_id_conflitante");
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    expect(feeTotal(b)).toBeCloseTo(0.08, 12);
  });

  it("executed_at divergente também é conflito; fee null vs '' NÃO é (política do R4)", async () => {
    const b = bancoFalso();
    await real5Sint3(b);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [
      { tradeId: "T9", qty: 3, price: 100, quote: 300, fee: 0.03,
        feeCurrency: "USDT", executedAt: "2025-01-01T00:00:00Z" },
      { tradeId: "T9", qty: 3, price: 100, quote: 300, fee: 0.03,
        feeCurrency: "USDT", executedAt: "2025-01-01T00:00:01Z" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toBe("trade_id_conflitante");
    expect(Number(b.intents[0].filled_qty)).toBe(8);
    // null e "" são a MESMA ausência (nullif do SQL) — uma cópia só. Banco
    // novo, sem sintético com fee, para isolar a comparação de payload.
    const b2 = bancoFalso();
    await b2.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: 8, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: "SUBMITTED",
    });
    const cru = await b2.cliente.rpc("cex_ingest_trades", {
      p_intent_id: "i-fee", p_external_order_id: "ORD-1",
      p_trades: [{ trade_id: "T8", qty: 3, price: 100, quote: 300,
                   fee: null, fee_currency: "", executed_at: "", order: null },
                 { trade_id: "T8", qty: 3, price: 100, quote: 300,
                   fee: "", fee_currency: null, executed_at: null, order: null }],
    });
    expect(cru.error).toBeNull();
    const d = cru.data as { ok: boolean; porque?: string; inseridos?: number };
    expect(d.ok).toBe(true);
    expect(d.inseridos).toBe(1);
    expect(b2.fills.filter((f) => f.external_trade_id === "T8")).toHaveLength(1);
  });
});

describe("⑪ A122 — trade SEM ID é recusado no LOTE BRUTO ('trade_sem_id')", () => {
  async function comIntentQtd(b: ReturnType<typeof bancoFalso>, qtd: number) {
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: qtd, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: "SUBMITTED",
    });
    return b.intents[0];
  }
  const rpcDireto = (b: ReturnType<typeof bancoFalso>, trades: unknown[]) =>
    b.cliente.rpc("cex_ingest_trades", {
      p_intent_id: "i-fee", p_external_order_id: "ORD-1", p_trades: trades });

  it("⚠️ item sem trade_id → ok:false 'trade_sem_id', zero delete/insert (antes de qualquer coverage)", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    await snap(b, { qty: 5, quote: 500, fee: 0.05 });       // sintético presente
    const ledgerAntes = JSON.stringify(b.fills);
    const cru = await rpcDireto(b, [
      { trade_id: "T9", qty: 5, price: 100, quote: 500,
        fee: 0.05, fee_currency: "USDT", executed_at: null, order: null },
      { qty: 5, price: 100, quote: 500, fee: 0.05,
        fee_currency: "USDT", executed_at: null, order: null },
    ]);
    expect(cru.error).toBeNull();
    const d = cru.data as { ok: boolean; porque: string };
    expect(d.ok).toBe(false);
    expect(d.porque).toBe("trade_sem_id");
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(Number(b.intents[0].filled_qty)).toBe(5);
  });

  it("⚠️ trade_id vazio ('') também é sem id — e vale para item de OUTRA ordem (lote bruto)", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const cru = await rpcDireto(b, [
      { trade_id: "T9", qty: 1, price: 100, quote: 100,
        fee: null, fee_currency: null, executed_at: null, order: null },
      { trade_id: "", qty: 1, price: 100, quote: 100, fee: null,
        fee_currency: null, executed_at: null, order: "ORD-OUTRA" },
    ]);
    expect(cru.error).toBeNull();
    const d = cru.data as { ok: boolean; porque: string };
    expect(d.ok).toBe(false);
    expect(d.porque).toBe("trade_sem_id");
    expect(b.fills).toHaveLength(0);                        // nem o T9 entrou
  });

  it("o caller (ingerirTrades) já recusa antes da RPC — defesa em profundidade coerente", async () => {
    const b = bancoFalso();
    await comIntentQtd(b, 8);
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-1", [
      { tradeId: "", qty: 1, price: 100, quote: 100, fee: null, feeCurrency: null },
    ]);
    expect(r.ok).toBe(false);
    expect(b.fills).toHaveLength(0);
  });
});

describe("⑫ A122 — guarda estrutural: a ordem obrigatória do §26 na 0059", () => {
  const iFunc = SQL_0059.indexOf("function public.cex_ingest_trades");
  const iFim = SQL_0059.indexOf("revoke execute on function public.cex_ingest_trades", iFunc);
  const corpo = SQL_0059.slice(iFunc, iFim);

  it("o parser recortou a função de verdade — vazio aprovaria tudo", () => {
    expect(iFunc).toBeGreaterThan(-1);
    expect(iFim).toBeGreaterThan(iFunc);
    expect(corpo).toContain("cex_ingest_trades");
    expect(corpo).toContain("cex_recalcular_intent");
  });

  it("⚠️⚠️ ORDEM: valida ids → filtro de ordem → dedupe intra-lote → conflito → N → coberturas → delete → insert → recalc", () => {
    const iScan = corpo.indexOf("into v_lote, v_sem_id");
    const iSemId = corpo.indexOf("'trade_sem_id'");
    const iFiltro = corpo.indexOf("filter (where u.t->>'order' is null");
    const iConflito = corpo.indexOf("'trade_id_conflitante'");
    const iDedupe = corpo.indexOf("distinct on (e.t->>'trade_id')");
    const iNovos = corpo.indexOf("into v_novos, v_qtd_novos");
    const iCobertura = corpo.indexOf("'cobertura_incompleta'");
    const iFee = corpo.indexOf("'cobertura_fee_incompleta'");
    const iDelete = corpo.indexOf("delete from public.cex_fills");
    const iInsert = corpo.indexOf("for v_t in select * from jsonb_array_elements(v_lote)");
    const iRecalc = corpo.lastIndexOf("perform public.cex_recalcular_intent");
    for (const [nome, pos] of Object.entries({ iScan, iSemId, iFiltro, iConflito,
        iDedupe, iNovos, iCobertura, iFee, iDelete, iInsert, iRecalc })) {
      expect(pos, `${nome} ausente do corpo`).toBeGreaterThan(-1);
    }
    // O scan único (valida ids + filtra) vem antes de TUDO; a recusa de id
    // sai antes de qualquer uso do lote.
    expect(iScan).toBeLessThan(iSemId);
    expect(iSemId).toBeLessThan(iConflito);
    expect(iFiltro).toBeLessThan(iConflito);
    // O conflito é detectado ANTES do dedupe normalizado, e ambos ANTES de N.
    expect(iConflito).toBeLessThan(iDedupe);
    expect(iDedupe).toBeLessThan(iNovos);
    // N alimenta a cobertura de qty, que vem antes da de fee, e ambas ANTES
    // de deletar/inserir — qualquer falha retorna com o livro intacto.
    expect(iNovos).toBeLessThan(iCobertura);
    expect(iCobertura).toBeLessThan(iFee);
    expect(iFee).toBeLessThan(iDelete);
    expect(iDelete).toBeLessThan(iInsert);
    expect(iInsert).toBeLessThan(iRecalc);
  });

  it("⚠️ a comparação de payload é NUMÉRICA com is distinct from, nullif de '' e order normalizado", () => {
    expect(corpo).toMatch(/\(a->>'qty'\)::numeric\s+is distinct from \(b->>'qty'\)::numeric/);
    expect(corpo).toMatch(/nullif\(a->>'fee',''\)::numeric\s+is distinct from nullif\(b->>'fee',''\)::numeric/);
    expect(corpo).toMatch(/nullif\(a->>'fee_currency',''\)\s+is distinct from nullif\(b->>'fee_currency',''\)/);
    expect(corpo).toMatch(/coalesce\(nullif\(a->>'order',''\), p_external_order_id\)/);
    expect(corpo).toMatch(/nullif\(a->>'executed_at',''\)\s+is distinct from nullif\(b->>'executed_at',''\)/);
  });

  it("⚠️ N, cobertura de fee e insert usam o lote NORMALIZADO (v_lote), nunca o bruto", () => {
    // Depois do dedupe, p_trades não é relido: o scan único é a única
    // leitura bruta (guarda da ⑥ já trava isso) e todo o resto é v_lote.
    const depois = corpo.slice(corpo.indexOf("distinct on (e.t->>'trade_id')"));
    expect(depois).not.toMatch(/jsonb_array_elements\(coalesce\(p_trades/);
    expect(corpo.match(/jsonb_array_elements\(v_lote\)/g)!.length)
      .toBeGreaterThanOrEqual(5);   // conflito(a+b), dedupe, N, fee×2, insert
  });

  it("os dois motivos novos voltam ANTES do delete — livro intacto na recusa", () => {
    const iDelete = corpo.indexOf("delete from public.cex_fills");
    expect(corpo.indexOf("'trade_sem_id'")).toBeLessThan(iDelete);
    expect(corpo.indexOf("'trade_id_conflitante'")).toBeLessThan(iDelete);
  });
});

/**
 * A123 (round 5) — DEDUPE DO LIVRO COM ESCOPO DE INTENT.
 *
 * A constraint era `unique (exchange_id, dedupe_key)` — GLOBAL na corretora.
 * Dois intents na mesma venue com o mesmo id de trade (ids não são
 * universalmente únicos: venues e símbolos diferentes colidem) faziam o
 * SEGUNDO fill legítimo sumir no `on conflict do nothing`. A 0062 troca para
 * `unique (intent_id, dedupe_key)`, a 0059 passa a usar `on conflict
 * (intent_id, dedupe_key)` e NOT EXISTS com intent_id, e o banco-falso
 * espelha. A COBERTURA synthetic→real NÃO muda de escopo (§27): segue por
 * (intent, ordem) — dedupe e cobertura são propriedades diferentes.
 */
describe("⑬ A123 — §16 cross-intent: o MESMO trade_id em DOIS intents persiste nos DOIS", () => {
  async function doisIntents(b: ReturnType<typeof bancoFalso>,
                             exchangeB = "binance", symbolB = "BTC/USDT") {
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-A", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: 8, client_order_id: "zsA",
      origin: "dca_cron", autonomous: true, state: "SUBMITTED",
    });
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-B", exchange_id: exchangeB, symbol: symbolB, side: "buy",
      order_type: "market", requested_qty: 8, client_order_id: "zsB",
      origin: "dca_cron", autonomous: true, state: "SUBMITTED",
    });
  }
  const T9 = { tradeId: "T9", qty: 3, price: 100, quote: 300, fee: 0.02, feeCurrency: "USDT" };

  it("⚠️⚠️⚠️ CENTRAL: A e B (mesma corretora) com o mesmo T9 ⇒ DUAS linhas, nenhuma some", async () => {
    // O defeito medido: a constraint (exchange_id, dedupe_key) fazia o fill
    // de B cair no on conflict do nothing — B ficava sem o fato dele.
    const b = bancoFalso();
    await doisIntents(b);
    const ra = await ingerirTrades(b.cliente, "i-A", "ORD-1", [T9]);
    const rb = await ingerirTrades(b.cliente, "i-B", "ORD-1", [T9]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (rb.ok) expect(rb.inseridos).toBe(1);        // NUNCA 0 (dedupe global)
    const deA = b.fills.filter((f) => f.intent_id === "i-A");
    const deB = b.fills.filter((f) => f.intent_id === "i-B");
    expect(deA).toHaveLength(1);
    expect(deB).toHaveLength(1);
    expect(b.fills).toHaveLength(2);
    expect(Number(b.intents.find((i) => i.id === "i-A")!.filled_qty)).toBe(3);
    expect(Number(b.intents.find((i) => i.id === "i-B")!.filled_qty)).toBe(3);
  });

  it("⚠️⚠️ §17 replay no MESMO intent continua no-op: UMA linha, inseridos 0", async () => {
    const b = bancoFalso();
    await doisIntents(b);
    await ingerirTrades(b.cliente, "i-A", "ORD-1", [T9]);
    await ingerirTrades(b.cliente, "i-B", "ORD-1", [T9]);
    const ledgerAntes = JSON.stringify(b.fills);
    const replay = await ingerirTrades(b.cliente, "i-A", "ORD-1", [T9]);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.inseridos).toBe(0);
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(b.fills.filter((f) => f.intent_id === "i-A")).toHaveLength(1);
    expect(b.fills).toHaveLength(2);
  });

  it("⚠️ §18 cross-symbol: BTC e ETH (mesma corretora) com o mesmo trade id ⇒ ambos persistem", async () => {
    const b = bancoFalso();
    await doisIntents(b, "binance", "ETH/USDT");
    const ra = await ingerirTrades(b.cliente, "i-A", "ORD-1", [T9]);
    const rb = await ingerirTrades(b.cliente, "i-B", "ORD-9", [T9]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    if (rb.ok) expect(rb.inseridos).toBe(1);
    expect(b.fills).toHaveLength(2);
    expect(b.fills.find((f) => f.intent_id === "i-B")!.symbol).toBe("ETH/USDT");
  });

  it("cross-exchange: binance e gateio com o mesmo trade id ⇒ ambos persistem", async () => {
    const b = bancoFalso();
    await doisIntents(b, "gateio", "BTC/USDT");
    const ra = await ingerirTrades(b.cliente, "i-A", "ORD-1", [T9]);
    const rb = await ingerirTrades(b.cliente, "i-B", "ORD-1", [T9]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(b.fills).toHaveLength(2);
    expect(b.fills.find((f) => f.intent_id === "i-B")!.exchange_id).toBe("gateio");
  });

  it("⚠️ snapshot/sintético também dedupa por INTENT: mesma chave ordercum em A e B ⇒ ambos persistem, replay em A é no-op", async () => {
    const b = bancoFalso();
    await doisIntents(b);
    const sa = await ingerirSnapshotDaOrdem(b.cliente, "i-A", "ORD-1", {
      cumulativeQty: 5, avgPrice: 100, cumulativeQuote: 500,
      fee: 0.05, feeCurrency: "USDT",
    });
    expect(sa.ok).toBe(true);
    // Mesma dedupe key 'ordercum:ORD-1:5:0.05', outro intent: TEM de entrar.
    const sb = await ingerirSnapshotDaOrdem(b.cliente, "i-B", "ORD-1", {
      cumulativeQty: 5, avgPrice: 100, cumulativeQuote: 500,
      fee: 0.05, feeCurrency: "USDT",
    });
    expect(sb.ok).toBe(true);
    expect(b.fills).toHaveLength(2);
    expect(b.fills.filter((f) => f.intent_id === "i-B")).toHaveLength(1);
    // Replay em A: a chave JÁ existe em A — no-op, nada muda.
    const ledgerAntes = JSON.stringify(b.fills);
    const replay = await ingerirSnapshotDaOrdem(b.cliente, "i-A", "ORD-1", {
      cumulativeQty: 5, avgPrice: 100, cumulativeQuote: 500,
      fee: 0.05, feeCurrency: "USDT",
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.inseridos).toBe(0);
    expect(JSON.stringify(b.fills)).toBe(ledgerAntes);
    expect(b.fills).toHaveLength(2);
  });
});

describe("⑭ A123 §27 — dedupe por intent, COBERTURA por ordem: propriedades diferentes", () => {
  it("⚠️⚠️ intent com ordens A e B: a cobertura de A NÃO usa B — o sintético de B sobrevive intacto", async () => {
    // Se a cobertura tivesse seguido o dedupe para o escopo do intent
    // inteiro, S seria 6 e o lote de A (3) seria adiado; ou pior, o delete
    // levaria o sintético de B junto. Nenhum dos dois pode acontecer.
    const b = bancoFalso();
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-fee", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      order_type: "market", requested_qty: 8, client_order_id: "zsFEE",
      origin: "dca_cron", autonomous: true, state: "SUBMITTED",
    });
    const sa = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-A", {
      cumulativeQty: 3, avgPrice: 100, cumulativeQuote: 300,
      fee: null, feeCurrency: null,
    });
    expect(sa.ok).toBe(true);
    const sb = await ingerirSnapshotDaOrdem(b.cliente, "i-fee", "ORD-B", {
      // O snapshot é CUMULATIVO do intent: o livro já tem 3 (ordem A), então
      // 6 aqui grava o DELTA 3 como sintético da ordem B.
      cumulativeQty: 6, avgPrice: 100, cumulativeQuote: 600,
      fee: null, feeCurrency: null,
    });
    expect(sb.ok).toBe(true);
    expect(Number(b.intents[0].filled_qty)).toBe(6);
    // Trades da ordem A (N=3) cobrem SÓ o sintético de A (3): substituição
    // fecha e o sintético de B NÃO é tocado.
    const r = await ingerirTrades(b.cliente, "i-fee", "ORD-A", [
      { tradeId: "TA1", qty: 3, price: 100, quote: 300, fee: null, feeCurrency: null },
    ]);
    expect(r.ok).toBe(true);
    expect(b.fills).toHaveLength(2);
    const deA = b.fills.filter((f) => f.external_order_id === "ORD-A");
    const deB = b.fills.filter((f) => f.external_order_id === "ORD-B");
    expect(deA).toHaveLength(1);
    expect(deA[0].sintetico).toBe(false);
    expect(deB).toHaveLength(1);
    expect(deB[0].sintetico).toBe(true);            // B intacto
    expect(Number(deB[0].qty)).toBe(3);
    expect(Number(b.intents[0].filled_qty)).toBe(6);
    // E a cobertura de B continua exigindo os NOVOS trades de B: replay do
    // trade de A contra B é N=0 < 3 → adiado, B segue intacto.
    const r2 = await ingerirTrades(b.cliente, "i-fee", "ORD-B", [
      { tradeId: "TA1", qty: 3, price: 100, quote: 300, fee: null, feeCurrency: null },
    ]);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.porque).toBe("cobertura_incompleta");
    expect(b.fills.filter((f) => f.external_order_id === "ORD-B")).toHaveLength(1);
    expect(Number(b.intents[0].filled_qty)).toBe(6);
  });
});

describe("⑮ A123 — guarda estrutural: 0062 drop+create, 0059 sem dedupe por exchange, espelho no banco-falso", () => {
  const SQL_0062 = readFileSync(
    "supabase/migrations/0062_fills_dedupe_por_intent.sql", "utf8");
  const FONTE_FALSO = readFileSync(
    "src/lib/cex/execucao/banco-falso.ts", "utf8");

  it("⚠️⚠️ a 0062 derruba a constraint global e cria a por intent — nela, não em outro lugar", () => {
    expect(SQL_0062).toMatch(
      /alter table public\.cex_fills drop constraint cex_fills_dedupe;/);
    expect(SQL_0062).toMatch(
      /add constraint cex_fills_intent_dedupe unique \(intent_id, dedupe_key\);/);
    // O drop vem ANTES do add (a janela sem constraint é intra-transação).
    expect(SQL_0062.indexOf("drop constraint cex_fills_dedupe"))
      .toBeLessThan(SQL_0062.indexOf("add constraint cex_fills_intent_dedupe"));
    // Segura com dados: NENHUM delete/update de fills na migration.
    expect(SQL_0062).not.toMatch(/delete\s+from\s+public\.cex_fills/i);
    expect(SQL_0062).not.toMatch(/update\s+public\.cex_fills/i);
    // Sem definer nova — a guarda de ACL (rpcs-acl) não ganha função.
    // (Comentários fora: o cabeçalho menciona a ausência de definer.)
    const semComentario = SQL_0062.split("\n")
      .filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(semComentario).not.toMatch(/security\s+definer/i);
    expect(semComentario).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
  });

  it("⚠️⚠️ a 0059 NÃO tem `on conflict (exchange_id, dedupe_key)` residual — só (intent_id, dedupe_key)", () => {
    expect(SQL_0059).not.toMatch(/on conflict \(exchange_id, dedupe_key\)/);
    expect(SQL_0059.match(/on conflict \(intent_id, dedupe_key\) do nothing;/g))
      .toHaveLength(3);   // snapshot ajuste + snapshot delta + trades
  });

  it("⚠️⚠️ TODO NOT EXISTS de dedupe de trade na 0059 filtra por intent_id", () => {
    const iFunc = SQL_0059.indexOf("function public.cex_ingest_trades");
    const iFim = SQL_0059.indexOf("revoke execute on function public.cex_ingest_trades", iFunc);
    const corpo = SQL_0059.slice(iFunc, iFim);
    const dedupes = corpo.match(
      /not exists \(select 1 from public\.cex_fills f\s+where f\.intent_id = p_intent_id\s+and f\.dedupe_key = 'trade:'/g);
    expect(dedupes).toHaveLength(3);   // N, gate de fee, CTE de moedas
    expect(corpo).not.toMatch(
      /not exists \(select 1 from public\.cex_fills f\s+where f\.exchange_id/);
  });

  it("⚠️ a cobertura NÃO seguiu o dedupe para o intent inteiro (§27): somas seguem por ordem", () => {
    const iFunc = SQL_0059.indexOf("function public.cex_ingest_trades");
    const iFim = SQL_0059.indexOf("revoke execute on function public.cex_ingest_trades", iFunc);
    const corpo = SQL_0059.slice(iFunc, iFim);
    // v_sint e o gate de fee continuam por (intent, ordem is not distinct
    // from, null não-atribuído) — o escopo do DEDUPE não contaminou a
    // COBERTURA.
    expect(corpo).toMatch(
      /select coalesce\(sum\(qty\),0\) into v_sint from public\.cex_fills\s+where intent_id = p_intent_id and sintetico\s+and \(external_order_id is not distinct from p_external_order_id/);
  });

  it("⚠️ o banco-falso espelha o escopo novo: dedupe por intent nos TRÊS pontos, sem exchange residual", () => {
    expect(FONTE_FALSO.match(/f\.intent_id === it\.id\s*&&\s*f\.dedupe_key/g)?.length)
      .toBeGreaterThanOrEqual(3);   // snapshot (ordercum), jaExiste, insert
    expect(FONTE_FALSO).not.toMatch(/exchange_id === it\.exchange_id && f\.dedupe_key/);
  });
});
