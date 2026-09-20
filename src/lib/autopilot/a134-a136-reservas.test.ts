/**
 * ⚠️⚠️⚠️ A134 / A135 / A136 — CONFERIR NÃO É RESERVAR, E DUAS ESCRITAS NÃO SÃO
 * UMA TRANSAÇÃO.
 *
 * O Round 9 trouxe posse e exposição para o servidor e parou aí: ler, decidir,
 * agir. Duas requisições simultâneas leem o MESMO estado e as duas passam —
 * é o defeito que o A132 já tinha fechado para o contador diário, repetido no
 * inventário. E a liquidação da saída armada escrevia o marcador e a posição
 * em operações separadas, o que quebra exactly-once em qualquer ordem.
 *
 * ⚠️ TESTES DE PROPRIEDADE, não de texto: o que eles medem é quantas ordens
 * ficam autorizadas, e o que sobra no livro depois.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  reservarVendaDoBot, reservarExposicaoDoBot, liberarReservaDoIntent,
} from "@/lib/autopilot/reserva-de-inventario";
import { liquidarSaidaArmada, projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";

const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");

let banco: ReturnType<typeof bancoFalso>;
const chamar = (nome: string, args: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(nome, args).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });
const deps = { chamarRpc: chamar };
const HOJE = "2026-09-20";

function sessao(over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id: "S1", wallet_address: "0xA134", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: 0, daily_loss_stop_usd: 50,
    frozen_until_day: null, ...over });
}
function posicao(over: Record<string, unknown> = {}) {
  banco.posicoes.push({ id: "P1", session_id: "S1", wallet_address: "0xA134",
    exchange_id: "binance", base: "BTC", pair: "BTC/USDT",
    entry_price: 60_000, base_amount: 0.01, cost_usd: 600, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null, ...over });
}
function intentDeVenda(over: Record<string, unknown> = {}): string {
  const id = `i${banco.intents.length + 1}`;
  banco.intents.push({ id, client_order_id: `c${id}`, wallet_address: "0xA134",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    canceled_qty: 0, ...over });
  return id;
}
function intentDeCompra(over: Record<string, unknown> = {}): string {
  return intentDeVenda({ side: "buy", order_type: "market", ...over });
}
const daPosicao = () => banco.posicoes.find((p) => p.base === "BTC");
const daSessao  = () => banco.sessoes.find((s) => s.id === "S1")!;

beforeEach(() => { banco = bancoFalso(); sessao(); });

describe("A134 — uma posição não autoriza duas vendas concorrentes", () => {
  it("⚠️⚠️ posição 0,01 · DUAS vendas de 0,01 ao mesmo tempo: só UMA é autorizada", async () => {
    posicao();
    const i1 = intentDeVenda(), i2 = intentDeVenda();
    const [a, b] = await Promise.all([
      reservarVendaDoBot(i1, 0.01, deps),
      reservarVendaDoBot(i2, 0.01, deps),
    ]);
    const autorizadas = [a, b].filter((r) => r.ok);
    expect(autorizadas, "duas vendas não cabem na mesma bolsa").toHaveLength(1);
    expect(autorizadas[0].ok && autorizadas[0].qtd).toBeCloseTo(0.01, 12);
    const negada = [a, b].find((r) => !r.ok);
    expect(negada && !negada.ok && negada.motivo).toBe("quantidade_ja_reservada");
    // ⚠️ E o compromisso tem DONO: mora no marcador do intent, não num
    // contador agregado que qualquer um pode consumir (A137).
    const comprometido = banco.efeitos.reduce((t, e) => t + Number(e.reservado_qty ?? 0), 0);
    expect(comprometido).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️ cron e navegador na MESMA sessão disputam a mesma reserva", async () => {
    // Não há dois caminhos: é a mesma função, com a mesma trava, para os dois.
    posicao();
    const doCronId = intentDeVenda({ origin: "autopilot_cron" });
    const doNavId = intentDeVenda({ origin: "autopilot_browser" });
    const [doCron, doNavegador] = await Promise.all([
      reservarVendaDoBot(doCronId, 0.006, deps),
      reservarVendaDoBot(doNavId, 0.008, deps),
    ]);
    const total = (doCron.ok ? doCron.qtd : 0) + (doNavegador.ok ? doNavegador.qtd : 0);
    expect(total, "nunca mais do que o bot tem").toBeLessThanOrEqual(0.01 + 1e-12);
  });

  it("⚠️ pedido maior que a posição é LIMITADO, não recusado (A131)", async () => {
    posicao();
    const r = await reservarVendaDoBot(intentDeVenda(), 0.5, deps);
    expect(r.ok && r.qtd).toBeCloseTo(0.01, 12);
    expect(r.ok && r.limitada).toBe(true);
  });

  it("⚠️⚠️ saída já armada não reserva nada", async () => {
    posicao({ status: "exit_armed", exit_order_id: "EXT-1" });
    const r = await reservarVendaDoBot(intentDeVenda(), 0.005, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("saida_ja_armada");
  });

  it("⚠️⚠️ sem posição não reserva — o saldo da conta é do dono", async () => {
    const r = await reservarVendaDoBot(intentDeVenda(), 0.005, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sem_posicao");
  });

  it("⚠️ devolver libera a vaga para a próxima — e só a recusa PROVADA devolve", async () => {
    posicao();
    const i1 = intentDeVenda(), i2 = intentDeVenda();
    expect((await reservarVendaDoBot(i1, 0.01, deps)).ok).toBe(true);
    expect((await reservarVendaDoBot(i2, 0.01, deps)).ok).toBe(false);
    await liberarReservaDoIntent(i1, deps);
    expect((await reservarVendaDoBot(i2, 0.01, deps)).ok).toBe(true);
  });

  it("⚠️⚠️ e a reserva VIRA efeito quando a venda entra no livro", async () => {
    posicao();
    const venda = intentDeVenda();
    await reservarVendaDoBot(venda, 0.004, deps);
    const marcador = () => banco.efeitos.find((e) => e.intent_id === venda)!;
    expect(Number(marcador().reservado_qty)).toBeCloseTo(0.004, 12);

    banco.intents.find((i) => i.id === venda)!.filled_qty = 0.004;
    banco.intents.find((i) => i.id === venda)!.filled_quote = 250;
    await projetarEfeitoDoIntent(venda, deps);
    // ⚠️ O compromisso VIVO é `reservado − applied`: ele zera sozinho quando o
    // fill entra. Era a subtração num agregado que podia comer a reserva
    // alheia (A137).
    expect(Number(marcador().reservado_qty) - Number(marcador().applied_qty))
      .toBeLessThanOrEqual(1e-12);
  });
});

describe("A135 — o teto de exposição não cabe duas vezes", () => {
  it("⚠️⚠️ exposição 190, teto 200 · DUAS compras de 10: só UMA passa", async () => {
    banco.posicoes.push({ id: "P9", session_id: "S1", base: "ETH", pair: "ETH/USDT",
      base_amount: 1, cost_usd: 190, status: "open" });
    const [a, b] = await Promise.all([
      reservarExposicaoDoBot(intentDeCompra(), 10, 200, deps),
      reservarExposicaoDoBot(intentDeCompra(), 10, 200, deps),
    ]);
    expect([a, b].filter((r) => r.ok), "190 + 10 + 10 = 210 > 200").toHaveLength(1);
    const negada = [a, b].find((r) => !r.ok);
    expect(negada && !negada.ok && negada.motivo).toBe("teto_estourado");
    const comprometido = banco.efeitos.reduce((t, e) => t + Number(e.reservado_usd ?? 0), 0);
    expect(comprometido).toBeCloseTo(10, 9);
  });

  it("⚠️ com folga as duas passam — a trava não estrangula o caminho legítimo", async () => {
    banco.posicoes.push({ id: "P9", session_id: "S1", base: "ETH",
      base_amount: 1, cost_usd: 100, status: "open" });
    const [a, b] = await Promise.all([
      reservarExposicaoDoBot(intentDeCompra(), 10, 200, deps),
      reservarExposicaoDoBot(intentDeCompra(), 10, 200, deps),
    ]);
    expect([a.ok, b.ok]).toEqual([true, true]);
  });

  it("⚠️⚠️ o que já está PROMETIDO conta no teto, não só o que está no livro", async () => {
    banco.posicoes.push({ id: "P9", session_id: "S1", base: "ETH",
      base_amount: 1, cost_usd: 150, status: "open" });
    expect((await reservarExposicaoDoBot(intentDeCompra(), 40, 200, deps)).ok).toBe(true);
    // 150 no livro + 40 prometidos = 190. Mais 20 estoura.
    expect((await reservarExposicaoDoBot(intentDeCompra(), 20, 200, deps)).ok).toBe(false);
  });

  it("⚠️ devolver libera o teto de novo", async () => {
    banco.posicoes.push({ id: "P9", session_id: "S1", base: "ETH",
      base_amount: 1, cost_usd: 190, status: "open" });
    const i1 = intentDeCompra(), i2 = intentDeCompra();
    expect((await reservarExposicaoDoBot(i1, 10, 200, deps)).ok).toBe(true);
    expect((await reservarExposicaoDoBot(i2, 10, 200, deps)).ok).toBe(false);
    await liberarReservaDoIntent(i1, deps);
    expect((await reservarExposicaoDoBot(i2, 10, 200, deps)).ok).toBe(true);
  });

  it("⚠️⚠️ nocional não mensurável não reserva nada", async () => {
    // "não medimos" nunca pode virar "cabe no teto".
    const r = await reservarExposicaoDoBot(intentDeCompra(), Number.NaN, 200, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nocional_nao_mensuravel");
  });

  it("⚠️⚠️ e a reserva VIRA exposição real quando a compra entra no livro", async () => {
    const compra = intentDeCompra();
    expect((await reservarExposicaoDoBot(compra, 100, 200, deps)).ok).toBe(true);
    const linha = banco.intents.find((i) => i.id === compra)!;
    linha.state = "FILLED"; linha.filled_qty = 0.001; linha.filled_quote = 100;
    await projetarEfeitoDoIntent(compra, deps);
    const marcador = banco.efeitos.find((e) => e.intent_id === compra)!;
    expect(Number(marcador.reservado_usd) - Number(marcador.applied_quote))
      .toBeLessThanOrEqual(1e-9);
    // E agora o capital está na POSIÇÃO, contando no teto por si.
    expect(Number(daPosicao()!.cost_usd)).toBeCloseTo(100, 9);
  });
});

describe("A136 — marcador e posição avançam juntos, ou não avançam", () => {
  function comSaidaArmada() {
    const venda = intentDeVenda({ external_order_id: "EXT-ARMADA" });
    // ⚠️ A139: a posição guarda o INTENT da saída, não só o número da ordem.
    posicao({ status: "exit_armed", exit_order_id: "EXT-ARMADA", exit_intent_id: venda });
    return venda;
  }

  it("⚠️⚠️ parcial: posição reduzida E marcador avançado na MESMA chamada", async () => {
    const venda = comSaidaArmada();
    const r = await liquidarSaidaArmada(venda, 0.004, 250, deps);
    expect(r.ok && r.aplicadoQty).toBeCloseTo(0.004, 12);
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.006, 12);
    expect(Number(daPosicao()!.cost_usd)).toBeCloseTo(360, 9);
    const marcador = banco.efeitos.find((e) => e.intent_id === venda)!;
    expect(Number(marcador.applied_qty)).toBeCloseTo(0.004, 12);
    // ⚠️ E o remanescente volta a poder armar: a ordem anterior foi resolvida.
    expect(daPosicao()!.status).toBe("open");
    expect(daPosicao()!.exit_order_id).toBeNull();
  });

  it("⚠️⚠️ total: posição removida E marcador avançado juntos", async () => {
    const venda = comSaidaArmada();
    const r = await liquidarSaidaArmada(venda, 0.01, 640, deps);
    expect(r.ok && r.fechou).toBe(true);
    expect(r.ok && r.custoRemovido).toBeCloseTo(600, 9);
    expect(daPosicao()).toBeUndefined();
    expect(Number(banco.efeitos[0].applied_qty)).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️ falha da transação NÃO deixa meio efeito", async () => {
    /**
     * Antes eram duas escritas: marcador na frente deixava a posição cheia com
     * o marcador dizendo "aplicado" (a venda nunca entrava no livro); posição
     * na frente deixava o marcador atrás (a reconciliação reduzia de novo).
     * Agora a falha é de uma coisa só — nada avança.
     */
    const venda = comSaidaArmada();
    banco.falhas.rpc = "deadlock detected";
    const r = await liquidarSaidaArmada(venda, 0.004, 250, deps);
    expect(r.ok).toBe(false);
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
    expect(banco.efeitos).toHaveLength(0);
  });

  it("⚠️⚠️ e a retentativa depois da falha converge EXATAMENTE uma vez", async () => {
    const venda = comSaidaArmada();
    banco.falhas.rpc = "deadlock detected";
    expect((await liquidarSaidaArmada(venda, 0.004, 250, deps)).ok).toBe(false);
    delete banco.falhas.rpc;
    expect((await liquidarSaidaArmada(venda, 0.004, 250, deps)).ok).toBe(true);
    const terceira = await liquidarSaidaArmada(venda, 0.004, 250, deps);
    expect(terceira.ok && terceira.motivo).toBe("sem_delta");
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.006, 12);
  });

  it("⚠️⚠️ liquidação e reconciliação concorrentes aplicam o efeito UMA vez", async () => {
    const venda = comSaidaArmada();
    banco.intents.find((i) => i.id === venda)!.filled_qty = 0.004;
    banco.intents.find((i) => i.id === venda)!.filled_quote = 250;
    const [liq, proj] = await Promise.all([
      liquidarSaidaArmada(venda, 0.004, 250, deps),
      projetarEfeitoDoIntent(venda, deps),
    ]);
    expect(liq.ok).toBe(true);
    // A projeção ou devolve `saida_em_liquidacao` (posição ainda armada) ou
    // `sem_delta` (a liquidação já aplicou). Nunca aplica de novo.
    expect(proj.ok && proj.motivo).not.toBe("aplicado");
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.006, 12);
  });

  it("⚠️⚠️ recusa NÃO pode avançar o marcador — meio efeito é o defeito", async () => {
    /**
     * O cenário 2 do auditor, medido: se o marcador andar sem a posição andar,
     * a reconciliação seguinte vê delta zero e a venda NUNCA entra no livro.
     * Qualquer recusa desta função tem de deixar o marcador exatamente onde
     * estava — é o que torna a retentativa possível.
     */
    const venda = intentDeVenda({ external_order_id: "EXT-ARMADA" });   // sem posição
    const r = await liquidarSaidaArmada(venda, 0.004, 250, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sem_posicao");
    const marcador = banco.efeitos.find((e) => e.intent_id === venda);
    expect(Number(marcador?.applied_qty ?? 0),
      "marcador avançado sem posição reduzida = venda perdida para sempre").toBe(0);

    // E quando a posição aparece ARMADA com este intent, ela aplica normalmente.
    posicao({ status: "exit_armed", exit_order_id: "EXT-ARMADA", exit_intent_id: venda });
    const segunda = await liquidarSaidaArmada(venda, 0.004, 250, deps);
    expect(segunda.ok && segunda.aplicadoQty).toBeCloseTo(0.004, 12);
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.006, 12);
  });

  it("⚠️ manual e simulado não liquidam posição do bot", async () => {
    posicao({ status: "exit_armed", exit_order_id: "EXT-ARMADA" });
    const manual = intentDeVenda({ origin: "manual", autonomous: false });
    expect((await liquidarSaidaArmada(manual, 0.004, 250, deps)).ok).toBe(false);
    const simulado = intentDeVenda({ simulated: true });
    expect((await liquidarSaidaArmada(simulado, 0.004, 250, deps)).ok).toBe(false);
    expect(Number(daPosicao()!.base_amount)).toBeCloseTo(0.01, 12);
  });
});

describe("⚠️ o SQL sustenta as três propriedades", () => {
  it("⚠️⚠️ as reservas travam a linha ANTES de decidir", () => {
    expect(SQL).toMatch(/where session_id = v_i\.session_id and base = v_base for update/);
    expect(SQL).toMatch(/from public\.autopilot_sessions where id = v_i\.session_id for update/);
  });

  it("⚠️⚠️ a exposição soma o que está no livro E o que está prometido", () => {
    expect(SQL).toMatch(/select coalesce\(sum\(cost_usd\), 0\) into v_exposicao/);
    expect(SQL).toMatch(/if v_exposicao \+ v_comprometido \+ p_usd > p_teto then/);
  });

  it("⚠️⚠️ NÃO existe prazo de reserva — quem encerra é o ESTADO do intent (A137)", () => {
    /**
     * A versão anterior expirava a reserva em 10 minutos. O que ela esquecia
     * não era um fantasma: era uma ordem possivelmente VIVA. Uma limitada
     * aceita sem preencher liberava o compromisso, a segunda entrada passava,
     * e as duas preenchiam.
     */
    expect(SQL).not.toMatch(/autopilot_janela_de_reserva/);
    expect(SQL).not.toMatch(/reservado_ate/);
    expect(SQL).toMatch(/create or replace function public\.autopilot_compromisso_vivo/);
    /**
     * ⚠️ A144 partiu esta linha em duas faixas: `FAILED_PRE_SUBMIT` (nada
     * chegou à corretora) segue sendo o zero incondicional, mas terminal COM
     * preenchimento passou a comprometer o que EXECUTOU. O prazo continua
     * não existindo — quem encerra é o estado, e agora também o fill.
     */
    expect(SQL).toMatch(/when p_estado = 'FAILED_PRE_SUBMIT' then 0/);
    expect(SQL).toMatch(
      /when p_estado in \('FILLED', 'CANCELED'\)\s*\n\s*then greatest\(coalesce\(p_executado, 0\) - coalesce\(p_aplicado, 0\), 0\)/);
  });

  it("⚠️⚠️ a liquidação faz posição E marcador na mesma função", () => {
    const i = SQL.indexOf("create or replace function public.autopilot_liquidar_saida_armada");
    expect(i).toBeGreaterThan(-1);
    const corpo = SQL.slice(i, SQL.indexOf("$$;", i));
    expect(corpo).toMatch(/for update/);
    expect(corpo).toMatch(/delete from public\.autopilot_positions|update public\.autopilot_positions/);
    expect(corpo).toMatch(/update public\.autopilot_position_effects/);
  });

  it("⚠️⚠️ e todas nascem FECHADAS (A116)", () => {
    for (const fn of ["autopilot_reservar_venda_do_intent\\(uuid, numeric\\)",
                      "autopilot_reservar_exposicao_do_intent\\(uuid, numeric, numeric\\)",
                      "autopilot_liberar_reserva_do_intent\\(uuid\\)",
                      "autopilot_liquidar_saida_armada\\(uuid, numeric, numeric\\)"]) {
      expect(SQL, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\s*\\n?\\s*from public, anon, authenticated;`));
      expect(SQL, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\s*\\n?\\s*to service_role;`));
    }
  });
});
