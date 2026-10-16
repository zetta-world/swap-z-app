/**
 * L-062A + L-062B (16/10) — a ROTA REAL com o cliente Jupiter REAL; só a rede é falsa (Jupiter
 * `/swap/v2/build` com a resposta REAL de 16/10, RPC Solana para conta de taxa e simulação).
 *
 * Prova, de ponta a ponta: escada 100/50/25/10 e `feeAccount` no MESMO `/build` autenticado;
 * transação montada por nós e aprovada pelo guard; taxa só divulgada quando a conta está na
 * instrução de swap; conta de taxa inválida segue fail-open; produção sem chave / chave recusada
 * ficam VISÍVEIS sem parar o swap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { VersionedTransaction } from "@solana/web3.js";
import fixture from "@/lib/api/__fixtures__/jupiter-build-20261016.json";
import { verifyJupiterTransaction } from "@/lib/swap/solana-guard";

const CHAVE = "jup-chave-de-teste-rota-abcdef0123";
const SOL_TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DONO = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const CONTA_USDC = "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const s = vi.hoisted(() => ({
  tier: "free" as string,
  contaOk: true,
  jupStatus: 200,
  /** Jupiter "ignora" a taxa: devolve a resposta sem o feeAccount na instrução. */
  jupIgnoraTaxa: false,
  jup: [] as { url: string; headers: Headers }[],
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
  s.tier = "free"; s.contaOk = true; s.jupStatus = 200; s.jupIgnoraTaxa = false; s.jup = [];
  vi.stubEnv("JUPITER_API_KEY", CHAVE);
  vi.stubEnv("JUPITER_BASE_URL", "");
  vi.stubEnv("LIFI_INTEGRATOR", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("jup.ag")) {
      const headers = new Headers(init?.headers);
      s.jup.push({ url: u, headers });
      if (headers.has("x-api-key") && s.jupStatus !== 200) return new Response("denied", { status: s.jupStatus });
      const comTaxa = new URL(u).searchParams.has("platformFeeBps") && !s.jupIgnoraTaxa;
      return Response.json(comTaxa ? fixture.com_taxa_100bps_feeAccount_En1J8 : fixture.sem_taxa);
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method === "getAccountInfo") {
      const value = s.contaOk ? { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        data: { parsed: { info: { mint: USDC, owner: DONO, state: "initialized" } } } } : null;
      return Response.json({ jsonrpc: "2.0", id: 1, result: { value } });
    }
    if (body.method === "simulateTransaction") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: { value: { err: null, unitsConsumed: 150_000 } } });
    }
    return new Response("?", { status: 404 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const firme = () => GET(new NextRequest("http://localhost/api/quote?" + new URLSearchParams({
  mode: "quote", source: "jupiter", fromChain: "solana", toChain: "solana",
  sellToken: "native", buyToken: USDC, sellAmount: "100000000", taker: SOL_TAKER })));
const lista = (comTaker = true) => GET(new NextRequest("http://localhost/api/quote?" + new URLSearchParams({
  mode: "list", fromChain: "solana", toChain: "solana", sellToken: "native", buyToken: USDC, sellAmount: "100000000",
  ...(comTaker ? { taker: SOL_TAKER } : {}) })));
const alertas = () => vi.mocked(notifyTelegram).mock.calls.map((c) => String(c[0]));

describe("H · escada da taxa inalterada, num único /build autenticado", () => {
  for (const [tier, bps] of [["free", 100], ["pro", 50], ["trader", 25], ["pilot", 10]] as const) {
    it(`${tier}: platformFeeBps=${bps} + feeAccount USDC no mesmo /build (api.jup.ag/swap/v2, x-api-key)`, async () => {
      s.tier = tier;
      const r = await firme();
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.taxa).toMatchObject({ bps });
      expect(s.jup).toHaveLength(1); // antes: /quote + /swap
      const p = new URL(s.jup[0].url);
      expect(p.host + p.pathname).toBe("api.jup.ag/swap/v2/build");
      expect(p.searchParams.get("platformFeeBps")).toBe(String(bps));
      expect(p.searchParams.get("feeAccount")).toBe(CONTA_USDC);
      expect(p.searchParams.get("taker")).toBe(SOL_TAKER);
      expect(s.jup[0].headers.get("x-api-key")).toBe(CHAVE);
      expect(body.result.quote.platformFee).toEqual({ feeBps: bps, feeAccount: CONTA_USDC });
      expect(JSON.stringify(body)).not.toContain(CHAVE);
    });
  }

  it("a transação devolvida ao navegador é v0, do taker, e o guard Solana a aprova", async () => {
    const body = await (await firme()).json();
    const tx = VersionedTransaction.deserialize(Buffer.from(body.result.swap.swapTransaction, "base64"));
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(SOL_TAKER);
    expect(verifyJupiterTransaction(tx).ok).toBe(true);
    expect(body.result.swap.lastValidBlockHeight).toBe(fixture.com_taxa_100bps_feeAccount_En1J8.blockhashWithMetadata.lastValidBlockHeight);
  });
});

describe("⚠️ taxa só é divulgada quando está na instrução", () => {
  it("firme: Jupiter ignorou a taxa → tela diz 0% e o dono recebe TAXA NÃO RETIDA (swap segue)", async () => {
    s.jupIgnoraTaxa = true;
    const r = await firme();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.taxa).toMatchObject({ bps: 0 });
    expect(body.result.quote.platformFee).toBeUndefined();
    expect(alertas().some((t) => t.includes("TAXA NÃO RETIDA"))).toBe(true);
  });

  it("lista: idem — taxa divulgada 0 quando a Jupiter não pôs a conta", async () => {
    s.jupIgnoraTaxa = true;
    expect((await (await lista()).json()).taxa).toMatchObject({ bps: 0 });
  });

  it("lista com taxa confirmada: 100, sem nada executável", async () => {
    const body = await (await lista()).json();
    expect(body.taxa).toMatchObject({ bps: 100 });
    expect(JSON.stringify(body.quotes)).not.toMatch(/swapTransaction|swapInstruction|routePlan|platformFee|feeAccount/);
  });

  it("lista SEM carteira: cota com a carteira de taxa da plataforma como taker", async () => {
    const r = await lista(false);
    expect(r.status).toBe(200);
    expect(new URL(s.jup[0].url).searchParams.get("taker")).toBe(DONO);
  });
});

describe("I · conta de taxa inválida continua fail-open", () => {
  it("conta fechada: swap 200 sem taxa, sem feeAccount, ainda autenticado", async () => {
    s.contaOk = false;
    const r = await firme();
    expect(r.status).toBe(200);
    expect((await r.json()).taxa).toMatchObject({ bps: 0 });
    const p = new URL(s.jup[0].url).searchParams;
    expect(p.has("platformFeeBps")).toBe(false);
    expect(p.has("feeAccount")).toBe(false);
    expect(s.jup[0].headers.get("x-api-key")).toBe(CHAVE);
    expect(alertas().some((t) => t.includes("TAXA SOLANA"))).toBe(true);
    expect(alertas().some((t) => t.includes("TAXA NÃO RETIDA"))).toBe(false);
  });
});

describe("visibilidade operacional", () => {
  it("produção SEM chave: swap segue em api.jup.ag sem header E o dono é avisado", async () => {
    vi.stubEnv("JUPITER_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "production");
    const r = await firme();
    expect(r.status).toBe(200);
    expect(new URL(s.jup[0].url).host).toBe("api.jup.ag");
    expect(s.jup[0].headers.has("x-api-key")).toBe(false);
    expect(alertas().some((t) => t.includes("sem JUPITER_API_KEY"))).toBe(true);
  });

  it("preview sem chave: sem alarme de produção", async () => {
    vi.stubEnv("JUPITER_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    await firme();
    expect(alertas().some((t) => t.includes("sem JUPITER_API_KEY"))).toBe(false);
  });

  it("produção COM chave: nenhum alarme Jupiter", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await firme();
    expect(alertas().some((t) => /JUPITER|TAXA/.test(t))).toBe(false);
  });

  it("chave recusada (401): swap segue sem a chave, alerta sem o segredo", async () => {
    s.jupStatus = 401;
    const r = await firme();
    expect(r.status).toBe(200);
    expect(alertas().some((t) => t.includes("JUPITER_API_KEY recusada"))).toBe(true);
    expect(JSON.stringify(vi.mocked(notifyTelegram).mock.calls)).not.toContain(CHAVE);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(CHAVE);
  });

  it("JUPITER_BASE_URL na lite-api: ignorada + alerta de configuração", async () => {
    vi.stubEnv("JUPITER_BASE_URL", "https://lite-api.jup.ag/swap/v1");
    await firme();
    expect(new URL(s.jup[0].url).host).toBe("api.jup.ag");
    expect(alertas().some((t) => t.includes("JUPITER config"))).toBe(true);
  });
});
