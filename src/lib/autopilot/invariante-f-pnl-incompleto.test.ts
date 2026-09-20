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
import { assentarELiquidarSaida } from "@/lib/autopilot/assentamento-da-saida";
import { reservarVendaDoBot } from "@/lib/autopilot/reserva-de-inventario";
import { entradaAutorizadaNaSessao } from "@/lib/autopilot/autorizacao-de-execucao";

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

    // ⚠️ A venue diz "preencheu 0,01" e não diz por quanto.
    const r = await assentarELiquidarSaida("i1", "ORD-1",
      { filled: 0.01, average: 10_000 }, 0.01, deps());
    expect(r.ok, r.ok ? "" : `${r.etapa}/${r.motivo}: ${r.porque}`).toBe(true);
    if (!r.ok) return;

    // ⚠️ O custo SAIU do livro e o resultado ficou guardado — isto está certo.
    expect(r.resultado.custoRemovido).toBeCloseTo(100, 10);
    expect(r.resultado.realizado).toBe(0);
    expect(Number(oEfeito("i1")!.custo_removido_usd)).toBeCloseTo(100, 10);
    // ⚠️ E a taxa NÃO é o motivo aqui: o buraco existe com taxa limpa.
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
    await assentarELiquidarSaida("i1", "ORD-1", { filled: 0.01, average: 10_000 }, 0.01, deps());
    expect(portao().ok).toBe(false);

    // A passada seguinte pergunta de novo e a venue agora informa o custo.
    // A posição já foi fechada por este intent — é o ramo `posicao_ja_encerrada`.
    Object.assign(oIntent("i1"), { filled_quote: 98 });
    const tardio = await projetarEfeitoDoIntent("i1", { chamarRpc: chamar });
    expect(tardio.ok).toBe(true);
    if (!tardio.ok) return;

    // ⚠️ 98 recebidos − 100 de custo = −2, e o dia passa de −49 para −51.
    expect(tardio.realizado).toBeCloseTo(-2, 10);
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);
    expect(aSessao().frozen_until_day).toBeTruthy();
    // ⚠️ A conta fechou: a bandeira de contabilidade some sozinha...
    expect(aSessao().contabilidade_incompleta_em).toBe(null);
    // ⚠️ ...e quem segura a compra agora é o STOP DE PERDA, que é o certo.
    expect(portao().ok).toBe(true);
  });

  it("⚠️ compra com custo e sem recebido NÃO trava — o lado é a venda", async () => {
    sessao();
    intent("c1", { side: "buy", order_type: "market", state: "FILLED",
      filled_qty: 0.01, filled_quote: 0 });
    const r = await projetarEfeitoDoIntent("c1", { chamarRpc: chamar });
    expect(r.ok && r.motivo).toBe("aplicado");
    // `custo_removido_usd` é zero numa compra — não há conta pendente.
    expect(Number(oEfeito("c1")!.custo_removido_usd ?? 0)).toBe(0);
    expect(aSessao().contabilidade_incompleta_em).toBe(null);
    expect(portao().ok).toBe(true);
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
    for (const [nome, fonte] of [["cron", CRON], ["rota", ROTA]] as const) {
      expect(fonte, nome).toMatch(
        /contabilidadeIncompleta: Boolean\([^)]*\.contabilidade_incompleta_em\)/);
    }
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
    expect([...SQL.matchAll(/perform public\.autopilot_marcar_contabilidade\(/g)])
      .toHaveLength(7);
    // ⚠️ Os DOIS motivos derivados das LINHAS, nunca de um sinal do caller.
    expect(SQL).toMatch(
      /e\.side = 'sell' and e\.custo_removido_usd > 0\s*\n\s*and e\.applied_quote <= 0/);
    // ⚠️ E a taxa NÃO virou zero silencioso: a conversão continua devolvendo
    // NULL para moeda não precificável.
    expect(SQL).toMatch(/when p_moeda is null or p_moeda = '' then null/);
  });
});
