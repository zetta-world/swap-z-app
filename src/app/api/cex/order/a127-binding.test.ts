/**
 * A127.9/A127.11 — browser Autopilot: snapshot + binding financeiro.
 *
 * S1→C1/A e body B jamais pode produzir intent C1 com side effect B.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import type { RespostaDaVenue } from "@/lib/cex/execucao/venue-primitivo";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import type { IntentRow } from "@/lib/cex/execucao/intents";

const credenciais = vi.hoisted(() => ({
  A: { apiKey: "VAULT-A-123456", apiSecret: "VAULT-SECRET-A-123456" },
  B: { apiKey: "BODY-B-1234567", apiSecret: "BODY-SECRET-B-123456" },
}));

const estado = vi.hoisted(() => ({
  conexaoId: "C1" as string | null,
  aptidao: "current" as "current" | "retired" | "revoked" | "ilegivel",
}));
/**
 * ⚠️ O ESPIÃO CARREGA A ASSINATURA REAL — sem ela `mock.calls[0][1]` é um
 * índice fora de uma tupla vazia, e o `tsc` recusa. Um espião sem assinatura
 * também não provaria NADA sobre QUAL credencial viajou, que é o ponto inteiro
 * do A127-BINDING.
 */
type EnviarNaVenue = (
  id: CexId,
  creds: CexCredentials,
  req: { symbol: string; side: "buy" | "sell"; type: "market" | "limit";
         amount: number; price?: number | null; clientOrderId: string },
) => Promise<RespostaDaVenue>;
const spies = vi.hoisted(() => ({
  enviar: vi.fn<EnviarNaVenue>(async () => ({
    tipo: "aceita", ordem: { id: "EXT-A127", filled: 0, status: "open" } as never,
  })),
}));
let bancoAtual: ReturnType<typeof bancoFalso> | null = null;

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
  rateLimitDurable: async () => ({ ok: true }), getClientId: () => "teste",
}));
vi.mock("@/lib/tier/enforce", () => ({
  checkFeatureTier: async () => null,
  denialResponse: () => new Response("negado", { status: 403 }),
}));
vi.mock("@/lib/admin/kill-switches", () => ({
  checarKillSwitches: async () => ({ bloqueado: false }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ sub: "0xA127" }) }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => bancoAtual?.cliente ?? null }));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: () => {}, logError: () => {}, recordEvent: async () => {},
}));
vi.mock("@/lib/cex/execucao/venue-primitivo", () => ({ enviarOrdemNaVenue: spies.enviar }));
vi.mock("@/lib/autopilot/liberacao", () => ({
  podeAutomatizar: async () => ({ permitido: true, causa: "aberto" }),
}));
vi.mock("@/lib/autopilot/price-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/autopilot/price-guard")>();
  return { ...real, getReferencePriceUsd: async () => 100 };
});
vi.mock("@/lib/autopilot/sessions", () => ({
  utcDayKey: fixtureDaSessao.utcDayKey,
  reservarTradeDaSessao: fixtureDaSessao.reservarTradeDaSessao,
  liberarTradeDaSessao: fixtureDaSessao.liberarTradeDaSessao,
  getSessionStatus: async () => ({
    id: "S1", conexao_id: estado.conexaoId,
    strategy_id: "estrat-1", strategy_version: 1,
    allowed_symbols: null, strategy_hash: "hash-1",
    ...fixtureDaSessao.viva,
  }),
}));
vi.mock("@/lib/autopilot/certificado", () => ({ certificadoVivo: async () => null }));
vi.mock("@/lib/autopilot/regime", () => ({ regimeDaBase: async () => "TRENDING_UP" }));
vi.mock("@/lib/autopilot/politica", () => ({
  avaliarDecisaoDeEstrategia: () => ({
    permite: true, versao: 1, tetoEfetivoUsd: 1_000, certificadoId: null,
  }),
}));
vi.mock("@/lib/cex/conexoes", () => ({
  conexaoParaExecucao: async () => {
    if (estado.aptidao === "current") return { ok: true, conexao: { id: "C1" } };
    return { ok: false, motivo: estado.aptidao === "retired" ? "substituida" : estado.aptidao };
  },
  decifrarConexao: () => credenciais.A,
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
}));
vi.mock("@/lib/autopilot/projecao-de-posicao", () => ({
  projetarEfeitoDoIntent: async () => ({
    ok: true, motivo: "aplicado", aplicadoQty: 0, aplicadoQuote: 0,
    custoRemovido: 0, fechou: false,
  }),
}));

import { POST } from "@/app/api/cex/order/route";

function req(): NextRequest {
  return new NextRequest("http://localhost/api/cex/order", {
    method: "POST",
    body: JSON.stringify({
      exchange: "binance", symbol: "BTC/USDT", side: "sell", type: "market",
      amount: 1, confirm: "I-CONFIRM-REAL-ORDER", autopilot: true, maxNotionalUsd: 1_000,
      apiKey: credenciais.B.apiKey, apiSecret: credenciais.B.apiSecret,
    }),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  bancoAtual = bancoFalso();
  estado.conexaoId = "C1";
  estado.aptidao = "current";
  spies.enviar.mockClear();
});

describe("A127.9/A127.11 — browser snapshot e credential binding", () => {
  it("S1→C1/A + body B: intent grava S1/C1 e side effect usa A, nunca B", async () => {
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(bancoAtual!.intents).toHaveLength(1);
    const intent = bancoAtual!.intents[0] as unknown as IntentRow;
    expect(intent.session_id).toBe("S1");
    expect(intent.conexao_id).toBe("C1");
    expect(intent.origin).toBe("autopilot_browser");

    expect(spies.enviar).toHaveBeenCalledTimes(1);
    const creds = spies.enviar.mock.calls[0]![1];
    expect(creds.apiKey).toBe(credenciais.A.apiKey);
    expect(creds.apiSecret).toBe(credenciais.A.apiSecret);
    expect(creds.apiKey).not.toBe(credenciais.B.apiKey);
  });

  it("browser real sem conexao_id: recusa antes de intent e createOrder", async () => {
    /**
     * ⚠️ O A130 PASSOU A RECUSAR ISTO UMA CAMADA ANTES, e melhor: a
     * autorização da sessão roda ANTES do cofre, então a credencial nem chega
     * a ser decifrada. A substância do A127 não mudou — zero intent, zero
     * createOrder — e o MOTIVO continua nomeando a conexão ausente, agora
     * dentro do envelope da autorização.
     *
     * A asserção fixa as duas coisas de propósito: se alguém trocar o envelope
     * sem preservar o motivo, ou preservar o motivo e deixar a ordem sair,
     * este teste acusa.
     */
    estado.conexaoId = null;
    const r = await POST(req());
    expect(r.status).not.toBe(200);
    const corpo = await r.json();
    expect(corpo.error).toBe("sessao_nao_autorizada");
    expect(corpo.motivo).toBe("conexao_ausente");
    expect(bancoAtual!.intents).toHaveLength(0);
    expect(spies.enviar).not.toHaveBeenCalled();
  });

  it.each(["retired", "revoked"] as const)("browser %s: zero intent e zero createOrder", async (modo) => {
    estado.aptidao = modo;
    const r = await POST(req());
    expect(r.status).not.toBe(200);
    expect(bancoAtual!.intents).toHaveLength(0);
    expect(spies.enviar).not.toHaveBeenCalled();
  });
});
