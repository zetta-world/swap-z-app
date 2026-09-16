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
  getSessionStatus: async () => ({
    id: "sess-1", strategy_id: "estrat-1", strategy_version: 3,
    allowed_symbols: null, strategy_hash: "h-1",
  }),
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
      ...BASE, type: "market", amount: 0.01, autopilot: true, maxNotionalUsd: 1_000,
    }));
    expect(resp.status).toBe(200);
    expect(espioes.executarOrdemCex).toHaveBeenCalledTimes(1);
    const ordem = espioes.executarOrdemCex.mock.calls[0][2] as { notionalUsd?: number | null };
    // 0.01 BTC × 60.000 USD de referência = 600 — NUNCA null aqui: seria
    // "nocional não mensurável" na autorização final e o certificado com teto
    // seria recusado (o defeito medido pelo revisor).
    expect(ordem.notionalUsd).toBeCloseTo(600, 9);
  });

  it("ordem MANUAL market segue inalterada: notionalUsd null (e nunca 0)", async () => {
    const resp = await POST(reqDe({ ...BASE, type: "market", amount: 0.01 }));
    expect(resp.status).toBe(200);
    const ordem = espioes.executarOrdemCex.mock.calls[0][2] as { notionalUsd?: number | null };
    expect(ordem.notionalUsd).toBeNull();
  });

  it("piloto LIMIT com price: o nocional do pedido (amount × price) prevalece", async () => {
    const resp = await POST(reqDe({
      ...BASE, type: "limit", amount: 0.01, price: 59_000,
      autopilot: true, maxNotionalUsd: 1_000,
    }));
    expect(resp.status).toBe(200);
    const ordem = espioes.executarOrdemCex.mock.calls[0][2] as { notionalUsd?: number | null };
    expect(ordem.notionalUsd).toBeCloseTo(590, 9);
  });

  it("⚠️ guarda estrutural: a chamada do executor tem o fallback `?? notionalRealDoPiloto`", () => {
    // Âncora na linha da chamada — se o fallback sumir, o teste comportamental
    // acima já falha; esta trava impede um "conserto" que devolva 0 ou que
    // mande o nocional do piloto para a ordem manual.
    const fonte = readFileSync("src/app/api/cex/order/route.ts", "utf8");
    expect(fonte).toMatch(
      /notionalUsd:\s*\(typeof body\.price === "number" \? body\.amount \* body\.price : null\)\s*\?\? notionalRealDoPiloto/);
    expect(fonte).toMatch(/notionalRealDoPiloto = guard\.realNotionalUsd \?\? null/);
  });
});
