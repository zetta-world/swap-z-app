/**
 * ⚠️⚠️ A120 — O FINGERPRINT NASCE NA CRIAÇÃO DA ORDEM MANUAL REAL.
 *
 * Estes testes invocam o POST real de `/api/cex/order` com o EXECUTOR DE
 * VERDADE sobre banco e venue falsos:
 *
 *   · o intent gravado carrega `credential_fingerprint` = HMAC(env,
 *     exchange + NUL + apiKey) — sem vazar key/secret em resposta ou evento;
 *   · env ausente → 500 `server_configuration_error` ANTES do executor: zero
 *     intent, zero createOrder — manual real incapaz de vínculo não nasce;
 *   · `body.credentialFingerprint` é IGNORADO (quem apresenta o próprio
 *     fingerprint está se autoautorizando);
 *   · autopilot/DCA/simulado seguem SEM fingerprint (cofre/sessão).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { impressaoDaCredencial } from "@/lib/cex/fingerprint";
import type { RespostaDaVenue } from "@/lib/cex/execucao/venue-primitivo";
import type { IntentRow } from "@/lib/cex/execucao/intents";

const HMAC_DE_TESTE = "chave-hmac-criacao-a120-nao-e-real";

const espioes = vi.hoisted(() => ({
  enviarOrdemNaVenue: vi.fn(async (): Promise<RespostaDaVenue> => ({
    tipo: "aceita",
    ordem: { id: "EXT-1", filled: 0.01, average: 61_000, cost: 610,
             fee: { cost: 0.61, currency: "USDT" }, timestamp: Date.now() } as never,
  })),
  eventos: [] as Array<{ tipo: string; meta?: unknown }>,
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
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => bancoAtual?.cliente ?? null,
}));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: () => {}, logError: () => {},
  recordEvent: async (tipo: string, meta?: unknown) => {
    espioes.eventos.push({ tipo, meta });
  },
}));
vi.mock("@/lib/cex/execucao/venue-primitivo", () => ({
  enviarOrdemNaVenue: espioes.enviarOrdemNaVenue,
}));
// ── bordas do ramo do piloto (só exercitadas no teste de autopilot) ──────
vi.mock("@/lib/autopilot/liberacao", () => ({
  podeAutomatizar: async () => ({ permitido: true, causa: "aberto" }),
}));
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
    permite: true, versao: 1, tetoEfetivoUsd: 1_000, certificadoId: null,
  }),
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

import { POST } from "@/app/api/cex/order/route";

const BASE = {
  exchange: "binance", symbol: "BTC/USDT", side: "buy", type: "market",
  amount: 0.01, confirm: "I-CONFIRM-REAL-ORDER",
  apiKey: "AbCdefgh123", apiSecret: "s3gr3do-123",
};

function reqDe(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/cex/order", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function intentGravado(): IntentRow {
  expect(bancoAtual!.intents).toHaveLength(1);
  return bancoAtual!.intents[0] as unknown as IntentRow;
}

beforeEach(() => {
  process.env.CEX_RECOVERY_HMAC_KEY = HMAC_DE_TESTE;
  bancoAtual = bancoFalso();
  espioes.enviarOrdemNaVenue.mockClear();
  espioes.eventos.length = 0;
});

describe("A120 — criação: o fingerprint do manual REAL", () => {
  it("A120.1 ⚠️⚠️ grava o fingerprint no intent SEM vazar key/secret — nem na resposta, nem nos eventos", async () => {
    const res = await POST(reqDe({ ...BASE }));
    expect(res.status).toBe(200);

    // O vínculo gravado é EXATAMENTE o HMAC esperado…
    const intent = intentGravado();
    const esperado = impressaoDaCredencial("binance", BASE.apiKey);
    expect(intent.credential_fingerprint).toBe(esperado);
    // …e ele não contém a chave nem o segredo (HMAC, não concatenação).
    expect(String(intent.credential_fingerprint)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(intent.credential_fingerprint)).not.toContain(BASE.apiKey);
    expect(String(intent.credential_fingerprint)).not.toContain(BASE.apiSecret);

    // A resposta não carrega fingerprint nem credencial.
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain(esperado);
    expect(texto).not.toContain(BASE.apiKey);
    expect(texto).not.toContain(BASE.apiSecret);
    // Nem os eventos de auditoria.
    const eventos = JSON.stringify(espioes.eventos);
    expect(eventos).not.toContain(esperado);
    expect(eventos).not.toContain(BASE.apiKey);
    expect(eventos).not.toContain(BASE.apiSecret);
  });

  it("A120.6 ⚠️⚠️⚠️ env AUSENTE → 500 server_configuration_error ANTES do executor: zero intent, zero createOrder", async () => {
    delete process.env.CEX_RECOVERY_HMAC_KEY;
    const res = await POST(reqDe({ ...BASE }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("server_configuration_error");
    // NADA nasceu: nem o intent durável, muito menos a ordem na venue.
    expect(bancoAtual!.intents).toHaveLength(0);
    expect(espioes.enviarOrdemNaVenue).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ body.credentialFingerprint é IGNORADO — o gravado é o calculado no servidor", async () => {
    const forjado = "f".repeat(64);
    const res = await POST(reqDe({ ...BASE, credentialFingerprint: forjado }));
    expect(res.status).toBe(200);
    const intent = intentGravado();
    expect(intent.credential_fingerprint)
      .toBe(impressaoDaCredencial("binance", BASE.apiKey));
    expect(intent.credential_fingerprint).not.toBe(forjado);
  });

  it("⚠️⚠️ AUTOPILOT (sell, pela rota) nasce SEM fingerprint — a credencial dele está no cofre", async () => {
    const res = await POST(reqDe({
      ...BASE, side: "sell", autopilot: true, maxNotionalUsd: 1_000,
    }));
    expect(res.status).toBe(200);
    const intent = intentGravado();
    expect(intent.origin).toBe("autopilot_browser");
    expect(intent.credential_fingerprint).toBeNull();
    expect(espioes.enviarOrdemNaVenue).toHaveBeenCalledTimes(1);
  });

  it("⚠️ DCA/simulado (executor direto, sem ctx.credentialFingerprint) também nasce NULL", async () => {
    // O cron do DCA e o simulado chamam o executor sem o campo — o intent deles
    // fica desvinculado de propósito, e o recovery por intentId os fecha.
    const { executarOrdemCex } = await import("@/lib/cex/execucao/executor");
    const b = bancoFalso();
    const r = await executarOrdemCex(
      { db: b.cliente, killSwitches: async () => ({ bloqueado: false, motivo: null }) },
      { origin: "dca_cron", autonomous: true, planId: "p1", cycleNumber: 3 },
      { exchangeId: "binance", symbol: "BTC/USDT", side: "sell", type: "market",
        qty: 0.01, simulated: true, precoDeReferencia: 60_000 },
      null,
    );
    expect(r.desfecho).toBe("submetido");
    expect((b.intents[0] as unknown as IntentRow).credential_fingerprint).toBeNull();
  });
});
