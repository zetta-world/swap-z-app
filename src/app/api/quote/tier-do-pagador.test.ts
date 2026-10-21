/**
 * W3-A (2ª auditoria, 21/10) — a TARIFA É DE QUEM PAGA.
 *
 * Defeito: `tierDoCotante()` usava a carteira da SESSÃO (cookie) e ignorava o `taker` (pagador).
 * Sessão de A (Pilot, 10 bps) + cotação para B (sem plano) → B pagava 10 bps em vez de 100.
 * Regra: o plano da sessão só vale quando a sessão É o pagador; senão, política de não autenticado
 * (Free) até a carteira certa se autenticar. Sem `taker` (lista indicativa, nada a assinar) a tela
 * mostra o plano da sessão.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const A_SOL = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const B_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const A_EVM = "0x" + "a".repeat(40);
const B_EVM = "0x" + "b".repeat(40);
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DONO = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";

const s = vi.hoisted(() => ({
  sessao: null as null | { sub: string; chain: string },
  planos: {} as Record<string, string>,
  jup: [] as URL[], zx: [] as unknown[], lifi: [] as unknown[],
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: async () => ({ ok: true }), getClientId: () => "t" }));
vi.mock("@/lib/admin/track", () => ({ recordEvent: vi.fn(async () => undefined), notifyTelegram: vi.fn(), logSecurity: vi.fn() }));
vi.mock("@/lib/admin/kill-switches", () => ({ checarKillSwitches: async () => ({ bloqueado: false }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => s.sessao }));
vi.mock("@/lib/tier/check", () => ({ getTierForWallet: async (w: string) => ({ tier: s.planos[w] ?? "free" }) }));
vi.mock("@/lib/api/jupiter", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/jupiter")>()),
  fetchJupiterQuote: async (a: { platformFeeBps?: number }) => { s.jup.push(new URL("http://x/?b=" + (a.platformFeeBps ?? 0))); return {
    inputMint: "So11111111111111111111111111111111111111112", outputMint: USDC_SOL, inAmount: "1", outAmount: "1", otherAmountThreshold: "1",
    swapMode: "ExactIn", slippageBps: 50, priceImpactPct: "0", routePlan: [], ...(a.platformFeeBps ? { platformFee: { feeBps: a.platformFeeBps, feeAccount: "x" } } : {}) }; },
}));
vi.mock("@/lib/api/zerox", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/zerox")>()),
  fetchZeroXQuote: async (a: unknown) => { s.zx.push(a); throw new Error("sem rede no teste"); },
  fetchZeroXPrice: async (a: unknown) => { s.zx.push(a); throw new Error("sem rede no teste"); },
}));
vi.mock("@/lib/api/lifi", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/lifi")>()),
  fetchLiFiQuote: async (a: unknown) => { s.lifi.push(a); throw new Error("sem rede no teste"); },
}));

import { GET } from "@/app/api/quote/route";

beforeEach(() => {
  s.sessao = null; s.planos = { [A_SOL]: "pilot", [A_EVM]: "pilot" }; s.jup = []; s.zx = []; s.lifi = [];
  vi.stubEnv("ZEROX_API_KEY", "k"); vi.stubEnv("LIFI_INTEGRATOR", "zswap");
  vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "info").mockImplementation(() => {});
  // RPC: conta de taxa USDC/wSOL existe (para a Solana poder cobrar)
  vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body ?? "{}"));
    const mint = b.params?.[0] === "7PPDQWck54V79XwgThz9hcPJQTwWbRT8aP4TV9iT5qFW" ? "So11111111111111111111111111111111111111112" : USDC_SOL;
    return Response.json({ jsonrpc: "2.0", id: 1, result: { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { info: { mint, owner: DONO, state: "initialized" } } } } } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const lista = (p: Record<string, string>) => GET(new NextRequest("http://localhost/api/quote?" + new URLSearchParams({ mode: "list", sellAmount: "100000000", ...p })));
const SOL = (taker?: string) => ({ fromChain: "solana", toChain: "solana", sellToken: "native", buyToken: USDC_SOL, ...(taker ? { taker } : {}) });
const EVM = (taker: string) => ({ fromChain: "ethereum", toChain: "ethereum", sellToken: "native", buyToken: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", taker });
const CROSS = (taker: string) => ({ fromChain: "ethereum", toChain: "arbitrum", sellToken: "native", buyToken: "native", taker });

describe("⚠️⚠️ W3-A: a tarifa é a do PAGADOR, nunca a da sessão de outra carteira", () => {
  it("contraprova: sessão de A (Pilot) + cotação para B (sem plano) na Solana → B paga 100 bps (Free), não 10", async () => {
    s.sessao = { sub: A_SOL, chain: "solana" };
    const body = await (await lista(SOL(B_SOL))).json();
    expect(body.taxa).toMatchObject({ tier: "free", bps: 100 });
    expect(s.jup[0].searchParams.get("b")).toBe("100");
  });

  it("sessão de A + cotação para A → Pilot (10 bps)", async () => {
    s.sessao = { sub: A_SOL, chain: "solana" };
    expect((await (await lista(SOL(A_SOL))).json()).taxa).toMatchObject({ tier: "pilot", bps: 10 });
  });

  it("EVM: sessão de A (0x Pilot) + taker B → Free; sessão em caixa mista (checksum) e taker em minúsculas = mesma carteira", async () => {
    s.sessao = { sub: A_EVM, chain: "evm" };
    expect((await (await lista(EVM(B_EVM))).json()).taxa).toMatchObject({ tier: "free", bps: 100 });
    const CHECKSUM = "0x" + "A".repeat(40);
    s.planos[CHECKSUM] = "pilot";
    s.sessao = { sub: CHECKSUM, chain: "evm" };            // sessão gravada com caixa mista
    expect((await (await lista(EVM(A_EVM))).json()).taxa).toMatchObject({ tier: "pilot", bps: 10 });
  });

  it("⚠️ duas carteiras conectadas: sessão Solana (Pilot) + swap EVM com a 0x → Free (a sessão não é o pagador)", async () => {
    s.sessao = { sub: A_SOL, chain: "solana" };
    expect((await (await lista(EVM(A_EVM))).json()).taxa).toMatchObject({ tier: "free", bps: 100 });
  });

  it("LI.FI (cross-chain): o pagador é o taker da origem — sessão de A + taker B → Free", async () => {
    s.sessao = { sub: A_EVM, chain: "evm" };
    const body = await (await lista(CROSS(B_EVM))).json();
    expect(body.taxa).toMatchObject({ tier: "free", bps: 100 });
  });

  it("sem sessão (logout / sessão expirada) → Free para qualquer pagador", async () => {
    expect((await (await lista(SOL(A_SOL))).json()).taxa).toMatchObject({ tier: "free", bps: 100 });
  });

  it("troca de conta: sessão ainda de A, carteira agora B → Free até B se autenticar", async () => {
    s.sessao = { sub: A_SOL, chain: "solana" };
    expect((await (await lista(SOL(B_SOL))).json()).taxa.tier).toBe("free");
    s.sessao = { sub: B_SOL, chain: "solana" };   // B autenticou
    s.planos[B_SOL] = "trader";
    expect((await (await lista(SOL(B_SOL))).json()).taxa).toMatchObject({ tier: "trader", bps: 25 });
  });

  it("lista SEM taker (nada a assinar): mostra o plano da sessão, só informativo", async () => {
    s.sessao = { sub: A_SOL, chain: "solana" };
    expect((await (await lista(SOL())).json()).taxa.tier).toBe("pilot");
  });
});
