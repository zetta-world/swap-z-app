/**
 * ⚠️⚠️⚠️ AS CINCO FALHAS DO RETEST INDEPENDENTE (CR-1 … CR-5).
 *
 * Todas reproduzidas aqui antes de qualquer conserto, e todas com NÚMEROS
 * ABSOLUTOS. CR-3, CR-4 e CR-5 têm a mesma raiz: o cron decidia dinheiro sobre
 * cópias do estado financeiro com idades diferentes, e o banco dizia uma coisa
 * enquanto a autorização usava outra.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { reservarExposicaoDoBot } from "@/lib/autopilot/reserva-de-inventario";
import { projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";
import { ingerirSnapshotDaOrdem, ingerirTrades } from "@/lib/cex/execucao/intents";
import { pendenciasFinanceiras } from "@/lib/autopilot/recuperacao-financeira";
import { avaliarRisco, lerEstadoFinanceiroDaSessao } from "@/lib/autopilot/estado-financeiro";

let banco: ReturnType<typeof bancoFalso>;
const chamar = (n: string, a: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (x: string, y: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(n, a).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });
const hoje = () => new Date().toISOString().slice(0, 10);
const ontem = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const S = () => banco.sessoes[0];
/** O portão único, sobre o estado DURÁVEL de agora. */
const portao = async () =>
  avaliarRisco(await lerEstadoFinanceiroDaSessao("S1", { db: banco.cliente }));

function sessao(over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id: "S1", wallet_address: "0xCR", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: 0, daily_loss_stop_usd: 50,
    frozen_until_day: null, quarentena_em: null, contabilidade_incompleta_em: null,
    last_reset_day: hoje(), trades_today: 0, max_trades_per_day: 20,
    max_trade_usd: 1000, is_active: true, conexao_id: "C1",
    expires_at: new Date(Date.now() + 6 * 3600e3).toISOString(), ...over });
}
function posicao(over: Record<string, unknown> = {}) {
  banco.posicoes.push({ id: `p${banco.posicoes.length + 1}`, session_id: "S1",
    wallet_address: "0xCR", exchange_id: "binance", base: "BTC", pair: "BTC/USDT",
    entry_price: 10_000, base_amount: 0.01, cost_usd: 100, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null, ...over });
}
function intent(id: string, over: Record<string, unknown> = {}) {
  banco.intents.push({ id, client_order_id: "c" + id, wallet_address: "0xCR",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 1, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    fee_total: null, fee_currency: null, canceled_qty: 0, conexao_id: "C1",
    external_order_id: "ORD-" + id, ...over });
  return id;
}
const oEfeito = (id: string) => banco.efeitos.find((e) => e.intent_id === id);

beforeEach(() => { banco = bancoFalso(); });

describe("CR-1 — BUY terminal sem quote", () => {
  /** 190 de exposição, teto 200, BUY A reservada 10, A FILLED com quote 0. */
  async function cenario() {
    sessao();
    posicao({ base: "SOL", pair: "SOL/USDT", base_amount: 1.9, cost_usd: 190 });
    intent("A", { side: "buy", symbol: "ETH/USDT" });
    intent("B", { side: "buy", symbol: "ETH/USDT" });
    expect((await reservarExposicaoDoBot("A", 10, 200, { chamarRpc: chamar })).ok).toBe(true);
    Object.assign(banco.intents.find((i) => i.id === "A")!,
      { state: "FILLED", filled_qty: 0.004, filled_quote: 0 });
    await projetarEfeitoDoIntent("A", { chamarRpc: chamar });
  }

  it("CR1_buy_terminal_sem_quote_mantem_risco", async () => {
    await cenario();
    // ⚠️ O compromisso NÃO desaba: o custo ainda é desconhecido.
    const b = await reservarExposicaoDoBot("B", 10, 200, { chamarRpc: chamar });
    expect(b.ok, "B tem de ser recusada: 190 + 10 comprometidos + 10 = 210").toBe(false);
    if (!b.ok) expect(b.motivo).toBe("teto_estourado");
    // ⚠️ E a sessão está bloqueada para COMPRA: contabilidade incompleta.
    expect((await portao()).ok).toBe(false);
    // ⚠️ E o intent NÃO desaparece do recovery.
    const p = await pendenciasFinanceiras(50, { chamarRpc: chamar });
    expect(p).toHaveLength(1);
    expect(p![0].intentId).toBe("A");
    expect(p![0].precisaVenue).toBe(true);
  });

  it("CR1_quote_tardio_nao_ultrapassa_exposure_cap", async () => {
    await cenario();
    // O custo de A chega: 10.
    banco.intents.find((i) => i.id === "A")!.filled_quote = 10;
    await projetarEfeitoDoIntent("A", { chamarRpc: chamar });

    // ⚠️ A exposição converge para 200 — e NENHUM instante produziu 200 + 10.
    const exposicao = banco.posicoes
      .filter((x) => x.session_id === "S1")
      .reduce((t, x) => t + Number(x.cost_usd ?? 0), 0);
    expect(exposicao).toBeCloseTo(200, 10);
    expect(Number(oEfeito("A")!.applied_quote)).toBeCloseTo(10, 10);
    // com o custo conhecido, o compromisso zera — e o teto já está cheio
    const b = await reservarExposicaoDoBot("B", 10, 200, { chamarRpc: chamar });
    expect(b.ok).toBe(false);
    // ⚠️ E a contabilidade fechou: a sessão volta a poder comprar (se coubesse).
    expect(oEfeito("A")!.divergencia ?? null).toBe(null);
    expect(S().contabilidade_incompleta_em).toBe(null);
  });
});

describe("CR-2 — regressão de quote", () => {
  it("CR2_regressao_real_cruza_loss_stop", async () => {
    sessao({ pnl_today: -30 });
    posicao();
    intent("V", { side: "sell", requested_qty: 0.01 });
    await ingerirSnapshotDaOrdem(banco.cliente, "V", "ORD-V", {
      cumulativeQty: 0.01, avgPrice: 10_000, cumulativeQuote: 100,
      fee: 2, feeCurrency: "USDT", executedAt: null });
    expect((await projetarEfeitoDoIntent("V", { chamarRpc: chamar })).ok).toBe(true);
    expect(Number(S().pnl_today)).toBeCloseTo(-32, 10);

    // Os trades REAIS dizem 80.
    await ingerirTrades(banco.cliente, "V", "ORD-V", [{
      tradeId: "T1", qty: 0.01, price: 8000, quote: 80,
      fee: 2, feeCurrency: "USDT", orderId: "ORD-V" }]);
    const r = await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    expect(r.ok, r.ok ? "" : r.porque).toBe(true);

    // ⚠️ −30 + (80 − 100 − 2) = −52. O stop CRUZA.
    expect(Number(S().pnl_today)).toBeCloseTo(-52, 10);
    expect(S().frozen_until_day).toBe(hoje());
    expect((await portao()).ok).toBe(false);
  });

  it("CR2_regressao_de_quote_permanece_fail_closed", async () => {
    // Na COMPRA não há correção aritmética possível: fecha e FICA REGISTRADA.
    sessao();
    intent("C", { side: "buy", order_type: "market", state: "FILLED",
      filled_qty: 0.01, filled_quote: 600, fee_total: 1, fee_currency: "USDT" });
    await projetarEfeitoDoIntent("C", { chamarRpc: chamar });
    expect(S().contabilidade_incompleta_em).toBe(null);

    banco.intents.find((i) => i.id === "C")!.filled_quote = 580;
    const r = await projetarEfeitoDoIntent("C", { chamarRpc: chamar });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("regressao_de_quote");
    // ⚠️ Detectada UMA vez, e agora ela FICA.
    expect(oEfeito("C")!.divergencia).toBe("regressao_de_quote");
    expect(S().contabilidade_incompleta_em).toBeTruthy();
    expect((await portao()).ok).toBe(false);
    expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(1);
  });
});

describe("CR-3 — o freeze do recovery vale na mesma passada", () => {
  it("CR3_recovery_freeze_vale_na_mesma_passada", async () => {
    sessao({ pnl_today: -49 });
    posicao();
    // o snapshot que o cron carregaria ANTES do recovery
    const snapshotDoCron = { ...S() };
    expect(Number(snapshotDoCron.pnl_today)).toBe(-49);
    expect(snapshotDoCron.frozen_until_day).toBe(null);

    // o recovery aplica −2 e congela
    intent("V", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: 2, fee_currency: "USDT" });
    await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    expect(Number(S().pnl_today)).toBeCloseTo(-51, 10);
    expect(S().frozen_until_day).toBe(hoje());

    // ⚠️ A cópia do cron ainda diz −49/null...
    expect(Number(snapshotDoCron.pnl_today)).toBe(-49);
    // ⚠️ ...e o portão, que lê AGORA, recusa. ZERO envio.
    const p = await portao();
    expect(p.ok).toBe(false);
    if (!p.ok) expect(["sessao_congelada", "stop_de_perda_atingido"]).toContain(p.motivo);
  });

  it("CR3_estado_pos_recovery_e_recarregado", async () => {
    sessao({ pnl_today: -49 });
    posicao();
    intent("V", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: 2, fee_currency: "USDT" });
    await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    const e = await lerEstadoFinanceiroDaSessao("S1", { db: banco.cliente });
    expect(e).not.toBeNull();
    expect(e!.pnlToday).toBeCloseTo(-51, 10);
    expect(e!.frozenUntilDay).toBe(hoje());
    // ⚠️ Falha de leitura NÃO vira permissão.
    banco.falhas.select = "connection reset";
    expect(await lerEstadoFinanceiroDaSessao("S1", { db: banco.cliente })).toBeNull();
    expect(avaliarRisco(null).ok).toBe(false);
  });
});

describe("CR-4 — a venda do mesmo scan bloqueia a compra seguinte", () => {
  it("CR4_sell_opaca_bloqueia_buy_seguinte_no_mesmo_scan", async () => {
    sessao();
    posicao();
    // O portão do começo da passada: liberado.
    expect((await portao()).ok).toBe(true);

    // Cartão 1 — a VENDA executa, e a venue não reporta a taxa.
    intent("V", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: null });
    const v = await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    expect(v.ok && v.taxaNaoPrecificada).toBe(true);
    expect(S().contabilidade_incompleta_em).toBeTruthy();

    // ⚠️ Cartão 2 — a COMPRA. O portão reavaliado AGORA recusa.
    const p = await portao();
    expect(p.ok, "a BUY do mesmo scan não pode passar").toBe(false);
    if (!p.ok) expect(p.motivo).toBe("contabilidade_incompleta");
  });
});

describe("CR-5 — a virada do dia não apaga um resultado de hoje", () => {
  it("CR5_rollover_nao_apaga_pnl_aplicado_no_recovery", async () => {
    // A sessão está com a linha de ONTEM.
    sessao({ last_reset_day: ontem(), pnl_today: 0, frozen_until_day: null });
    posicao({ cost_usd: 100 });
    // O recovery aplica o resultado de HOJE: 49 − 100 − 2 = −53.
    intent("V", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 49, fee_total: 2, fee_currency: "USDT" });
    const r = await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    expect(r.ok && r.realizado).toBeCloseTo(-53, 10);

    // ⚠️⚠️ QUEM APLICA O P&L CARIMBA O DIA. A virada já aconteceu aqui.
    expect(S().last_reset_day).toBe(hoje());
    expect(Number(S().pnl_today)).toBeCloseTo(-53, 10);
    expect(S().frozen_until_day).toBe(hoje());

    // ⚠️ Um cron com o snapshot de ONTEM na mão decidiria virar o dia. Com a
    // leitura autoritativa ele vê `last_reset_day = hoje` e não tem o que zerar.
    const e = await lerEstadoFinanceiroDaSessao("S1", { db: banco.cliente });
    expect(e!.lastResetDay).toBe(hoje());
    expect((await portao()).ok).toBe(false);
  });

  it("CR5_replay_nao_perde_nem_duplica_pnl", async () => {
    sessao({ last_reset_day: ontem() });
    posicao({ cost_usd: 100 });
    intent("V", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 49, fee_total: 2, fee_currency: "USDT" });
    await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    expect(Number(S().pnl_today)).toBeCloseTo(-53, 10);
    expect(Number(oEfeito("V")!.pnl_aplicado_usd)).toBeCloseTo(-53, 10);

    for (let i = 0; i < 3; i++) {
      const r = await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
      expect(r.ok && r.realizado, `replay ${i}`).toBe(0);
    }
    expect(Number(S().pnl_today)).toBeCloseTo(-53, 10);
    expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(0);
  });
});

describe("CR-3/CR-4/CR-5 — a fiação no cron (a raiz comum)", () => {
  const CRON = readFileSync("src/app/api/autopilot/cron/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("CR3_estado_pos_recovery_e_recarregado (fiação)", () => {
    // ⚠️ A varredura financeira roda ANTES, e a leitura autoritativa depois.
    const iRec = CRON.indexOf("await pendenciasFinanceiras(");
    const iLer = CRON.indexOf("lerEstadoFinanceiroDaSessao(s.id)");
    expect(iRec).toBeGreaterThan(-1);
    expect(iLer).toBeGreaterThan(iRec);
    // ⚠️ E NADA financeiro é decidido pelo snapshot `s`.
    expect(CRON).not.toMatch(/let tradesToday = s\.trades_today/);
    expect(CRON).not.toMatch(/let pnlToday    = s\.pnl_today/);
    expect(CRON).toMatch(/let pnlToday    = fresco\.pnlToday/);
    expect(CRON).toMatch(/let frozenUntil = fresco\.frozenUntilDay/);
    // ⚠️ Falha de leitura FECHA a passada.
    expect(CRON).toMatch(/if \(!fresco\) \{/);
    /**
     * ⚠️⚠️ E O SNAPSHOT NÃO VOLTA POR DENTRO. Medir a atribuição
     * (`pnlToday = fresco.pnlToday`) não bastava: dá para reconstruir
     * `fresco` com os campos velhos e a atribuição continua igual. O que a
     * trava fixa é que NENHUM campo financeiro de `s` é lido no cron.
     */
    for (const campo of ["pnl_today", "last_reset_day", "trades_today",
                         "contabilidade_incompleta_em", "quarentena_em"]) {
      expect(CRON, `o cron não pode ler s.${campo}`)
        .not.toMatch(new RegExp(`\\bs\\.${campo}\\b`));
    }
    /**
     * ⚠️ `frozen_until_day` tem UMA leitura permitida no snapshot, e ela não
     * decide nada: é a linha de base do alerta "congelou agora", que PRECISA
     * ser de antes da passada. Ela é nomeada para que a exceção não vire
     * porta — qualquer outra leitura quebra aqui.
     */
    const doSnapshot = [...CRON.matchAll(/\bs\.frozen_until_day\b/g)];
    expect(doSnapshot).toHaveLength(1);
    expect(CRON).toMatch(/const congeladaAntesDaPassada = s\.frozen_until_day === today;/);
  });

  it("CR4_sell_opaca_bloqueia_buy_seguinte_no_mesmo_scan (fiação)", () => {
    // ⚠️ O portão é REAVALIADO por COMPRA, depois do settle e do laço abrir.
    const iPorCompra = CRON.indexOf("await autorizarAumentoDeExposicao(s.id)");
    expect(iPorCompra, "falta o portão por COMPRA").toBeGreaterThan(-1);
    expect(iPorCompra).toBeGreaterThan(CRON.indexOf("await settleArmedExits("));
    expect(iPorCompra).toBeGreaterThan(CRON.indexOf("let entradasLiberadas"));
    /**
     * ⚠️ E ele vem antes do envio DA COMPRA. `executarOrdemCex` aparece
     * antes no arquivo, no ramo de VENDA — comparar com a primeira
     * ocorrência mediria o arquivo, não a ordem das decisões.
     */
    const envioDaCompra = CRON.indexOf("executarOrdemCex(", iPorCompra);
    expect(envioDaCompra, "nenhum envio depois do portão?").toBeGreaterThan(-1);
    // ⚠️ E entre a abertura do ramo de compra e o portão não sai ordem nenhuma.
    const iRamoCompra = CRON.indexOf("if (!entradasLiberadas)");
    expect(iRamoCompra).toBeGreaterThan(-1);
    expect(iPorCompra).toBeGreaterThan(iRamoCompra);
    expect(CRON.slice(iRamoCompra, iPorCompra)).not.toMatch(/executarOrdemCex\(/);
  });

  it("CR5_rollover_nao_apaga_pnl_aplicado_no_recovery (fiação)", () => {
    // ⚠️ A virada decide sobre a linha RELIDA, nunca sobre o snapshot.
    expect(CRON).not.toMatch(/if \(s\.last_reset_day !== today\)/);
    expect(CRON).toMatch(/if \(fresco\.lastResetDay !== today\)/);
    // ⚠️ E quem aplica P&L carimba o dia, na mesma transação.
    const SQL = readFileSync(
      "supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
    expect(SQL).toMatch(/create or replace function public\.autopilot_aplicar_pnl/);
    expect(SQL).toMatch(/last_reset_day = v_hoje,/);
  });
});

describe("§11 — os cinco interagem", () => {
  it("A) rollover + recovery + BUY: o dia novo já nasce congelado", async () => {
    sessao({ last_reset_day: ontem(), pnl_today: 0 });
    posicao({ cost_usd: 100 });
    intent("V", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 40, fee_total: 2, fee_currency: "USDT" });
    await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    // 40 − 100 − 2 = −62 ⇒ cruza o stop de 50 no primeiro fato do dia
    expect(Number(S().pnl_today)).toBeCloseTo(-62, 10);
    expect((await portao()).ok).toBe(false);
  });

  it("C) SELL sem fee + outra SELL + BUY: as vendas passam, a compra não", async () => {
    sessao();
    posicao({ base_amount: 0.02, cost_usd: 200 });
    intent("V1", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: null });
    await projetarEfeitoDoIntent("V1", { chamarRpc: chamar });
    expect((await portao()).ok).toBe(false);
    // a segunda VENDA continua podendo ser projetada — reduzir risco é livre
    intent("V2", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: 1, fee_currency: "USDT" });
    const v2 = await projetarEfeitoDoIntent("V2", { chamarRpc: chamar });
    expect(v2.ok).toBe(true);
    // e a COMPRA segue barrada enquanto a taxa de V1 não chegar
    expect((await portao()).ok).toBe(false);
  });

  it("D) BUY terminal sem quote + outra BUY: a segunda não passa", async () => {
    sessao();
    posicao({ base: "SOL", pair: "SOL/USDT", base_amount: 1.9, cost_usd: 190 });
    intent("A", { side: "buy", symbol: "ETH/USDT" });
    intent("B", { side: "buy", symbol: "ETH/USDT" });
    await reservarExposicaoDoBot("A", 10, 200, { chamarRpc: chamar });
    Object.assign(banco.intents.find((i) => i.id === "A")!,
      { state: "FILLED", filled_qty: 0.004, filled_quote: 0 });
    await projetarEfeitoDoIntent("A", { chamarRpc: chamar });
    expect((await reservarExposicaoDoBot("B", 10, 200, { chamarRpc: chamar })).ok).toBe(false);
    expect((await portao()).ok).toBe(false);
  });

  it("F) contabilidade incompleta + BUY do navegador: mesmo veredito", async () => {
    sessao();
    posicao();
    intent("V", { side: "sell", state: "FILLED", filled_qty: 0.01,
      filled_quote: 100, fee_total: null });
    await projetarEfeitoDoIntent("V", { chamarRpc: chamar });
    // O navegador carrega a linha por requisição e usa o MESMO `avaliarRisco`.
    const linha = await lerEstadoFinanceiroDaSessao("S1", { db: banco.cliente });
    const r = avaliarRisco(linha);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("contabilidade_incompleta");
  });
});
