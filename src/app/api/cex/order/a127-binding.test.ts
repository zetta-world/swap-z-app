/**
 * A127.9/A127.11 — browser Autopilot: snapshot + binding financeiro.
 *
 * S1→C1/A e body B jamais pode produzir intent C1 com side effect B.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import type { RespostaDaVenue } from "@/lib/cex/execucao/venue-primitivo";
import type { IntentRow } from "@/lib/cex/execucao/intents";

const credenciais = vi.hoisted(() => ({
  A: { apiKey: "VAULT-A-123456", apiSecret: "VAULT-SECRET-A-123456" },
  B: { apiKey: "BODY-B-1234567", apiSecret: "BODY-SECRET-B-123456" },
}));

const estado = vi.hoisted(() => ({
  conexaoId: "C1" as string | null,
  aptidao: "current" as "current" | "retired" | "revoked" | "ilegivel",
}));
const spies = vi.hoisted(() => ({
  enviar: vi.fn(async (): Promise<RespostaDaVenue> => ({
    tipo: "aceita", ordem: { id: "EXT-A127", filled: 0, status: "open" } as never,
  })),
}));
let bancoAtual: ReturnType<typeof bancoFalso> | null = null;

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
  getSessionStatus: async () => ({
    id: "S1", conexao_id: estado.conexaoId,
    strategy_id: "estrat-1", strategy_version: 1,
    allowed_symbols: null, strategy_hash: "hash-1",
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
    const creds = spies.enviar.mock.calls[0][1] as typeof credenciais.A;
    expect(creds.apiKey).toBe(credenciais.A.apiKey);
    expect(creds.apiSecret).toBe(credenciais.A.apiSecret);
    expect(creds.apiKey).not.toBe(credenciais.B.apiKey);
  });

  it("browser real sem conexao_id: recusa antes de intent e createOrder", async () => {
    estado.conexaoId = null;
    const r = await POST(req());
    expect(r.status).not.toBe(200);
    expect((await r.json()).error).toBe("conexao_ausente");
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
