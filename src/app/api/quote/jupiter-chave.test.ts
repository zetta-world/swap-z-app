/**
 * L-062A (16/10) — a ROTA REAL com o cliente Jupiter REAL; só a rede é falsa (Jupiter + RPC Solana).
 *
 * Prova, de ponta a ponta, que a chave não mexeu na taxa: escada 100/50/25/10 chega à cotação
 * autenticada, `feeAccount` chega ao `/swap` autenticado, conta de taxa inválida segue fail-open.
 * E que produção sem chave / chave recusada ficam VISÍVEIS (alerta) sem parar o swap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const CHAVE = "jup-chave-de-teste-rota-abcdef0123";
const SOL_TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DONO = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const CONTA_USDC = "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const s = vi.hoisted(() => ({
  tier: "free" as string,
  contaOk: true,
  jupStatus: 200,
  jup: [] as { url: string; headers: Headers; body?: string }[],
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: async () => ({ ok: true }), getClientId: () => "jk" }));
vi.mock("@/lib/admin/track", () => ({ recordEvent: vi.fn(async () => undefined), notifyTelegram: vi.fn(), logSecurity: vi.fn() }));
vi.mock("@/lib/admin/kill-switches", () => ({ checarKillSwitches: async () => ({ bloqueado: false }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ sub: SOL_TAKER, chain: "solana" }) }));
vi.mock("@/lib/tier/check", () => ({ getTierForWallet: async () => ({ tier: s.tier }) }));

import { GET } from "@/app/api/quote/route";
import { notifyTelegram } from "@/lib/admin/track";
import { _limparCacheDeContas } from "@/lib/solana/conta-de-taxa";

beforeEach(() => {
  vi.clearAllMocks();
  _limparCacheDeContas();
  s.tier = "free"; s.contaOk = true; s.jupStatus = 200; s.jup = [];
  vi.stubEnv("JUPITER_API_KEY", CHAVE);
  vi.stubEnv("JUPITER_BASE_URL", "");
  vi.stubEnv("LIFI_INTEGRATOR", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("jup.ag")) {
      const headers = new Headers(init?.headers);
      s.jup.push({ url: u, headers, body: init?.body ? String(init.body) : undefined });
      if (headers.has("x-api-key") && s.jupStatus !== 200) return new Response("denied", { status: s.jupStatus });
      if (u.includes("/quote")) {
        const fee = Number(new URL(u).searchParams.get("platformFeeBps") ?? 0);
        return Response.json({ inputMint: "So11111111111111111111111111111111111111112", outputMint: USDC,
          inAmount: "100000000", outAmount: "10476897", otherAmountThreshold: "10424512", swapMode: "ExactIn",
          slippageBps: 50, priceImpactPct: "0", routePlan: [{ percent: 100, swapInfo: { label: "Raydium" } }],
          platformFee: fee ? { amount: "1", feeBps: fee } : null });
      }
      return Response.json({ swapTransaction: "A".repeat(200), lastValidBlockHeight: 1 });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method === "getAccountInfo") {
      const value = s.contaOk ? { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        data: { parsed: { info: { mint: USDC, owner: DONO, state: "initialized" } } } } : null;
      return Response.json({ jsonrpc: "2.0", id: 1, result: { value } });
    }
    return new Response("?", { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const firme = () => GET(new NextRequest("http://localhost/api/quote?" + new URLSearchParams({
  mode: "quote", source: "jupiter", fromChain: "solana", toChain: "solana",
  sellToken: "native", buyToken: USDC, sellAmount: "100000000", taker: SOL_TAKER })));
const alertas = () => vi.mocked(notifyTelegram).mock.calls.map((c) => String(c[0]));

describe("H · escada da taxa inalterada, agora na API autenticada", () => {
  for (const [tier, bps] of [["free", 100], ["pro", 50], ["trader", 25], ["pilot", 10]] as const) {
    it(`${tier}: platformFeeBps=${bps} + feeAccount USDC, ambos em api.jup.ag com x-api-key`, async () => {
      s.tier = tier;
      const r = await firme();
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.taxa).toMatchObject({ bps });
      const [q, sw] = s.jup;
      expect(new URL(q.url).host).toBe("api.jup.ag");
      expect(new URL(q.url).searchParams.get("platformFeeBps")).toBe(String(bps));
      expect(new URL(sw.url).host).toBe("api.jup.ag");
      expect(JSON.parse(sw.body!)).toMatchObject({ feeAccount: CONTA_USDC });
      expect(s.jup.every((c) => c.headers.get("x-api-key") === CHAVE)).toBe(true);
      expect(JSON.stringify(body)).not.toContain(CHAVE);
    });
  }
});

describe("I · conta de taxa inválida continua fail-open", () => {
  it("conta fechada: swap 200 sem taxa, sem feeAccount, ainda autenticado", async () => {
    s.contaOk = false;
    const r = await firme();
    expect(r.status).toBe(200);
    expect((await r.json()).taxa).toMatchObject({ bps: 0 });
    expect(new URL(s.jup[0].url).searchParams.has("platformFeeBps")).toBe(false);
    expect(JSON.parse(s.jup[1].body!).feeAccount).toBeUndefined();
    expect(s.jup[0].headers.get("x-api-key")).toBe(CHAVE);
    expect(alertas().some((t) => t.includes("TAXA SOLANA"))).toBe(true);
  });
});

describe("visibilidade operacional", () => {
  it("produção SEM chave: swap segue pela lite-api E o dono é avisado", async () => {
    vi.stubEnv("JUPITER_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "production");
    const r = await firme();
    expect(r.status).toBe(200);
    expect(new URL(s.jup[0].url).host).toBe("lite-api.jup.ag");
    expect(alertas().some((t) => t.includes("sem JUPITER_API_KEY"))).toBe(true);
  });

  it("preview sem chave: lite-api, sem alarme de produção", async () => {
    vi.stubEnv("JUPITER_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    await firme();
    expect(new URL(s.jup[0].url).host).toBe("lite-api.jup.ag");
    expect(alertas().some((t) => t.includes("sem JUPITER_API_KEY"))).toBe(false);
  });

  it("produção COM chave: nenhum alarme de chave", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await firme();
    expect(alertas().some((t) => /JUPITER/.test(t))).toBe(false);
  });

  it("chave recusada (401): swap segue sem a chave, alerta sem o segredo", async () => {
    s.jupStatus = 401;
    const r = await firme();
    expect(r.status).toBe(200);
    expect(alertas().some((t) => t.includes("JUPITER_API_KEY recusada"))).toBe(true);
    expect(JSON.stringify(vi.mocked(notifyTelegram).mock.calls)).not.toContain(CHAVE);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(CHAVE);
  });

  it("chave + JUPITER_BASE_URL na lite-api: alerta de configuração incoerente", async () => {
    vi.stubEnv("JUPITER_BASE_URL", "https://lite-api.jup.ag/swap/v1");
    await firme();
    expect(new URL(s.jup[0].url).host).toBe("api.jup.ag");
    expect(alertas().some((t) => t.includes("JUPITER config"))).toBe(true);
  });
});
