/**
 * ⚠️⚠️⚠️ TERMINAL DE ORDEM NÃO É TERMINAL DE CONTABILIDADE.
 *
 * O cenário que o HEAD anterior declarava como limitação aceita — e que
 * contradizia I9, I11 e I12 ao mesmo tempo:
 *
 *     venda autônoma executa numa corretora cujo `fetchOrder` não traz
 *     comissão → `fee_total` NULL → a sessão é marcada e para de COMPRAR →
 *     o intent vira `FILLED`, que não está em `PRECISAM_RECONCILIAR` →
 *     `ingerirTrades` nunca é alcançado → a varredura de projeções não o
 *     relista (ela comparava LIVRO com POSIÇÃO, e o buraco estava no LIVRO)
 *     → a sessão fica presa PARA SEMPRE e nada vai buscar o que falta.
 *
 * Fail-closed sem soltura não é recovery: é uma parada permanente com
 * aparência de segurança.
 *
 * ⚠️ Os testes aqui NÃO escrevem `fee_total` à mão. A taxa entra pelos TRADES
 * da venue, que é o único caminho real para ela nessas corretoras.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  pendenciasFinanceiras, recuperarPendenciaFinanceira,
} from "@/lib/autopilot/recuperacao-financeira";
import { assentarELiquidarSaida } from "@/lib/autopilot/assentamento-da-saida";
import { entradaAutorizadaNaSessao } from "@/lib/autopilot/autorizacao-de-execucao";
import type { LeituraDaOrdem } from "@/lib/cex/execucao/venue-leitura";
import type { CexCredentials } from "@/lib/cex/types";

const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
const hojeUtc = () => new Date().toISOString().slice(0, 10);

let banco: ReturnType<typeof bancoFalso>;
const chamar = (nome: string, args: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(nome, args).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });

const CRED: CexCredentials = { apiKey: "k", apiSecret: "s" } as CexCredentials;

function sessao(over: Record<string, unknown> = {}) {
  banco.sessoes.push({ id: "S1", wallet_address: "0xR", exchange_id: "binance",
    risk_mode: "moderado", pnl_today: -49, daily_loss_stop_usd: 50,
    frozen_until_day: null, quarentena_em: null,
    contabilidade_incompleta_em: null, ...over });
}
function posicao(over: Record<string, unknown> = {}) {
  banco.posicoes.push({ id: `pos-${banco.posicoes.length + 1}`, session_id: "S1",
    wallet_address: "0xR", exchange_id: "binance", base: "BTC", pair: "BTC/USDT",
    entry_price: 10_000, base_amount: 0.01, cost_usd: 100, status: "open",
    exit_order_id: null, exit_armed_at: null, exit_intent_id: null, ...over });
}
function intent(id: string, over: Record<string, unknown> = {}): string {
  banco.intents.push({ id, client_order_id: `c-${id}`, wallet_address: "0xR",
    origin: "autopilot_cron", autonomous: true, simulated: false, session_id: "S1",
    exchange_id: "binance", symbol: "BTC/USDT", side: "sell", order_type: "limit",
    requested_qty: 0.01, state: "SUBMITTED", filled_qty: 0, filled_quote: 0,
    fee_total: null, fee_currency: null, canceled_qty: 0, conexao_id: "C1",
    external_order_id: null, ...over });
  return id;
}
const aSessao = () => banco.sessoes.find((s) => s.id === "S1")!;
const oIntent = (id: string) => banco.intents.find((i) => i.id === id)!;
const oEfeito = (id: string) => banco.efeitos.find((e) => e.intent_id === id);
const portao = () => entradaAutorizadaNaSessao({
  emQuarentena: Boolean(aSessao().quarentena_em),
  contabilidadeIncompleta: Boolean(aSessao().contabilidade_incompleta_em),
});

/**
 * A venue que responde a ordem SEM comissão — a forma normal do `fetchOrder`
 * de várias corretoras no ccxt, e a origem do estado absorvente.
 */
type Achada = Extract<LeituraDaOrdem, { tipo: "achada" }>;
const achada = (trades: Achada["tradesDaOrdem"]): Achada => ({
  tipo: "achada",
  ordem: { id: "ORD-1", symbol: "BTC/USDT", side: "sell", type: "limit",
           status: "closed", amount: 0.01, filled: 0.01, remaining: 0,
           cost: 100, average: 10_000 },
  tradesDaOrdem: trades,
  historico: { trades: [], possivelmenteIncompleto: false,
               registrosInvalidos: { total: 0, porMotivo: {} } },
});
const semFee = (): Achada => achada([]);
/** A mesma ordem, agora com os TRADES — onde a comissão de verdade vive. */
const comTrades = (fee: number, moeda = "USDT"): Achada => achada([
  { tradeId: "T1", orderId: "ORD-1", qty: 0.01, price: 10_000,
    quote: 100, fee, feeCurrency: moeda, executedAt: null },
]);

/** Deixa a sessão presa exatamente como o cenário real deixa. */
async function venderSemQueAVenueDigaATaxa() {
  sessao();
  intent("i1", { side: "sell", external_order_id: "ORD-1" });
  posicao({ status: "exit_armed", exit_order_id: "ORD-1", exit_intent_id: "i1" });
  const r = await assentarELiquidarSaida("i1", "ORD-1",
    { filled: 0.01, cost: 100, average: 10_000 }, 0.01,
    { db: banco.cliente, chamarRpc: chamar });
  expect(r.ok, r.ok ? "" : r.porque).toBe(true);
}

beforeEach(() => { banco = bancoFalso(); });

describe("R.1 — o estado absorvente existe, e agora tem saída", () => {
  it("⚠️⚠️⚠️ a sessão fica presa e a pendência É ENCONTRADA (era o buraco)", async () => {
    await venderSemQueAVenueDigaATaxa();

    // O estado que o HEAD anterior declarava como sem recuperação.
    expect(oIntent("i1").fee_total).toBe(null);
    expect(oIntent("i1").state).toBe("FILLED");
    expect(oEfeito("i1")!.taxa_opaca).toBe(true);
    expect(aSessao().contabilidade_incompleta_em).toBeTruthy();
    expect(portao().ok).toBe(false);

    // ⚠️⚠️ E A VARREDURA O ENXERGA — com `precisaVenue`, porque o buraco está
    // no LIVRO e projetar de novo não adiantaria nada.
    const p = await pendenciasFinanceiras(50, { chamarRpc: chamar });
    expect(p).not.toBeNull();
    expect(p).toHaveLength(1);
    expect(p![0]).toMatchObject({ intentId: "i1", motivo: "taxa_desconhecida",
                                  precisaVenue: true });
  });

  it("⚠️⚠️⚠️ a recuperação busca os TRADES, a taxa entra, e a sessão destrava", async () => {
    await venderSemQueAVenueDigaATaxa();
    const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))![0];

    const r = await recuperarPendenciaFinanceira(p, {
      db: banco.cliente, chamarRpc: chamar,
      credenciais: async () => CRED,
      ler: async () => comTrades(2),
    });
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.porque}`).toBe(true);
    if (!r.ok) return;
    expect(r.etapa).toBe("livro_atualizado");

    // ⚠️ A taxa entrou pelo LIVRO, vinda dos trades.
    expect(Number(oIntent("i1").fee_total)).toBeCloseTo(2, 10);
    expect(oIntent("i1").fee_currency).toBe("USDT");
    // ⚠️ E só o DELTA foi ao resultado: 100 − 100 − 2 = −2.
    expect(r.realizado).toBeCloseTo(-2, 10);
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);
    expect(aSessao().frozen_until_day).toBe(hojeUtc());

    // ⚠️⚠️ A contabilidade convergiu: a bandeira cai sozinha...
    expect(oEfeito("i1")!.taxa_opaca).toBe(false);
    expect(aSessao().contabilidade_incompleta_em).toBe(null);
    expect(portao().ok).toBe(true);
    // ⚠️ ...e a pendência some por deixar de ser verdadeira, não por alguém
    // marcá-la como fechada. Não existe fila para dessincronizar.
    expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(0);
  });

  it("⚠️⚠️ replay da recuperação não soma P&L nenhum", async () => {
    await venderSemQueAVenueDigaATaxa();
    const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))![0];
    const deps = { db: banco.cliente, chamarRpc: chamar,
                   credenciais: async () => CRED, ler: async () => comTrades(2) };
    await recuperarPendenciaFinanceira(p, deps);
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);

    for (let i = 0; i < 3; i++) {
      const r = await recuperarPendenciaFinanceira(p, deps);
      expect(r.ok && r.realizado).toBe(0);
    }
    expect(Number(aSessao().pnl_today)).toBeCloseTo(-51, 10);
  });

  it("⚠️⚠️⚠️ se a venue NUNCA expõe a taxa, NÃO se finge convergência", async () => {
    await venderSemQueAVenueDigaATaxa();
    const deps = { db: banco.cliente, chamarRpc: chamar,
                   credenciais: async () => CRED, ler: async () => semFee() };

    // Três passadas seguidas, e a venue continua calada.
    for (let i = 0; i < 3; i++) {
      const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))![0];
      expect(p.precisaVenue).toBe(true);
      const r = await recuperarPendenciaFinanceira(p, deps);
      expect(r.ok).toBe(true);
    }
    // ⚠️ A sessão segue presa — que é o desfecho honesto...
    expect(portao().ok).toBe(false);
    expect(Number(aSessao().pnl_today)).toBe(-49);
    // ⚠️ ...e a pendência CONTINUA sendo tentada, em vez de sair do radar.
    expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(1);
  });

  it("⚠️⚠️ a credencial é a HISTÓRICA do intent, nunca a da sessão (I2)", async () => {
    await venderSemQueAVenueDigaATaxa();
    const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))![0];

    const vistos: Array<string | null> = [];
    const espiao = vi.fn(async (it: { conexao_id?: string | null }) => {
      vistos.push(it.conexao_id ?? null);
      return CRED;
    });
    await recuperarPendenciaFinanceira(p, {
      db: banco.cliente, chamarRpc: chamar,
      credenciais: espiao, ler: async () => comTrades(2),
    });
    // ⚠️ O que chegou ao resolvedor de credencial foi o INTENT, com o
    // `conexao_id` histórico dele — não a sessão, não a conexão atual.
    expect(vistos).toEqual(["C1"]);
  });

  it("⚠️⚠️ sem credencial histórica NÃO se pergunta — e a pendência fica de pé", async () => {
    await venderSemQueAVenueDigaATaxa();
    const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))![0];
    const ler = vi.fn(async () => comTrades(2));

    const r = await recuperarPendenciaFinanceira(p, {
      db: banco.cliente, chamarRpc: chamar,
      credenciais: async () => null, ler,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sem_credencial_historica");
    // ⚠️ ZERO chamada à corretora: perguntar com outra credencial seria
    // perguntar na conta errada.
    expect(ler).not.toHaveBeenCalled();
    expect(portao().ok).toBe(false);
  });

  it("⚠️⚠️ ordem que sumiu na venue é DIVERGÊNCIA, não convergência", async () => {
    await venderSemQueAVenueDigaATaxa();
    const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))![0];
    const r = await recuperarPendenciaFinanceira(p, {
      db: banco.cliente, chamarRpc: chamar, credenciais: async () => CRED,
      ler: async () => ({ tipo: "ausente_em_todos", consultados: ["fetchOrder"],
                          historico: null }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("ordem_sumiu_na_venue");
    expect(Number(aSessao().pnl_today)).toBe(-49);
  });

  it("⚠️ leitura indeterminada não conclui nada", async () => {
    await venderSemQueAVenueDigaATaxa();
    const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))![0];
    const r = await recuperarPendenciaFinanceira(p, {
      db: banco.cliente, chamarRpc: chamar, credenciais: async () => CRED,
      ler: async () => ({ tipo: "indeterminado", porque: "rede", consultados: [] }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("venue_indeterminada");
    expect(portao().ok).toBe(false);
  });
});

describe("R.2 — projeção atrasada NÃO gasta chamada externa", () => {
  it("⚠️⚠️ pendência local resolve sem tocar na corretora", async () => {
    sessao({ pnl_today: 0 });
    // Compra que executou e cuja posição ainda não foi projetada.
    intent("c1", { side: "buy", order_type: "market", state: "FILLED",
      filled_qty: 0.01, filled_quote: 600, fee_total: 1, fee_currency: "USDT" });

    const p = (await pendenciasFinanceiras(50, { chamarRpc: chamar }))!;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ motivo: "sem_marcador", precisaVenue: false });

    const ler = vi.fn();
    const r = await recuperarPendenciaFinanceira(p[0], {
      db: banco.cliente, chamarRpc: chamar, credenciais: async () => CRED, ler,
    });
    expect(r.ok && r.etapa).toBe("projetada");
    // ⚠️ ZERO ida à venue: o livro estava completo, só a posição estava atrás.
    expect(ler).not.toHaveBeenCalled();
    const pos = banco.posicoes.find((x) => x.base === "BTC")!;
    expect(Number(pos.base_amount)).toBeCloseTo(0.01, 12);
    expect(Number(pos.cost_usd)).toBeCloseTo(600, 10);
    expect(await pendenciasFinanceiras(50, { chamarRpc: chamar })).toHaveLength(0);
  });
});

describe("R.3 — o SQL sustenta o desenho", () => {
  it("⚠️⚠️ a varredura tem os DOIS braços, e o do livro NÃO tem janela", () => {
    const i = SQL.indexOf("create or replace function public.autopilot_pendencias_financeiras");
    expect(i).toBeGreaterThan(-1);
    const corpo = SQL.slice(i, SQL.indexOf("comment on function public.autopilot_pendencias_financeiras", i));
    // braço 1: projeção atrasada, com a janela de três dias
    expect(corpo).toMatch(/a\.updated_at > now\(\) - interval '3 days'/);
    // braço 2: livro incompleto, SEM janela — senão a sessão presa expiraria
    expect(corpo).toMatch(/or a\.livro_incompleto/);
    const braco2 = corpo.slice(corpo.indexOf("or a.livro_incompleto"));
    expect(braco2).not.toMatch(/interval '3 days'/);
    // e `precisa_venue` sai da MESMA definição única
    expect(corpo).toMatch(/public\.autopilot_efeito_incompleto\(/);
  });

  it("⚠️ a antiga é derrubada — nome vivo com semântica menor convida o buraco", () => {
    expect(SQL).toMatch(/drop function if exists public\.autopilot_projecoes_pendentes\(int\);/);
    expect(SQL).not.toMatch(/create or replace function public\.autopilot_projecoes_pendentes/);
  });
});
