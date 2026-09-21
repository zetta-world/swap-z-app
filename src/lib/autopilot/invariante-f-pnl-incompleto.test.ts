/**
 * ⚠️⚠️⚠️ INVARIANTE F — P&L INCOMPLETO NÃO AUTORIZA ENTRADA.
 *
 * `autopilot_taxa_do_intent_em_usd` devolve NULL quando a taxa está numa moeda
 * que não dá para precificar sem inventar cotação. A política do A140 é não
 * inventar, e ela está certa. O que estava errado era o que vinha depois:
 *
 *     v_taxa_opaca := true;
 *     v_taxa_total := v_e.fee_aplicada_usd;     -- na prática, ZERO
 *     realizado    := recebido − custo − 0
 *
 * e o número entrava em `pnl_today` como se fosse exato. A bandeira subia, um
 * evento saía — e o cron seguia para a seção de entrada e COMPRAVA. Para um
 * autopilot real isso é FAIL-OPEN: o stop de perda diária passa a frear com um
 * prejuízo menor que o verdadeiro.
 *
 * ⚠️ O FATO FINANCEIRO É PRESERVADO. A venda aconteceu, a posição reduziu, o
 * custo saiu, o P&L parcial entrou. O que deixa de ser afirmado é que aquele
 * número está COMPLETO — e por isso ele deixa de autorizar risco novo.
 *
 * ⚠️⚠️ E O BLOQUEIO É DURÁVEL. Uma bandeira da passada do cron não alcança o
 * navegador, que fala com a MESMA sessão pela `/api/cex/order`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";
import { ingerirSnapshotDaOrdem } from "@/lib/cex/execucao/intents";
import { relerBandeirasDaSessao } from "@/lib/autopilot/sessions";
import { assentarELiquidarSaida } from "@/lib/autopilot/assentamento-da-saida";
import { reservarVendaDoBot } from "@/lib/autopilot/reserva-de-inventario";
import {
  entradaAutorizadaNaSessao, avaliarAutorizacaoDaSessaoParaExecucao,
} from "@/lib/autopilot/autorizacao-de-execucao";

const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const CRON = semComentarios(readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));
const ROTA = semComentarios(readFileSync("src/app/api/cex/order/route.ts", "utf8"));

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
  banco.sessoes.push({ id: "S1", wallet_address: "0xF", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: -49, daily_loss_stop_usd: 50,
    frozen_until_day: null, quarentena_em: null,
    contabilidade_incompleta_em: null, ...over });
}
function posicao(over: Record<string, unknown> = {}) {
  banco.posicoes.push({ id: `pos-${banco.posicoes.length + 1}`, session_id: "S1",
    wallet_address: "0xF", exchange_id: "binance", base: "BTC", pair: "BTC/USDT",
    entry_price: 10_000, base_amount: 0.01, cost_usd: 100, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null, ...over });
}
function intent(id: string, over: Record<string, unknown> = {}): string {
  banco.intents.push({ id, client_order_id: `c-${id}`, wallet_address: "0xF",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    fee_total: null, fee_currency: null, canceled_qty: 0, conexao_id: "C1",
    external_order_id: null, ...over });
  return id;
}
const hojeUtc = () => new Date().toISOString().slice(0, 10);
const aSessao = () => banco.sessoes.find((s) => s.id === "S1")!;
const oEfeito = (id: string) => banco.efeitos.find((e) => e.intent_id === id);
const oIntent = (id: string) => banco.intents.find((i) => i.id === id)!;

/** O portão que os DOIS canais chamam, alimentado pela linha da sessão. */
const portao = () => entradaAutorizadaNaSessao({
  emQuarentena: Boolean(aSessao().quarentena_em),
  contabilidadeIncompleta: Boolean(aSessao().contabilidade_incompleta_em),
});

beforeEach(() => { banco = bancoFalso(); });

describe("F.1 — taxa não precificável marca a sessão e fecha a COMPRA", () => {
  /**
   * `DOGE` não é estável nem é a base do par `BTC/USDT`: não há como
   * precificá-la em USD sem inventar cotação. É o caso real de quem paga taxa
   * num token de desconto da corretora.
   */
  it("⚠️⚠️⚠️ O CENÁRIO DO BRIEFING: P&L exato não é afirmado, e ZERO compra nova", async () => {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });

    // Antes: a sessão compra normalmente.
    expect(portao().ok).toBe(true);

    const r = await assentarELiquidarSaida("i1", "ORD-1", {
      filled: 0.01, cost: 100, average: 10_000,
      fee: { cost: 30, currency: "DOGE" },
    }, 0.01, deps());
    expect(r.ok, r.ok ? "" : `${r.etapa}/${r.motivo}: ${r.porque}`).toBe(true);
    if (!r.ok) return;

    // ⚠️ O FATO FINANCEIRO FOI PRESERVADO: a venda entrou, o custo saiu.
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(100, 10);
    expect(Number(oIntent("i1").fee_total)).toBeCloseTo(30, 10);
    expect(r.resultado.custoRemovido).toBeCloseTo(100, 10);
    // ⚠️ E O NÚMERO NÃO É AFIRMADO COMO EXATO.
    expect(r.resultado.taxaNaoPrecificada).toBe(true);

    // ⚠️⚠️ O BLOQUEIO É DURÁVEL — está na LINHA, não numa variável da passada.
    expect(oEfeito("i1")!.taxa_opaca).toBe(true);
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();

    // ⚠️⚠️⚠️ ZERO COMPRA NOVA, pelo portão que cron e navegador compartilham.
    const p = portao();
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.motivo).toBe("contabilidade_incompleta");
  });

  it("⚠️⚠️ SAÍDAS e RECOVERY seguem liberados — o freio é só de entrada", async () => {
    sessao();
    posicao({ base_amount: 0.02, cost_usd: 200 });
    intent("i1", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: 30, fee_currency: "DOGE" });
    const proj = await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    expect(proj.ok && proj.taxaNaoPrecificada).toBe(true);
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();
    expect(portao().ok).toBe(false);

    // ⚠️ A VENDA do que restou continua podendo ser reservada: trancar o
    // cliente numa posição por causa de uma taxa opaca trocaria um risco por
    // outro maior.
    intent("i2", { side: "sell" });
    const venda = await reservarVendaDoBot("i2", 0.01, { chamarRpc: chamar });
    expect(venda.ok).toBe(true);

    // ⚠️ E o RECOVERY (projeção de um fill atrasado) também roda.
    intent("i3", { side: "sell", state: "FILLED", filled_qty: 0.005,
      filled_quote: 60, fee_total: 1, fee_currency: "USDT" });
    const recovery = await projetarEfeitoDoIntent("i3", { chamarRpc: chamar });
    expect(recovery.ok && recovery.motivo).toBe("aplicado");
  });

  it("⚠️⚠️ a COMPRA com taxa opaca NÃO trava a sessão", async () => {
    /**
     * A taxa que o P&L realizado precisa é a da VENDA. A de uma compra não
     * entra em `cost_usd` nem na conta do dia — travar por causa dela seria
     * fail-closed sobre um fato que não corrompe número nenhum, e o
     * fail-closed honesto é o que protege o número que existe.
     */
    sessao();
    intent("c1", { side: "buy", order_type: "market", state: "FILLED",
      filled_qty: 0.01, filled_quote: 600, fee_total: 30, fee_currency: "DOGE" });
    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok && r.motivo).toBe("aplicado");
    expect(r.ok && r.taxaNaoPrecificada).toBe(true);
    expect(oEfeito("c1")!.taxa_opaca).toBe(false);
    expect(aSessao().contabilidade_incompleta_em).toBe(null);
    expect(portao().ok).toBe(true);
  });
});

describe("F.0 — `NULL` não é taxa zero (patch final do item 11)", () => {
  /**
   * ⚠️⚠️⚠️ A ÚLTIMA LINHA QUE JUNTAVA DUAS COISAS DIFERENTES.
   *
   *     when p_fee is null or p_fee <= 0 then 0
   *
   * `p_fee = 0` é uma taxa CONHECIDA e nula. `p_fee IS NULL` é uma taxa AINDA
   * NÃO CONHECIDA — a corretora não reportou. Devolver zero para o segundo é
   * a regra nº 33 desta casa violada no ponto mais caro: "não medimos"
   * virando "medimos zero" DENTRO do número que alimenta o stop de perda.
   *
   * A 0059 preserva a semântica certa do outro lado (fee null não inventa
   * fee). Quem a perdia era esta conversão — a última coisa que o P&L
   * realizado lê.
   */
  it("⚠️⚠️⚠️ O CENÁRIO DO PATCH: SELL com `fee_total` NULL não afirma P&L e prende a COMPRA", async () => {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });
    expect(portao().ok).toBe(true);

    // A venue informa quantidade e recebido, e NÃO informa a taxa.
    const r = await assentarELiquidarSaida("i1", "ORD-1",
      { filled: 0.01, cost: 100, average: 10_000 }, 0.01, deps());
    expect(r.ok, r.ok ? "" : `${r.etapa}/${r.motivo}: ${r.porque}`).toBe(true);
    if (!r.ok) return;

    /**
     * ⚠️⚠️⚠️ O PORTÃO PRIMEIRO, de propósito. É ele que decide se sai dinheiro
     * novo, e é ele que a quebra deliberada abre — a detecção tem de falar
     * disso, não de uma bandeira intermediária.
     */
    const p = portao();
    expect(p.ok, "com a taxa AUSENTE o portao de entrada NAO pode abrir").toBe(false);
    if (!p.ok) expect(p.motivo).toBe("contabilidade_incompleta");
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();
    expect(oEfeito("i1")!.taxa_opaca).toBe(true);

    // ⚠️ O livro tem quantidade e recebido; a taxa segue AUSENTE, não zero.
    expect(Number(oIntent("i1").filled_qty)).toBeCloseTo(0.01, 12);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(100, 10);
    expect(oIntent("i1").fee_total).toBe(null);

    // ⚠️⚠️ E O P&L EXATO NÃO É AFIRMADO. Antes do patch isto valia 0 e era
    // tratado como número final: 100 − 100 − 0.
    expect(r.resultado.taxaNaoPrecificada).toBe(true);
    expect(Number(aSessao().pnl_today)).toBe(-49);
    expect(aSessao().frozen_until_day).toBe(null);
  });

  it("⚠️⚠️⚠️ a taxa chega (2 USDT): delta −2, dia −51, freeze, bandeira limpa", async () => {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });
    await assentarELiquidarSaida("i1", "ORD-1",
      { filled: 0.01, cost: 100, average: 10_000 }, 0.01, deps());
    expect(portao().ok).toBe(false);

    // ⚠️ PELA MESMA INGESTÃO de sempre — a taxa nunca é escrita à mão.
    const ing = await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 10_000, cumulativeQuote: 100,
      fee: 2, feeCurrency: "USDT", executedAt: null });
    expect(ing.ok, ing.ok ? "" : ing.porque).toBe(true);
    expect(Number(oIntent("i1").fee_total)).toBeCloseTo(2, 10);

    const tardio = await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    expect(tardio.ok).toBe(true);
    if (!tardio.ok) return;
    expect(tardio.taxaNaoPrecificada).toBe(false);
    // 100 recebidos − 100 de custo − 2 de taxa = −2.
    expect(tardio.realizado).toBeCloseTo(-2, 10);
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);
    expect(aSessao().frozen_until_day).toBe(hojeUtc());

    expect(oEfeito("i1")!.taxa_opaca).toBe(false);
    expect(aSessao().contabilidade_incompleta_em).toBe(null);
    /**
     * ⚠️⚠️ A ENTRADA CONTINUA PRESA — agora pelo STOP DE PERDA, que é o
     * certo. A diferença entre os dois freios é o ponto inteiro do achado:
     * um é "não sei o número", o outro é "sei o número e ele diz pare".
     */
    expect(portao().ok).toBe(true);
    const congelada = avaliarAutorizacaoDaSessaoParaExecucao({
      ativa: true, expiraEm: new Date(Date.now() + 3_600_000).toISOString(),
      congeladaAte: aSessao().frozen_until_day as string | null,
      tradesHoje: 0, maxTradesPorDia: 5, maxTradeUsd: 1_000,
      conexaoId: "C1", emQuarentena: false, contabilidadeIncompleta: false,
    });
    expect(congelada.ok).toBe(false);
    if (!congelada.ok) expect(congelada.motivo).toBe("sessao_congelada");
  });

  it("⚠️⚠️ replay depois da taxa: ZERO P&L adicional", async () => {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });
    await assentarELiquidarSaida("i1", "ORD-1",
      { filled: 0.01, cost: 100, average: 10_000 }, 0.01, deps());
    await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 10_000, cumulativeQuote: 100,
      fee: 2, feeCurrency: "USDT", executedAt: null });
    await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);

    for (let i = 0; i < 3; i++) {
      const r = await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
      expect(r.ok && r.realizado).toBe(0);
    }
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);
    expect(aSessao().contabilidade_incompleta_em).toBe(null);
  });

  it("⚠️⚠️ taxa CONHECIDA e nula continua valendo ZERO — não é o mesmo fato", async () => {
    /**
     * A regra tem dois lados. `null` fecha; `0` explícito NÃO pode fechar,
     * senão o conserto viraria um freio permanente sobre um fato completo.
     * A conversão é exercitada direto porque `cex_recalcular_intent` colapsa
     * `sum(fee) = 0` em NULL — ver a limitação declarada na entrega.
     */
    const zero = await chamar("autopilot_taxa_do_intent_em_usd", {
      p_fee: 0, p_moeda: "USDT", p_symbol: "BTC/USDT",
      p_filled_qty: 0.01, p_filled_quote: 100 });
    expect(zero).toBe(0);

    const ausente = await chamar("autopilot_taxa_do_intent_em_usd", {
      p_fee: null, p_moeda: null, p_symbol: "BTC/USDT",
      p_filled_qty: 0.01, p_filled_quote: 100 });
    expect(ausente).toBe(null);

    const opaca = await chamar("autopilot_taxa_do_intent_em_usd", {
      p_fee: 30, p_moeda: "DOGE", p_symbol: "BTC/USDT",
      p_filled_qty: 0.01, p_filled_quote: 100 });
    expect(opaca).toBe(null);

    const estavel = await chamar("autopilot_taxa_do_intent_em_usd", {
      p_fee: 2, p_moeda: "USDT", p_symbol: "BTC/USDT",
      p_filled_qty: 0.01, p_filled_quote: 100 });
    expect(estavel).toBe(2);
  });

  it("⚠️ o SQL separa os dois casos em linhas diferentes", () => {
    /**
     * ⚠️ O CORPO, não o comentário. A cicatriz cita a linha antiga por
     * extenso — medir o arquivo inteiro faria a trava acusar a própria
     * documentação do conserto.
     */
    const i = SQL.indexOf("create or replace function public.autopilot_taxa_do_intent_em_usd");
    expect(i).toBeGreaterThan(-1);
    const corpo = SQL.slice(SQL.indexOf("language sql immutable as $$", i),
                            SQL.indexOf("$$;", i) + 3);
    expect(corpo).toMatch(/when p_fee is null then null/);
    expect(corpo).toMatch(/when p_fee <= 0 then 0/);
    // A linha que juntava os dois não pode voltar.
    expect(corpo).not.toMatch(/when p_fee is null or p_fee <= 0 then 0/);
  });
});

describe("F.1-BIS — custo removido SEM recebido também é conta aberta", () => {
  /**
   * ⚠️⚠️⚠️ ACHADO RODANDO A MATRIZ FINAL (item 11 — loss-stop verdadeiro).
   *
   * A venue responde `filled` e NÃO responde `cost` (é o caso que o A142 já
   * descreve por escrito). A liquidação reduz a posição, tira o custo do
   * livro, guarda em `custo_removido_usd` e — corretamente — NÃO inventa
   * resultado sem recebido. Só que nessa janela `pnl_today` não contém o
   * prejuízo de um trade JÁ FECHADO, e nada segurava a compra seguinte.
   *
   * Medido antes do conserto: sessão −49 com stop 50, base de custo 100 →
   * `pnl_today` seguia −49, `frozen_until_day` null, portão ABERTO.
   */
  it("⚠️⚠️⚠️ venda liquidada sem recebido: ZERO compra nova até o quote chegar", async () => {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });
    expect(portao().ok).toBe(true);

    /**
     * ⚠️ A TAXA AQUI É CONHECIDA (1 USDT) DE PROPÓSITO. É o que isola a
     * segunda causa: sem taxa opaca no caminho, o que sobra a prender a
     * compra é só o custo removido sem recebido.
     */
    const r = await assentarELiquidarSaida("i1", "ORD-1",
      { filled: 0.01, average: 10_000, fee: { cost: 1, currency: "USDT" } },
      0.01, deps());
    expect(r.ok, r.ok ? "" : `${r.etapa}/${r.motivo}: ${r.porque}`).toBe(true);
    if (!r.ok) return;

    // ⚠️ O custo SAIU do livro e o resultado ficou guardado — isto está certo.
    expect(r.resultado.custoRemovido).toBeCloseTo(100, 10);
    expect(r.resultado.realizado).toBe(0);
    expect(Number(oEfeito("i1")!.custo_removido_usd)).toBeCloseTo(100, 10);
    expect(Number(oEfeito("i1")!.applied_quote ?? 0)).toBe(0);
    // ⚠️ E a taxa NÃO é o motivo aqui: o buraco existe com a taxa conhecida.
    expect(r.resultado.taxaNaoPrecificada).toBe(false);
    expect(oEfeito("i1")!.taxa_opaca).toBe(false);

    // ⚠️⚠️ O dia ainda não contém aquele prejuízo...
    expect(Number(aSessao().pnl_today)).toBe(-49);
    expect(aSessao().frozen_until_day).toBe(null);
    // ⚠️⚠️⚠️ ...e é por isso que a COMPRA não passa.
    const p = portao();
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.motivo).toBe("contabilidade_incompleta");
  });

  it("⚠️⚠️ o recebido chega ⇒ o resultado entra E a sessão destrava", async () => {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });
    await assentarELiquidarSaida("i1", "ORD-1",
      { filled: 0.01, average: 10_000, fee: { cost: 1, currency: "USDT" } },
      0.01, deps());
    expect(portao().ok).toBe(false);

    /**
     * A passada seguinte pergunta de novo e a venue agora informa o custo —
     * PELA MESMA INGESTÃO de sempre, nunca escrevendo `filled_quote` à mão.
     * A posição já foi fechada por este intent: é o ramo `posicao_ja_encerrada`.
     */
    const ing = await ingerirSnapshotDaOrdem(banco.cliente, "i1", "ORD-1", {
      cumulativeQty: 0.01, avgPrice: 9_800, cumulativeQuote: 98,
      fee: 1, feeCurrency: "USDT", executedAt: null });
    expect(ing.ok, ing.ok ? "" : ing.porque).toBe(true);
    expect(Number(oIntent("i1").filled_quote)).toBeCloseTo(98, 10);

    const tardio = await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    expect(tardio.ok).toBe(true);
    if (!tardio.ok) return;

    // ⚠️ 98 recebidos − 100 de custo − 1 de taxa = −3; o dia vai de −49 a −52.
    expect(tardio.realizado).toBeCloseTo(-3, 10);
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-52, 10);
    expect(aSessao().frozen_until_day).toBe(hojeUtc());
    // ⚠️ A conta fechou: a bandeira de contabilidade some sozinha...
    expect(aSessao().contabilidade_incompleta_em).toBe(null);
    // ⚠️ ...e quem segura a compra agora é o STOP DE PERDA, que é o certo.
    expect(portao().ok).toBe(true);
  });

  it("⚠️⚠️ CR-1: compra com quantidade e SEM custo conhecido TRAVA", async () => {
    sessao();
    intent("c1", { side: "buy", order_type: "market", state: "FILLED",
      filled_qty: 0.01, filled_quote: 0 });
    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok && r.motivo).toBe("aplicado");
    /**
     * ⚠️⚠️ ESTE TESTE AFIRMAVA O CONTRÁRIO, e o retest independente mostrou
     * por quê isso era um buraco (CR-1): a compra entrou QUANTIDADE na
     * posição com `cost_usd` zero. O bot tem a bolsa e não sabe quanto pagou
     * — o teto de exposição conta menos capital do que existe, e o
     * compromisso da reserva desaba para zero. É contabilidade incompleta
     * pela mesma razão que a taxa desconhecida é.
     */
    expect(Number(oEfeito("c1")!.applied_qty ?? 0)).toBeGreaterThan(0);
    expect(Number(oEfeito("c1")!.applied_quote ?? 0)).toBe(0);
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();
    expect(portao().ok).toBe(false);
  });
});

describe("F.2 — a liberação é DETERMINÁVEL, não temporizada", () => {
  it("⚠️⚠️⚠️ taxa volta a ser precificável ⇒ a sessão destrava sozinha", async () => {
    sessao();
    posicao({ base_amount: 0.01, cost_usd: 100 });
    intent("i1", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: 30, fee_currency: "DOGE" });
    await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    expect(portao().ok).toBe(false);
    const desde = aSessao().contabilidade_incompleta_em;

    // Os trades reais chegam com a taxa em USDT — agora dá para precificar.
    Object.assign(oIntent("i1"), { fee_total: 2, fee_currency: "USDT" });
    const denovo = await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    expect(denovo.ok && denovo.taxaNaoPrecificada).toBe(false);

    expect(oEfeito("i1")!.taxa_opaca).toBe(false);
    expect(aSessao().contabilidade_incompleta_em).toBe(null);
    expect(portao().ok).toBe(true);
    expect(desde).toBeTruthy();
  });

  it("⚠️⚠️ UM intent destravado NÃO destrava a sessão se OUTRO segue opaco", async () => {
    /**
     * É por isso que a bandeira mora no EFEITO e a sessão é derivada. Uma
     * coluna só na sessão faria o conserto de um intent apagar o alarme do
     * outro — e o bot voltaria a comprar com a conta ainda incompleta.
     */
    sessao();
    posicao({ base_amount: 0.02, cost_usd: 200 });
    intent("i1", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: 30, fee_currency: "DOGE" });
    intent("i2", { side: "sell", state: "FILLED", filled_qty: 0.005,
      filled_quote: 60, fee_total: 10, fee_currency: "SHIB" });
    await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    await projetarEfeitoDoIntent("i2", { chamarRpc: chamar });
    expect(portao().ok).toBe(false);

    Object.assign(oIntent("i1"), { fee_total: 2, fee_currency: "USDT" });
    await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });

    expect(oEfeito("i1")!.taxa_opaca).toBe(false);
    expect(oEfeito("i2")!.taxa_opaca).toBe(true);
    // ⚠️ A sessão CONTINUA presa — e é o ponto.
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();
    expect(portao().ok).toBe(false);
  });

  it("⚠️ o instante original é preservado — a bandeira não se renova", async () => {
    sessao({ contabilidade_incompleta_em: "2026-01-01T00:00:00.000Z" });
    posicao({ base_amount: 0.02, cost_usd: 200 });
    intent("i1", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: 30, fee_currency: "DOGE" });
    await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    expect(aSessao().contabilidade_incompleta_em).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("F.2-BIS — a bandeira desta passada vale NESTA passada", () => {
  /**
   * ⚠️⚠️⚠️ ACHADO DA VERIFICAÇÃO ADVERSARIAL DO PATCH DA TAXA.
   *
   * O cron carrega a linha da sessão UMA vez, no começo da passada, e a
   * passada ESCREVE nela: `settleArmedExits` liquida a saída armada e a RPC
   * grava `contabilidade_incompleta_em`. O portão de entrada lia
   * `s.contabilidade_incompleta_em` da cópia em MEMÓRIA — o valor de ANTES.
   * A bandeira levantada nesta passada só começava a valer na seguinte, cinco
   * minutos depois, que é a cadência inteira de decisão do bot.
   *
   * O stop de perda já tinha contrapartida em memória por este mesmo motivo
   * (`pnlToday += settle.realizedDelta`). A contabilidade não tinha — e antes
   * do patch da conversão a leitura velha era inofensiva para este caso,
   * porque `p_fee is null` virava 0 e a bandeira nunca subia.
   */
  it("⚠️⚠️⚠️ o banco JÁ tem a bandeira no instante em que a liquidação retorna", async () => {
    sessao({ pnl_today: -49, daily_loss_stop_usd: 50 });
    intent("i1", { side: "sell", external_order_id: "ORD-1" });
    posicao({ base_amount: 0.01, cost_usd: 100, status: "exit_armed",
              exit_order_id: "ORD-1", exit_intent_id: "i1" });

    // A cópia que o cron carregou no começo da passada.
    const copiaDaPassada = { ...aSessao() };
    expect(copiaDaPassada.contabilidade_incompleta_em).toBe(null);

    await assentarELiquidarSaida("i1", "ORD-1",
      { filled: 0.01, cost: 100, average: 10_000 }, 0.01, deps());

    // ⚠️ A cópia em memória continua dizendo que está tudo bem...
    expect(copiaDaPassada.contabilidade_incompleta_em).toBe(null);
    // ⚠️ ...e a LINHA já diz o contrário. Decidir pela cópia é decidir pelo
    // passado, e é o que abria a compra na mesma passada.
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();
  });

  it("⚠️⚠️ o cron RELÊ a linha antes do portão, e falha de leitura FECHA", () => {
    // A releitura existe e acontece antes da decisão.
    expect(CRON).toMatch(/const fresco = await lerEstadoFinanceiroDaSessao\(s\.id\);/);
    const iRelu = CRON.indexOf("lerEstadoFinanceiroDaSessao(s.id)");
    const iPortao = CRON.indexOf("const portaoDeEntrada = entradaAutorizadaNaSessao({");
    expect(iRelu).toBeGreaterThan(-1);
    expect(iPortao).toBeGreaterThan(iRelu);
    /**
     * ⚠️⚠️ A leitura da sessão vem depois do RECOVERY global (que roda antes
     * do laço) — mas o settle acontece DENTRO da sessão, depois dela. Quem
     * cobre o que o settle escreve é o portão por COMPRA, que relê no
     * instante da decisão. É essa a ordem que importa.
     */
    const iSettle = CRON.indexOf("await settleArmedExits(");
    const iPorCompra = CRON.indexOf("autorizarAumentoDeExposicao(s.id)");
    expect(iSettle).toBeGreaterThan(-1);
    expect(iPorCompra, "o portão por COMPRA vem depois do settle")
      .toBeGreaterThan(iSettle);
    expect(CRON.indexOf("await pendenciasFinanceiras("))
      .toBeLessThan(iRelu);
    // ⚠️ Sem estado, a passada da sessão PARA — não se afirma limite nenhum.
    expect(CRON).toMatch(/if \(!fresco\) \{/);
    expect(CRON).toMatch(/recordEvent\("autopilot_estado_financeiro_ilegivel"/);
    // ⚠️ A cópia em memória não decide mais nada financeiro.
    expect(CRON).not.toMatch(/contabilidadeIncompleta: Boolean\(s\.contabilidade_incompleta_em\)/);
    expect(CRON).not.toMatch(/if \(s\.last_reset_day !== today\)/);
    /**
     * ⚠️⚠️ CR-3/CR-4: e o portão é REAVALIADO no instante de cada COMPRA,
     * não uma vez antes do laço de cartões.
     */
    expect(CRON).toMatch(/const risco = await autorizarAumentoDeExposicao\(s\.id\);/);
    expect(CRON.indexOf("autorizarAumentoDeExposicao(s.id)"))
      .toBeGreaterThan(CRON.indexOf("let entradasLiberadas"));
  });

  it("⚠️⚠️ a releitura é tri-state: erro de banco não vira 'sem bandeira'", async () => {
    sessao({ contabilidade_incompleta_em: "2026-01-01T00:00:00.000Z" });
    const boa = await relerBandeirasDaSessao("S1", { db: banco.cliente });
    expect(boa).toEqual({ quarentenaEm: null,
                          contabilidadeIncompletaEm: "2026-01-01T00:00:00.000Z" });

    banco.falhas.select = "connection reset by peer";
    expect(await relerBandeirasDaSessao("S1", { db: banco.cliente })).toBe(null);
    banco.falhas.select = undefined;
    // Sessão inexistente também é ausência de resposta, não ausência de bandeira.
    expect(await relerBandeirasDaSessao("NAO-EXISTE", { db: banco.cliente })).toBe(null);
  });
});

describe("F.4 — o registro não repete a confusão que o patch desfez", () => {
  it("⚠️⚠️ taxa NÃO MEDIDA não é gravada como `0` na moeda `?`", () => {
    for (const [nome, fonte] of [["cron", CRON], ["rota", ROTA]] as const) {
      // O padrão antigo punha zero e "?" numa taxa que ninguém mediu.
      expect(fonte, nome).not.toMatch(/moeda:[^,\n]*\?\?\s*"\?"/);
      expect(fonte, nome).not.toMatch(/valor:[^,\n]*\?\?\s*0\b/);
      // E o evento diz QUAL dos dois casos é.
      expect(fonte, nome).toMatch(/taxa_ausente/);
    }
  });
});

describe("F.3 — os DOIS canais, a MESMA coluna", () => {
  it("⚠️⚠️ quarentena e contabilidade incompleta são fatos DIFERENTES", () => {
    expect(entradaAutorizadaNaSessao({
      emQuarentena: true, contabilidadeIncompleta: false,
    })).toMatchObject({ ok: false, motivo: "sessao_em_quarentena" });
    expect(entradaAutorizadaNaSessao({
      emQuarentena: false, contabilidadeIncompleta: true,
    })).toMatchObject({ ok: false, motivo: "contabilidade_incompleta" });
    expect(entradaAutorizadaNaSessao({
      emQuarentena: false, contabilidadeIncompleta: false,
    })).toEqual({ ok: true });
  });

  it("⚠️⚠️⚠️ cron E navegador leem a MESMA coluna pelo MESMO portão", () => {
    /**
     * ⚠️ As duas leituras são FRESCAS, cada uma à sua maneira: a rota carrega
     * a sessão por requisição (`getSessionStatus`), e o cron RELÊ as bandeiras
     * depois do settle — porque a passada dele escreve nelas.
     */
    expect(ROTA).toMatch(
      /contabilidadeIncompleta: Boolean\([^)]*\.contabilidade_incompleta_em\)/);
    expect(CRON).toMatch(/lerEstadoFinanceiroDaSessao\(s\.id\)/);
    expect(CRON).toMatch(/contabilidadeIncompleta: Boolean\(fresco\.contabilidadeIncompletaEm\)/);
    // ⚠️ E a coluna é de fato uma das que a leitura autoritativa busca.
    const EST = readFileSync("src/lib/autopilot/estado-financeiro.ts", "utf8");
    expect(EST).toMatch(/contabilidade_incompleta_em/);
    expect(EST).toMatch(/quarentena_em/);
    // ⚠️ E nenhum dos dois decide isso por conta própria — a regra é uma só.
    expect(CRON).not.toMatch(/if \(s\.contabilidade_incompleta_em\)/);
    expect(ROTA).not.toMatch(/if \([^)]*\.contabilidade_incompleta_em\)/);
    // O cron avisa, porque o freio novo precisa aparecer no extrato.
    expect(CRON).toMatch(/recordEvent\("autopilot_contabilidade_incompleta"/);
  });

  it("⚠️ o SQL carrega as duas colunas, a função e a ACL", () => {
    expect(SQL).toMatch(/add column if not exists taxa_opaca boolean not null default false/);
    expect(SQL).toMatch(/add column if not exists contabilidade_incompleta_em timestamptz/);
    expect(SQL).toMatch(/create or replace function public\.autopilot_marcar_contabilidade/);
    expect(SQL).toMatch(
      /grant execute on function public\.autopilot_marcar_contabilidade\(uuid, uuid, boolean\)\s*\n\s*to service_role;/);
    // ⚠️ Chamada de DENTRO das duas RPCs, na mesma transação — nunca um
    // `update` solto depois (a cicatriz do A136).
    /**
     * ⚠️ O número cresceu no fechamento do CR-2: as recusas por divergência
     * também marcam agora. O que a trava fixa é a PROPRIEDADE — o marcador é
     * chamado de dentro das RPCs, em todo retorno que decide dinheiro, nunca
     * por um `update` solto depois (a cicatriz do A136).
     */
    expect([...SQL.matchAll(/perform public\.autopilot_marcar_contabilidade\(/g)].length)
      .toBeGreaterThanOrEqual(7);
    // ⚠️ CR-5: e o P&L tem UM escritor, com a virada do dia dentro dele.
    expect(SQL).toMatch(/create or replace function public\.autopilot_aplicar_pnl/);
    expect(SQL).toMatch(/last_reset_day = v_hoje,/);
    expect([...SQL.matchAll(/perform public\.autopilot_aplicar_pnl\(/g)].length)
      .toBeGreaterThanOrEqual(4);
    expect(SQL).not.toMatch(/set pnl_today\s+= pnl_today \+ v_realizado/);
    /**
     * ⚠️⚠️ OS DOIS MOTIVOS MORAM NUMA FUNÇÃO SÓ. Eles decidem o bloqueio da
     * sessão E a elegibilidade ao recovery financeiro; escrever a regra duas
     * vezes criaria o estado em que a sessão está presa e nada vai buscar o
     * que falta — a família do A113 no lugar mais caro.
     */
    expect(SQL).toMatch(
      /create or replace function public\.autopilot_efeito_incompleto/);
    expect(SQL).toMatch(/select coalesce\(p_taxa_opaca, false\)/);
    // CR-2: divergência registrada · CR-1: compra sem custo conhecido
    expect(SQL).toMatch(/nullif\(coalesce\(p_divergencia, ''\), ''\) is not null/);
    expect(SQL).toMatch(/p_side = 'buy'\s*\n\s*and coalesce\(p_applied_qty, 0\) > 0/);
    // E os DOIS consumidores chamam a mesma função, nunca uma cópia da regra.
    expect([...SQL.matchAll(/public\.autopilot_efeito_incompleto\(/g)].length)
      .toBeGreaterThanOrEqual(3);
    // ⚠️ E a taxa NÃO virou zero silencioso: a conversão continua devolvendo
    // NULL para moeda não precificável.
    expect(SQL).toMatch(/when p_moeda is null or p_moeda = '' then null/);
  });
});
