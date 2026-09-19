/**
 * ⚠️⚠️ A110 (revisão round 3) — O NOCIONAL REAL DO PILOTO CHEGA AO EXECUTOR.
 *
 * A rota media `guard.realNotionalUsd` no servidor (price-guard) e... não
 * usava: a chamada do executor seguia `notionalUsd = body.amount * body.price`
 * — e ordem MARKET do piloto não tem `body.price`, então o intent gravava
 * `requested_notional_usd` NULL e a autorização final do banco (RPC 0060)
 * recusava qualquer certificado com teto ("nocional não mensurável").
 *
 * Estes testes invocam o POST real da rota com as bordas mockadas e um SPY
 * no executor: o `notionalUsd` entregue tem de ser a referência calculada no
 * servidor, nunca null onde há medida — e null nunca vira 0.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

const espioes = vi.hoisted(() => ({
  executarOrdemCex: vi.fn(async (..._args: unknown[]) => ({
    desfecho: "submetido" as const, intentId: "i-1", externalOrderId: "E-1",
    filledQty: 0.01, filledQuote: 600, feeTotal: null, feeCurrency: null,
    state: "FILLED" as const,
  })),
}));

/**
 * ⚠️ A SESSÃO DO FIXTURE PRECISA SER LEGITIMAMENTE AUTORIZADA (A130).
 *
 * Estes testes afirmam o caminho FELIZ do piloto. Depois do A130, a rota exige
 * autorização durável server-side — ativa, não expirada, não congelada, dentro
 * do teto diário e com elo no cofre. Uma sessão de fixture sem esses campos é
 * uma sessão PARADA, e o teste passaria a medir a recusa em vez do que ele diz
 * medir. Completá-la NÃO afrouxa nada: o cenário de recusa tem testes próprios
 * em `a130-sessao-autoriza.test.ts`.
 *
 * ⚠️ `vi.hoisted` porque as fábricas de `vi.mock` são içadas para o topo do
 * arquivo e não enxergam `const` de módulo.
 */
const fixtureDaSessao = vi.hoisted(() => {
  const utcDayKey = (d = new Date()) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return {
    utcDayKey,
    /** ⚠️ A reserva do teto diário é server-side; no fixture ela concede. */
    reservarTradeDaSessao: async () => ({ ok: true as const, tradesDepois: 1 }),
    liberarTradeDaSessao: async () => true,
    viva: {
      is_active: true,
      expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      frozen_until_day: null as string | null,
      last_reset_day: utcDayKey(),
      trades_today: 0,
      max_trades_per_day: 10,
      max_trade_usd: 1_000,
    },
  };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimitDurable: async () => ({ ok: true }),
  getClientId: () => "teste",
}));
vi.mock("@/lib/tier/enforce", () => ({
  checkFeatureTier: async () => null,
  denialResponse: () => new Response("negado", { status: 403 }),
}));
vi.mock("@/lib/admin/kill-switches", () => ({
  checarKillSwitches: async () => ({ bloqueado: false }),
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ sub: "0xabc" }),
}));
vi.mock("@/lib/autopilot/liberacao", () => ({
  podeAutomatizar: async () => ({ permitido: true, causa: "aberto" }),
}));
// ⚠️ O cálculo do nocional é o REAL (checkRealNotional); só a leitura do
// preço de referência é fixada — 1 BTC = 60.000 USD.
vi.mock("@/lib/autopilot/price-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/autopilot/price-guard")>();
  return { ...real, getReferencePriceUsd: async () => 60_000 };
});
vi.mock("@/lib/autopilot/sessions", () => ({
  utcDayKey: fixtureDaSessao.utcDayKey,
  reservarTradeDaSessao: fixtureDaSessao.reservarTradeDaSessao,
  liberarTradeDaSessao: fixtureDaSessao.liberarTradeDaSessao,
  getSessionStatus: async () => ({
    id: "sess-1", conexao_id: "cx-1", strategy_id: "estrat-1", strategy_version: 3,
    allowed_symbols: null, strategy_hash: "h-1",
    ...fixtureDaSessao.viva,
  }),
}));
vi.mock("@/lib/cex/conexoes", () => ({
  conexaoParaExecucao: async () => ({ ok: true, conexao: { id: "cx-1" } }),
  decifrarConexao: () => ({ apiKey: "VAULT-KEY-A", apiSecret: "VAULT-SECRET-A" }),
}));
vi.mock("@/lib/autopilot/certificado", () => ({
  certificadoVivo: async () => null,
}));
vi.mock("@/lib/autopilot/regime", () => ({
  regimeDaBase: async () => "TRENDING_UP",
}));
vi.mock("@/lib/autopilot/politica", () => ({
  avaliarDecisaoDeEstrategia: () => ({
    permite: true, versao: 1, tetoEfetivoUsd: 1_000, certificadoId: "cert-1",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => null,
}));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: () => {}, logError: () => {}, recordEvent: async () => {},
}));
vi.mock("@/lib/cex/execucao/executor", () => ({
  executarOrdemCex: espioes.executarOrdemCex,
}));

/**
 * ⚠️⚠️ O LIVRO DE POSIÇÕES DO SERVIDOR — A131 (Round 9).
 *
 * A rota passou a exigir inventário server-side para VENDER (posse do bot) e
 * para COMPRAR (teto de exposição). Sem este fixture, todo cenário deste
 * arquivo cairia na recusa nova — e o que ele mede é OUTRA coisa. A posse é
 * exercitada em `a131-livro-unico.test.ts`.
 */
vi.mock("@/lib/autopilot/positions-server", () => ({
  lerPosicaoDoBot: async () => ({
    ok: true,
    posicao: { id: "P1", session_id: "S1", base: "BTC", pair: "BTC/USDT",
               base_amount: 5, cost_usd: 100, status: "open",
               exit_order_id: null, exit_armed_at: null },
  }),
  getOpenServerPositions: async () => ({ ok: true, posicoes: [] }),
  markServerExitArmed: async () => ({ ok: true }),
  applySessionPnl: async () => ({ ok: true }),
}));
vi.mock("@/lib/autopilot/projecao-de-posicao", () => ({
  projetarEfeitoDoIntent: async () => ({
    ok: true, motivo: "aplicado", aplicadoQty: 0, aplicadoQuote: 0,
    custoRemovido: 0, fechou: false,
  }),
}));

vi.mock("@/lib/autopilot/reserva-de-inventario", () => ({
  // ⚠️ A134/A135: a posse e a exposição passaram a ser RESERVADAS. Aqui elas
  // concedem sempre — o que estes arquivos medem é outra coisa.
  reservarVendaDoBot: async (_s: string, _b: string, qtd: number) =>
    ({ ok: true, qtd, limitada: false, naPosicao: qtd }),
  liberarVendaDoBot: async () => {},
  reservarExposicaoDoBot: async () =>
    ({ ok: true, exposicaoUsd: 0, reservadoUsd: 0, tetoUsd: 1_000_000 }),
  liberarExposicaoDoBot: async () => {},
}));

import { POST } from "@/app/api/cex/order/route";

function reqDe(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/cex/order", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const BASE = {
  exchange: "binance", symbol: "BTC/USDT", side: "buy",
  confirm: "I-CONFIRM-REAL-ORDER", apiKey: "k12345678", apiSecret: "s12345678",
};

beforeEach(() => {
  espioes.executarOrdemCex.mockClear();
  // ⚠️ A120: o ramo MANUAL calcula o fingerprint da credencial antes de chamar
  // o executor — sem a env de HMAC ele falha fechado (500) de propósito.
  process.env.CEX_RECOVERY_HMAC_KEY = "chave-hmac-de-teste-a120";
});

describe("A110 r3 — notionalUsd entregue ao executor", () => {
  it("⚠️⚠️ piloto autônomo, MARKET (sem price), referência no servidor ⇒ executor recebe o nocional calculado", async () => {
    const resp = await POST(reqDe({
      /**
       * ⚠️ A QUANTIDADE ENCOLHEU NO ROUND 9, e não é ajuste cosmético: a rota
       * passou a conferir o TETO DE EXPOSIÇÃO do servidor (A131 §22), o mesmo
       * que o cron usa — `moderado` = US$ 200. Uma compra de US$ 600 pelo
       * navegador passava porque ninguém no servidor olhava exposição; agora
       * ela é recusada, como já era no cron. O que este teste mede — de onde
       * sai o `notionalUsd` — continua igual.
       */
      ...BASE, type: "market", amount: 0.001, autopilot: true, maxNotionalUsd: 1_000,
    }));
    expect(resp.status).toBe(200);
    expect(espioes.executarOrdemCex).toHaveBeenCalledTimes(1);
    const ordem = espioes.executarOrdemCex.mock.calls[0][2] as { notionalUsd?: number | null };
    // 0.001 BTC × 60.000 USD de referência = 60 — NUNCA null aqui: seria
    // "nocional não mensurável" na autorização final e o certificado com teto
    // seria recusado (o defeito medido pelo revisor).
    expect(ordem.notionalUsd).toBeCloseTo(60, 9);
  });

  it("ordem MANUAL market segue inalterada: notionalUsd null (e nunca 0)", async () => {
    const resp = await POST(reqDe({ ...BASE, type: "market", amount: 0.01 }));
    expect(resp.status).toBe(200);
    const ordem = espioes.executarOrdemCex.mock.calls[0][2] as { notionalUsd?: number | null };
    expect(ordem.notionalUsd).toBeNull();
  });

  it("piloto LIMIT com price: o nocional do pedido (amount × price) prevalece", async () => {
    const resp = await POST(reqDe({
      ...BASE, type: "limit", amount: 0.001, price: 59_000,
      autopilot: true, maxNotionalUsd: 1_000,
    }));
    expect(resp.status).toBe(200);
    const ordem = espioes.executarOrdemCex.mock.calls[0][2] as { notionalUsd?: number | null };
    expect(ordem.notionalUsd).toBeCloseTo(59, 9);
  });

  it("⚠️ guarda estrutural: a chamada do executor tem o fallback `?? notionalRealDoPiloto`", () => {
    // Âncora na linha da chamada — se o fallback sumir, o teste comportamental
    // acima já falha; esta trava impede um "conserto" que devolva 0 ou que
    // mande o nocional do piloto para a ordem manual.
    const fonte = readFileSync("src/app/api/cex/order/route.ts", "utf8");
    expect(fonte).toMatch(
      // ⚠️ `body.amount` virou `quantidadeAutorizada` no A131: a quantidade
      // que o servidor autoriza (limitada à posição do bot numa venda) é a
      // que desce para o nocional — senão o teto seria conferido contra um
      // número e a ordem sairia com outro.
      /notionalUsd:\s*\(typeof body\.price === "number" \? quantidadeAutorizada \* body\.price : null\)\s*\?\? notionalRealDoPiloto/);
    expect(fonte).toMatch(/notionalRealDoPiloto = guard\.realNotionalUsd \?\? null/);
  });
});
