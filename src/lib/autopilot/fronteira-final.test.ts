/**
 * ⚠️⚠️⚠️ A FRONTEIRA FINAL — o blocker que o retest independente deixou aberto.
 *
 * Depois de todas as correções anteriores, o precheck financeiro
 * (`autorizarAumentoDeExposicao`) lia o banco imediatamente antes das
 * reservas, nos dois canais. Mas a autorização FINAL —
 * `cex_autorizar_e_submeter`, a transação que vira RESERVED → SUBMITTING e é
 * o último ponto durável antes do `createOrder` — não conhecia o estado
 * financeiro. Entre o precheck e ela ainda cabia um writer comitando:
 *
 *     T0  precheck: pnl −49, sem freeze  → PASSA
 *     T1  recovery COMITA: pnl −51, freeze = hoje
 *     T2  cex_autorizar_e_submeter       ← não olhava nada disso
 *     T3  SUBMITTING
 *     T4  createOrder
 *
 * A janela era pequena. Pequena não é fechada: a propriedade que um autopilot
 * com dinheiro real precisa é categórica — se o loss-stop já foi atingido e
 * COMITADO antes da autorização final, nenhuma COMPRA nova sai.
 *
 * ⚠️ Os testes aqui medem a AUTORIZAÇÃO, não um texto: eles comitam a mudança
 * financeira depois do precheck e antes da chamada final, e exigem recusa.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { autorizarSubmissaoNoBanco } from "@/lib/cex/execucao/executor";
import { autorizarAumentoDeExposicao } from "@/lib/autopilot/estado-financeiro";

const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
const hoje = () => new Date().toISOString().slice(0, 10);

let banco: ReturnType<typeof bancoFalso>;
const CERT = "cert-ff";

function montar(over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id: "S1", wallet_address: "0xFF", exchange_id: "binance",
    is_active: true, expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(),
    pnl_today: -10, daily_loss_stop_usd: 50, frozen_until_day: null,
    last_reset_day: hoje(), trades_today: 0, max_trades_per_day: 20,
    max_trade_usd: 1000, conexao_id: "C1", quarentena_em: null,
    contabilidade_incompleta_em: null, risk_mode: "moderado", ...over });
  banco.certificados.push({ id: CERT, strategy_id: "e1", strategy_version: 1,
    strategy_hash: "h1", allowed_venues: ["binance"], allowed_symbols: ["ETH/USDT"],
    risk_limits: {}, valid_from: "2020-01-01T00:00:00Z", valid_until: null,
    revoked_at: null });
}
async function intentPronto(id: string, side: "buy" | "sell" = "buy") {
  await banco.cliente.from("cex_execution_intents").insert({
    id, client_order_id: `c-${id}`, origin: "autopilot_cron", autonomous: true,
    simulated: false, session_id: "S1", wallet_address: "0xFF",
    exchange_id: "binance", symbol: "ETH/USDT", side, order_type: "limit",
    requested_qty: 1, requested_notional_usd: 10, state: "RESERVED",
    certificate_id: side === "buy" ? CERT : null,
    strategy_id: "e1", strategy_version: 1, strategy_hash: "h1",
  } as never);
}
const S = () => banco.sessoes[0];
const estadoDo = (id: string) => banco.intents.find((i) => i.id === id)!.state;

beforeEach(() => { banco = bancoFalso(); });

describe("a autorização final conhece o estado financeiro", () => {
  it("controle positivo: estado saudável AUTORIZA e vira SUBMITTING", async () => {
    montar();
    await intentPronto("i-ok");
    const r = await autorizarSubmissaoNoBanco(banco.cliente, "i-ok");
    expect(r.ok, r.ok ? "" : JSON.stringify(r)).toBe(true);
    expect(estadoDo("i-ok")).toBe("SUBMITTING");
  });

  it("toctou_loss_stop_comitado_antes_da_final_auth_recusa", async () => {
    montar({ pnl_today: -49, daily_loss_stop_usd: 50 });
    // T0 — o precheck passa com o estado de agora.
    const pre = await autorizarAumentoDeExposicao("S1", new Date(), { db: banco.cliente });
    expect(pre.ok, "o precheck tem de passar em T0").toBe(true);

    await intentPronto("i-stop");
    // T1 — um writer financeiro COMITA entre o precheck e a autorização final.
    Object.assign(S(), { pnl_today: -51, frozen_until_day: hoje() });

    // T2 — a autorização final vê o estado de AGORA.
    const r = await autorizarSubmissaoNoBanco(banco.cliente, "i-stop");
    expect(r.ok, "BLOCKER: autorizou com o stop já atingido").toBe(false);
    // ⚠️ E o intent NÃO avança: nada foi enviado.
    expect(estadoDo("i-stop")).toBe("RESERVED");
  });

  it("toctou_contabilidade_incompleta_comitada_antes_recusa", async () => {
    montar();
    const pre = await autorizarAumentoDeExposicao("S1", new Date(), { db: banco.cliente });
    expect(pre.ok).toBe(true);
    await intentPronto("i-cont");
    S().contabilidade_incompleta_em = new Date().toISOString();

    const r = await autorizarSubmissaoNoBanco(banco.cliente, "i-cont");
    expect(r.ok).toBe(false);
    expect(estadoDo("i-cont")).toBe("RESERVED");
  });

  it("toctou_quarentena_e_freeze_comitados_antes_recusam", async () => {
    montar();
    await intentPronto("i-quar");
    S().quarentena_em = new Date().toISOString();
    expect((await autorizarSubmissaoNoBanco(banco.cliente, "i-quar")).ok).toBe(false);

    S().quarentena_em = null;
    S().frozen_until_day = hoje();
    await intentPronto("i-freeze");
    expect((await autorizarSubmissaoNoBanco(banco.cliente, "i-freeze")).ok).toBe(false);
  });

  it("⚠️ o stop é medido pelo NÚMERO, não só pela marca", async () => {
    // pnl já cruzou o limiar e a marca de freeze ficou para trás.
    montar({ pnl_today: -55, daily_loss_stop_usd: 50, frozen_until_day: null });
    await intentPronto("i-numero");
    const r = await autorizarSubmissaoNoBanco(banco.cliente, "i-numero");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toMatch(/stop de perda/);
  });

  it("⚠️⚠️ contador e freeze de ONTEM não valem hoje", async () => {
    const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    montar({ last_reset_day: ontem, pnl_today: -999, frozen_until_day: ontem });
    await intentPronto("i-ontem");
    const r = await autorizarSubmissaoNoBanco(banco.cliente, "i-ontem");
    expect(r.ok, r.ok ? "" : r.porque).toBe(true);
  });

  it("⚠️⚠️ a VENDA atravessa: o freio é só de ENTRADA", async () => {
    montar({ pnl_today: -99, daily_loss_stop_usd: 50, frozen_until_day: hoje(),
             contabilidade_incompleta_em: new Date().toISOString(),
             quarentena_em: new Date().toISOString() });
    await intentPronto("i-sell", "sell");
    const r = await autorizarSubmissaoNoBanco(banco.cliente, "i-sell");
    expect(r.ok, r.ok ? "" : r.porque).toBe(true);
    expect(estadoDo("i-sell")).toBe("SUBMITTING");
  });

  it("⚠️ compra do autopilot SEM sessão não autoriza", async () => {
    montar();
    await banco.cliente.from("cex_execution_intents").insert({
      id: "i-sem", client_order_id: "c-sem", origin: "autopilot_cron",
      autonomous: true, simulated: false, session_id: null, wallet_address: "0xFF",
      exchange_id: "binance", symbol: "ETH/USDT", side: "buy", order_type: "limit",
      requested_qty: 1, requested_notional_usd: 10, state: "RESERVED",
      certificate_id: CERT, strategy_id: "e1", strategy_version: 1,
      strategy_hash: "h1",
    } as never);
    expect((await autorizarSubmissaoNoBanco(banco.cliente, "i-sem")).ok).toBe(false);
  });

  it("⚠️ DCA é autônomo e NÃO tem sessão do piloto — segue isento", async () => {
    montar();
    await banco.cliente.from("cex_execution_intents").insert({
      id: "i-dca", client_order_id: "c-dca", origin: "dca_cron",
      autonomous: true, simulated: false, session_id: null, wallet_address: "0xFF",
      exchange_id: "binance", symbol: "ETH/USDT", side: "buy", order_type: "limit",
      requested_qty: 1, requested_notional_usd: 10, state: "RESERVED",
      certificate_id: CERT, strategy_id: "e1", strategy_version: 1,
      strategy_hash: "h1",
    } as never);
    // A sessão nem existe para ele; o gate financeiro não o alcança.
    S().contabilidade_incompleta_em = new Date().toISOString();
    const r = await autorizarSubmissaoNoBanco(banco.cliente, "i-dca");
    expect(r.ok, r.ok ? "" : r.porque).toBe(true);
  });

  it("⚠️ o SQL sustenta o gate na MESMA transação do SUBMITTING", () => {
    const i = SQL.indexOf("create or replace function public.cex_autorizar_e_submeter");
    expect(i).toBeGreaterThan(-1);
    const corpo = SQL.slice(i);
    // trava do intent, depois da sessão — a mesma ordem das outras RPCs
    expect(corpo).toMatch(/from public\.cex_execution_intents\s*\n\s*where id = p_intent_id for update/);
    expect(corpo).toMatch(/from public\.autopilot_sessions\s*\n\s*where id = v_intent\.session_id for update/);
    // escopo: só as origens do autopilot
    expect(corpo).toMatch(/v_intent\.origin in \('autopilot_browser', 'autopilot_cron'\)/);
    // e os cinco fatos financeiros
    for (const re of [/sessao do piloto PARADA/, /sessao do piloto expirada/,
                      /sessao congelada hoje pelo stop de perda diaria/,
                      /stop de perda ja atingido/, /contabilidade incompleta desde/,
                      /sessao em quarentena por deriva/]) {
      expect(corpo).toMatch(re);
    }
    // o lock da sessão vem ANTES do update que vira SUBMITTING
    const iLock = corpo.indexOf("from public.autopilot_sessions");
    const iSub = corpo.indexOf("set state         = 'SUBMITTING'");
    expect(iLock).toBeGreaterThan(-1);
    expect(iSub).toBeGreaterThan(iLock);
  });
});
