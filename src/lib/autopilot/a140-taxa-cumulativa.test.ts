/**
 * ⚠️⚠️⚠️ A140 — A TAXA É CUMULATIVA, E O RECOVERY NÃO TEM MEMÓRIA.
 *
 * `fee_total` do intent é a taxa ACUMULADA da ordem (0059: o valor final
 * independe do número de snapshots). A projeção descontava `p_taxa_usd`
 * inteiro a cada parcial — cobrando a mesma taxa outra vez — e recebia esse
 * número de QUEM CHAMAVA. A varredura de pendências não tinha como saber dele
 * e projetava com taxa zero: o mesmo preenchimento rendia P&L diferente
 * conforme quem o descobrisse.
 *
 * ⚠️ E O DIA TAMBÉM VINHA DE FORA. `p_hoje = null` fazia o freeze do stop de
 * perda cair no `frozen_until_day` antigo — ou seja, não acontecer.
 *
 * Os números aqui são ABSOLUTOS de propósito: comparar o total com o valor
 * que a própria chamada devolveu não mede nada.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  projetarEfeitoDoIntent, projecoesPendentes, liquidarSaidaArmada,
} from "@/lib/autopilot/projecao-de-posicao";

const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
const HOJE_UTC = new Date().toISOString().slice(0, 10);

let banco: ReturnType<typeof bancoFalso>;
const chamar = (nome: string, args: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(nome, args).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });
const deps = { chamarRpc: chamar };
const projetar = (id: string) => projetarEfeitoDoIntent(id, deps);

function sessao(over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id: "S1", wallet_address: "0xA140", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: 0, daily_loss_stop_usd: 50,
    frozen_until_day: null, ...over });
}
function intent(over: Record<string, unknown> = {}): string {
  const id = `i${banco.intents.length + 1}`;
  banco.intents.push({ id, client_order_id: `c${id}`, wallet_address: "0xA140",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "PARTIALLY_FILLED", filled_qty: 0, filled_quote: 0,
    fee_total: null, fee_currency: null, canceled_qty: 0, conexao_id: "C1", ...over });
  return id;
}
const daSessao = () => banco.sessoes.find((x) => x.id === "S1")!;
const marcador = (id: string) => banco.efeitos.find((e) => e.intent_id === id)!;

/** Uma posição de 0,01 BTC a US$ 600, aberta pela própria projeção. */
async function posicaoDe600() {
  const compra = intent({ side: "buy", order_type: "market", state: "FILLED",
                          filled_qty: 0.01, filled_quote: 600 });
  await projetar(compra);
}

beforeEach(() => { banco = bancoFalso(); sessao(); });

describe("A140.1 — taxa cumulativa entra por DELTA", () => {
  it("⚠️⚠️ 320/taxa 1 → +19 · 640/taxa 2 → +19 · total 38 (nunca 37)", async () => {
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.005, filled_quote: 320,
                           fee_total: 1, fee_currency: "USDT" });
    const p1 = await projetar(venda);
    expect(p1.ok && p1.realizado, "320 − 300 − 1").toBeCloseTo(19, 9);
    expect(Number(daSessao().pnl_today)).toBeCloseTo(19, 9);

    const linha = banco.intents.find((i) => i.id === venda)!;
    linha.filled_qty = 0.01; linha.filled_quote = 640; linha.fee_total = 2;
    const p2 = await projetar(venda);
    expect(p2.ok && p2.realizado, "320 − 300 − 1 (o DELTA da taxa)").toBeCloseTo(19, 9);
    expect(Number(daSessao().pnl_today), "38, nunca 37 nem 40").toBeCloseTo(38, 9);
    expect(Number(marcador(venda).fee_aplicada_usd)).toBeCloseTo(2, 9);
  });
});

describe("A140.2 — replay não move nada", () => {
  it("⚠️⚠️ mesma quantidade, mesma taxa: delta ZERO", async () => {
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.01, filled_quote: 640,
                           fee_total: 2, fee_currency: "USDT", state: "FILLED" });
    await projetar(venda);
    const antes = Number(daSessao().pnl_today);
    const replay = await projetar(venda);
    expect(replay.ok && replay.motivo).toBe("sem_delta");
    expect(Number(daSessao().pnl_today)).toBeCloseTo(antes, 9);
  });
});

describe("A140.3 — ajuste SÓ de taxa chega ao P&L", () => {
  it("⚠️⚠️ quantidade parada e taxa 0 → 2: o resultado cai 2, uma vez", async () => {
    /**
     * A 0059 permite o ajuste de taxa depois, quando os trades reais
     * substituem o sintético. `delta_qty` é zero — e o caminho antigo
     * devolvia `sem_delta`, jogando a taxa fora.
     */
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.01, filled_quote: 640, state: "FILLED" });
    const p1 = await projetar(venda);
    expect(p1.ok && p1.realizado, "640 − 600 − 0").toBeCloseTo(40, 9);

    const linha = banco.intents.find((i) => i.id === venda)!;
    linha.fee_total = 2; linha.fee_currency = "USDT";
    const ajuste = await projetar(venda);
    // ⚠️ O ramo passou a cobrir recebido E taxa (A142) — daí o nome.
    expect(ajuste.ok && ajuste.motivo).toBe("ajuste_sem_quantidade");
    expect(ajuste.ok && ajuste.realizado).toBeCloseTo(-2, 9);
    expect(Number(daSessao().pnl_today)).toBeCloseTo(38, 9);

    // E repetir não cobra de novo.
    const replay = await projetar(venda);
    expect(replay.ok && replay.motivo).toBe("sem_delta");
    expect(Number(daSessao().pnl_today)).toBeCloseTo(38, 9);
  });
});

describe("A140.4 — regressão de taxa falha FECHADO", () => {
  it("⚠️⚠️ taxa aplicada 2, livro volta para 1: NÃO vira lucro artificial", async () => {
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.01, filled_quote: 640,
                           fee_total: 2, fee_currency: "USDT", state: "FILLED" });
    await projetar(venda);
    const antes = Number(daSessao().pnl_today);

    banco.intents.find((i) => i.id === venda)!.fee_total = 1;
    const r = await projetar(venda);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("regressao_de_taxa");
    expect(Number(daSessao().pnl_today), "nada de +1 de lucro").toBeCloseTo(antes, 9);
  });
});

describe("A140.5/A140.7 — recovery tardio chega ao MESMO número", () => {
  it("⚠️⚠️ projetar sem nenhum parâmetro financeiro dá o mesmo P&L", async () => {
    /**
     * O caminho imediato passava a taxa; o recovery não tinha como. Agora
     * ninguém passa: os dois leem a mesma linha do livro.
     */
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.01, filled_quote: 640,
                           fee_total: 2, fee_currency: "USDT", state: "FILLED" });
    const r = await projetar(venda);
    expect(r.ok && r.realizado, "640 − 600 − 2").toBeCloseTo(38, 9);
    expect(Number(daSessao().pnl_today)).toBeCloseTo(38, 9);

    // A139/A140: reexecutar o recovery não duplica.
    await projetar(venda);
    expect(Number(daSessao().pnl_today)).toBeCloseTo(38, 9);
  });

  it("⚠️⚠️ e a varredura de pendências enxerga taxa pendente, não só quantidade", async () => {
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.01, filled_quote: 640, state: "FILLED" });
    await projetar(venda);
    // Quantidade toda aplicada; só a taxa apareceu depois.
    const linha = banco.intents.find((i) => i.id === venda)!;
    linha.fee_total = 2; linha.fee_currency = "USDT";
    // A trava é sobre o SQL, porque a varredura é uma query.
    expect(SQL).toMatch(/or coalesce\(public\.autopilot_taxa_do_intent_em_usd\(/);
    expect(SQL).toMatch(/> e\.fee_aplicada_usd \+ 1e-12\)/);
    // E o wrapper devolve `null` quando não dá para olhar — nunca "nada pendente".
    expect(await projecoesPendentes(10, { chamarRpc: async () => { throw new Error("db"); } }))
      .toBeNull();
  });
});

describe("A140.6 — recovery que cruza o stop CONGELA o dia", () => {
  it("⚠️⚠️ pnl −40, stop 50, venda tardia de −20: freeze no dia UTC do banco", async () => {
    /**
     * O cenário exato do §12. Antes, a varredura chamava sem `p_hoje`, o
     * `case` caía no `frozen_until_day` antigo (null) e o freio não entrava:
     * o dono descobria pelo extrato.
     */
    banco.sessoes[0].pnl_today = -40;
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.01, filled_quote: 580, state: "FILLED" });
    const r = await projetar(venda);
    expect(r.ok && r.realizado, "580 − 600").toBeCloseTo(-20, 9);
    expect(Number(daSessao().pnl_today)).toBeCloseTo(-60, 9);
    expect(daSessao().frozen_until_day, "o dia vem do banco, não do caller").toBe(HOJE_UTC);
  });
});

describe("A140 — taxa não precificável é DECLARADA, não fingida", () => {
  it("⚠️⚠️ moeda estranha: taxa não entra, e a bandeira sobe", async () => {
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.01, filled_quote: 640,
                           fee_total: 3, fee_currency: "XYZ", state: "FILLED" });
    const r = await projetar(venda);
    expect(r.ok && r.taxaNaoPrecificada).toBe(true);
    // O P&L sai OTIMISTA — política declarada — mas ninguém finge que é exato.
    expect(r.ok && r.realizado).toBeCloseTo(40, 9);
    expect(Number(marcador(venda).fee_aplicada_usd)).toBe(0);
  });

  it("⚠️ taxa na moeda BASE converte pelo preço do próprio fill", async () => {
    await posicaoDe600();
    // 0,0001 BTC de taxa, com 0,01 BTC vendidos por 640 → preço 64.000 → 6,40
    const venda = intent({ filled_qty: 0.01, filled_quote: 640,
                           fee_total: 0.0001, fee_currency: "BTC", state: "FILLED" });
    const r = await projetar(venda);
    expect(r.ok && r.taxaNaoPrecificada).toBe(false);
    expect(r.ok && r.realizado, "640 − 600 − 6,40").toBeCloseTo(33.6, 6);
  });
});

describe("⚠️ o SQL sustenta a conta", () => {
  it("⚠️⚠️ existe watermark de taxa, e ele entra na mesma transação", () => {
    expect(SQL).toMatch(/fee_aplicada_usd numeric  not null default 0 check \(fee_aplicada_usd >= 0\)/);
    expect(SQL).toMatch(/v_taxa_delta := v_taxa_total - v_e\.fee_aplicada_usd;/);
    expect(SQL).toMatch(/fee_aplicada_usd = greatest\(fee_aplicada_usd, v_taxa_total\)/);
  });

  it("⚠️⚠️ o P&L é ACUMULADO, e a taxa entra por total — nunca somando deltas soltos", () => {
    /**
     * ⚠️ A FÓRMULA MUDOU NO A142, e o motivo está no lugar: somar deltas
     * independentes deixava o recebido tardio de fora. A conta passou a ser
     * `applied_quote − custo_removido − taxa`, comparada com o que já foi
     * contado.
     */
    const acumuladas = [...SQL.matchAll(
      /v_realizado_total := v_quote_novo - v_custo_acum - v_taxa_total;/g)].length;
    expect(acumuladas, "projeção, ajuste sem quantidade e liquidação")
      .toBeGreaterThanOrEqual(2);
    expect(SQL).toMatch(/v_realizado := v_realizado_total - v_e\.pnl_aplicado_usd;/);
    expect(SQL).toMatch(/custo_removido_usd = custo_removido_usd \+ /);
    expect(SQL).not.toMatch(/p_taxa_usd/);
    // E nada de descontar a taxa acumulada inteira por delta.
    expect(SQL).not.toMatch(/- v_taxa_delta;/);
  });

  it("⚠️⚠️ o dia do freeze vem do BANCO, e `p_hoje` não existe mais", () => {
    expect(SQL).not.toMatch(/p_hoje/);
    const ocorrencias = [...SQL.matchAll(
      /v_hoje := \(current_timestamp at time zone 'UTC'\)::date::text;/g)].length;
    expect(ocorrencias, "projeção, ajuste de taxa e liquidação").toBeGreaterThanOrEqual(3);
    expect(SQL).not.toMatch(/coalesce\(p_hoje, frozen_until_day\)/);
  });

  it("⚠️⚠️ a conversão da taxa nasce FECHADA (A116)", () => {
    expect(SQL).toMatch(/revoke all on function public\.autopilot_taxa_do_intent_em_usd\(numeric, text, text, numeric, numeric\)/);
    expect(SQL).toMatch(/grant execute on function public\.autopilot_taxa_do_intent_em_usd\(numeric, text, text, numeric, numeric\)\s*\n?\s*to service_role;/);
  });
});

describe("A142 — o RECEBIDO também tem delta próprio", () => {
  /**
   * ⚠️⚠️⚠️ O ACHADO QUE A REVISÃO ADVERSARIAL ENCONTROU NO PRÓPRIO A140.
   *
   * O A140 deu delta à taxa e ninguém deu ao recebido. `filled_quote` cresce
   * com `filled_qty` PARADO — a corretora nem sempre devolve `cost` no ACK, o
   * executor manda `cumulativeQuote = 0`, e o valor real só aparece quando
   * `cex_ingest_trades` traz os trades. O P&L estava atrás de
   * `v_delta_quote > 0`:
   *
   *     1ª projeção: qty 0,01 · quote 0 → posição FECHADA, US$ 600 de custo
   *                  saem do livro, e ZERO entra no `pnl_today`
   *     2ª projeção: quote 640 chega, qty parada → `sem_delta`
   *
   * O resultado do dia desaparecia. Com o preço para o outro lado, é o
   * PREJUÍZO que some — e o stop de perda nunca dispara.
   */
  it("⚠️⚠️ ACK sem `cost`: a posição fecha, o resultado ESPERA, e chega inteiro depois", async () => {
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.01, filled_quote: 0, state: "FILLED" });

    const p1 = await projetar(venda);
    expect(p1.ok && p1.aplicadoQty).toBeCloseTo(0.01, 12);
    expect(p1.ok && p1.fechou).toBe(true);
    expect(p1.ok && p1.realizado, "sem recebido não se conta resultado").toBe(0);
    expect(Number(daSessao().pnl_today)).toBe(0);
    // ⚠️ E o custo removido fica GUARDADO, esperando o recebido.
    expect(Number(marcador(venda).custo_removido_usd)).toBeCloseTo(600, 9);

    // Os trades reais chegam: quantidade parada, recebido 640.
    banco.intents.find((i) => i.id === venda)!.filled_quote = 640;
    const p2 = await projetar(venda);
    expect(p2.ok && p2.motivo).toBe("ajuste_sem_quantidade");
    expect(p2.ok && p2.realizado, "640 − 600").toBeCloseTo(40, 9);
    expect(Number(daSessao().pnl_today)).toBeCloseTo(40, 9);
  });

  it("⚠️⚠️ parcial com recebido zerado não infla o delta seguinte", async () => {
    /**
     * A variante que o revisor mediu: `applied_quote` ficava em 0, e o segundo
     * delta trazia a receita INTEIRA contra metade do custo — US$ 300 somem.
     */
    await posicaoDe600();
    const venda = intent({ filled_qty: 0.005, filled_quote: 0 });
    await projetar(venda);
    const linha = banco.intents.find((i) => i.id === venda)!;
    linha.filled_qty = 0.01; linha.filled_quote = 1_280;
    const p2 = await projetar(venda);
    expect(p2.ok && p2.realizado, "1280 − 600, nunca 980").toBeCloseTo(680, 9);
    expect(Number(daSessao().pnl_today)).toBeCloseTo(680, 9);
  });

  it("⚠️⚠️ a varredura enxerga recebido pendente", async () => {
    // Sem isto o intent do primeiro caso nunca voltaria.
    expect(SQL).toMatch(/or i\.filled_quote > e\.applied_quote \+ 1e-12/);
  });

  it("⚠️⚠️ liquidação sem `cost`: NÃO lança prejuízo de −custo inteiro", async () => {
    /**
     * `liquidarSaidaArmada` recebia `order.cost` e caía em 0 sem guarda; a
     * conta `0 − 600 − 0` congelava a sessão o dia inteiro por um prejuízo
     * que não existiu.
     */
    await posicaoDe600();
    const venda = intent({ external_order_id: "ORD-1" });
    const pos = banco.posicoes.find((x) => x.base === "BTC")!;
    pos.status = "exit_armed"; pos.exit_order_id = "ORD-1"; pos.exit_intent_id = venda;

    const liq = await liquidarSaidaArmada(venda, 0.01, 0, deps);
    expect(liq.ok && liq.realizado, "sem recebido, sem resultado").toBe(0);
    expect(Number(daSessao().pnl_today)).toBe(0);
    expect(daSessao().frozen_until_day, "nada de congelar por prejuízo inventado").toBeNull();

    // O livro traz o recebido depois, e aí sim o resultado entra.
    const linha = banco.intents.find((i) => i.id === venda)!;
    linha.filled_qty = 0.01; linha.filled_quote = 640;
    const p = await projetar(venda);
    expect(p.ok && p.realizado).toBeCloseTo(40, 9);
  });

  it("⚠️⚠️ fill que chega DEPOIS da posição fechada entra, em vez de repetir `sem_posicao`", async () => {
    /**
     * A liquidação fecha com o que a corretora disse (0,009); os trades reais
     * trazem 0,010. A quantidade a mais não tem posição para reduzir — o custo
     * inteiro já saiu — e `sem_posicao` relistava o intent a cada cinco
     * minutos por três dias, sem nunca contar o resultado.
     */
    // A bolsa do bot era 0,009 (US$ 540); a ordem preencheu 0,010 de verdade —
    // a liquidação fechou com o que a corretora disse, e o resto chega depois.
    const compra = intent({ side: "buy", order_type: "market", state: "FILLED",
                            filled_qty: 0.009, filled_quote: 540 });
    await projetar(compra);
    const venda = intent({ external_order_id: "ORD-2" });
    const pos = banco.posicoes.find((x) => x.base === "BTC")!;
    pos.status = "exit_armed"; pos.exit_order_id = "ORD-2"; pos.exit_intent_id = venda;
    await liquidarSaidaArmada(venda, 0.009, 576, deps);
    expect(banco.posicoes.find((x) => x.base === "BTC")).toBeUndefined();

    const linha = banco.intents.find((i) => i.id === venda)!;
    linha.filled_qty = 0.01; linha.filled_quote = 640;
    const r = await projetar(venda);
    expect(r.ok).toBe(true);
    expect(r.ok && r.motivo).toBe("posicao_ja_encerrada");
    expect(Number(daSessao().pnl_today), "640 − 540").toBeCloseTo(100, 9);

    // E repetir não soma de novo.
    await projetar(venda);
    expect(Number(daSessao().pnl_today)).toBeCloseTo(100, 9);
  });

  it("⚠️ sem posição e sem nada aplicado continua `sem_posicao` — fail-closed de verdade", async () => {
    const venda = intent({ filled_qty: 0.004, filled_quote: 250, state: "FILLED" });
    const r = await projetar(venda);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sem_posicao");
  });
});
