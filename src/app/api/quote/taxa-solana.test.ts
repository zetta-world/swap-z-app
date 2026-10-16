/**
 * TAXA NA SOLANA (16/10, L-061) — decisão do dono: cobrar na Solana com a mesma escada das EVM.
 *
 * Jupiter (Metis `/swap/v1`): `platformFeeBps` na cotação + `feeAccount` no `/swap`, e o
 * `feeAccount` é CONTA DE TOKEN de um dos mints do par. Contas do dono (dona `H7zw…`):
 * USDC `En1J8…` e wSOL `7PPDQ…` (conferidas na rede 16/10; `off` desliga). Par sem USDC nem SOL → sem
 * taxa. A conta é conferida NA REDE antes de cobrar: ausente/fechada/RPC fora → sem taxa e o
 * swap segue (uma conta de taxa nunca pode quebrar um swap).
 *
 * A rota é a REAL; Jupiter, LI.FI e o RPC da Solana são falsos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SOL_TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM_TAKER = "0x" + "c".repeat(40);
const DONO = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const CONTA_USDC = "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo";
const CONTA_WSOL = "7PPDQWck54V79XwgThz9hcPJQTwWbRT8aP4TV9iT5qFW";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";

const s = vi.hoisted(() => ({
  jupQuote: vi.fn(), jupSwap: vi.fn(), lifi: vi.fn(),
  contas: {} as Record<string, { mint: string; owner: string; state: string } | null>,
  rpcFora: false,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: async () => ({ ok: true }), getClientId: () => "sol" }));
vi.mock("@/lib/admin/track", () => ({ recordEvent: vi.fn(async () => undefined), notifyTelegram: vi.fn(), logSecurity: vi.fn() }));
vi.mock("@/lib/admin/kill-switches", () => ({ checarKillSwitches: async () => ({ bloqueado: false }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/tier/check", () => ({ getTierForWallet: async () => ({ tier: "free" }) }));
vi.mock("@/lib/api/jupiter", async (orig) => ({ ...(await orig<typeof import("@/lib/api/jupiter")>()), fetchJupiterQuote: s.jupQuote, fetchJupiterSwap: s.jupSwap }));
vi.mock("@/lib/api/lifi", async (orig) => ({ ...(await orig<typeof import("@/lib/api/lifi")>()), fetchLiFiQuote: s.lifi }));

import { GET } from "@/app/api/quote/route";
import { notifyTelegram } from "@/lib/admin/track";
import { _limparCacheDeContas } from "@/lib/solana/conta-de-taxa";

/** RPC da Solana falso: `getAccountInfo` jsonParsed, como a rede real. */
function rpcFalso() {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method !== "getAccountInfo") return new Response("?", { status: 404 });
    if (s.rpcFora) throw new Error("rpc down");
    const c = s.contas[body.params[0]];
    const value = c ? { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      data: { parsed: { type: "account", info: { mint: c.mint, owner: c.owner, state: c.state } } } } : null;
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { value } });
  }));
}

const jupQ = (feeBps?: number) => ({
  inputMint: WSOL, outputMint: USDC, inAmount: "100000000", outAmount: "10476897", otherAmountThreshold: "10424512",
  slippageBps: 50, routePlan: [{ percent: 100, swapInfo: { label: "Raydium" } }],
  platformFee: feeBps ? { amount: "105827", feeBps } : null,
});
const pedir = (p: Record<string, string>) => GET(new NextRequest("http://localhost/api/quote?" + new URLSearchParams(p)));
const SOL_SOL = (sell: string, buy: string) => ({ fromChain: "solana", toChain: "solana", sellToken: sell, buyToken: buy, sellAmount: "100000000" });

beforeEach(() => {
  vi.clearAllMocks();
  _limparCacheDeContas();
  vi.stubEnv("LIFI_INTEGRATOR", "");
  s.rpcFora = false;
  s.contas = {
    [CONTA_USDC]: { mint: USDC, owner: DONO, state: "initialized" },
    [CONTA_WSOL]: { mint: WSOL, owner: DONO, state: "initialized" },
  };
  s.jupQuote.mockImplementation(async (a: { platformFeeBps?: number }) => jupQ(a.platformFeeBps));
  s.jupSwap.mockImplementation(async () => ({ swapTransaction: "A".repeat(200), lastValidBlockHeight: 1 }));
  s.lifi.mockImplementation(async () => ({
    tool: "x", action: { fromChainId: 1151111081099710, toChainId: 1, toAddress: EVM_TAKER },
    estimate: { fromAmount: "1", toAmount: "1", toAmountMin: "1", executionDuration: 60, approvalAddress: "", feeCosts: [] },
    includedSteps: [], transactionRequest: { to: "", data: "", value: "0" },
  }));
  rpcFalso();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Jupiter · cobra na Solana com a conta de USDC", () => {
  it("lista SOL→USDC: a cotação já pede a taxa do plano (valor líquido) e a tela divulga 1%", async () => {
    const body = await (await pedir({ mode: "list", ...SOL_SOL("native", USDC), taker: SOL_TAKER })).json();
    expect(s.jupQuote.mock.calls[0][0]).toMatchObject({ platformFeeBps: 100 });
    expect(body.taxa).toMatchObject({ bps: 100 });
    expect(body.quotes[0].buyAmount).toBe("10476897");
  });

  it("firme SOL→USDC: cotação com taxa E /swap com a conta de USDC — sempre os dois juntos", async () => {
    const body = await (await pedir({ mode: "quote", source: "jupiter", ...SOL_SOL("native", USDC), taker: SOL_TAKER })).json();
    expect(s.jupQuote.mock.calls[0][0]).toMatchObject({ platformFeeBps: 100 });
    expect(s.jupSwap.mock.calls[0][0]).toMatchObject({ feeAccount: CONTA_USDC });
    expect(body.taxa).toMatchObject({ bps: 100 });
  });

  it("USDC do lado de ENTRADA também serve (USDC→JUP)", async () => {
    await pedir({ mode: "quote", source: "jupiter", ...SOL_SOL(USDC, JUP), taker: SOL_TAKER });
    expect(s.jupSwap.mock.calls[0][0]).toMatchObject({ feeAccount: CONTA_USDC });
  });

  it("par sem USDC nem SOL (JUP→WIF): sem taxa, sem feeAccount, e a tela diz 0%", async () => {
    const body = await (await pedir({ mode: "quote", source: "jupiter", ...SOL_SOL(JUP, WIF), taker: SOL_TAKER })).json();
    expect(s.jupQuote.mock.calls[0][0].platformFeeBps ?? 0).toBe(0);
    expect(s.jupSwap.mock.calls[0][0].feeAccount).toBeUndefined();
    expect(body.taxa).toMatchObject({ bps: 0 });
  });
});

describe("Jupiter · SOL (wSOL)", () => {
  it("SOL→JUP com wSOL desligado (`off`): sem taxa", async () => {
    vi.stubEnv("SWAP_FEE_ACCOUNT_SOLANA_WSOL", "off");
    const body = await (await pedir({ mode: "list", ...SOL_SOL("native", JUP), taker: SOL_TAKER })).json();
    expect(s.jupQuote.mock.calls[0][0].platformFeeBps ?? 0).toBe(0);
    expect(body.taxa).toMatchObject({ bps: 0 });
  });

  it("SOL→JUP com a conta wSOL padrão (existente na rede): cobra em wSOL", async () => {
    await pedir({ mode: "quote", source: "jupiter", ...SOL_SOL("native", JUP), taker: SOL_TAKER });
    expect(s.jupQuote.mock.calls[0][0]).toMatchObject({ platformFeeBps: 100 });
    expect(s.jupSwap.mock.calls[0][0]).toMatchObject({ feeAccount: CONTA_WSOL });
  });
});

describe("⚠️ a conta de taxa nunca quebra um swap", () => {
  for (const [rotulo, prep] of [
    ["conta fechada (não existe mais na rede)", () => { s.contas[CONTA_USDC] = null; }],
    ["conta de OUTRO mint", () => { s.contas[CONTA_USDC] = { mint: WIF, owner: DONO, state: "initialized" }; }],
    ["conta de OUTRO dono", () => { s.contas[CONTA_USDC] = { mint: USDC, owner: SOL_TAKER, state: "initialized" }; }],
    ["conta congelada", () => { s.contas[CONTA_USDC] = { mint: USDC, owner: DONO, state: "frozen" }; }],
    ["RPC fora do ar", () => { s.rpcFora = true; }],
  ] as const) {
    it(`${rotulo}: swap segue SEM taxa, tela diz 0%, e o dono é avisado`, async () => {
      prep();
      const r = await pedir({ mode: "quote", source: "jupiter", ...SOL_SOL("native", USDC), taker: SOL_TAKER });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(s.jupQuote.mock.calls[0][0].platformFeeBps ?? 0).toBe(0);
      expect(s.jupSwap.mock.calls[0][0].feeAccount).toBeUndefined();
      expect(body.taxa).toMatchObject({ bps: 0 });
      expect(vi.mocked(notifyTelegram).mock.calls.some((c) => String(c[0]).includes("TAXA SOLANA"))).toBe(true);
    });
  }
});

describe("LI.FI saindo da Solana", () => {
  const CROSS = { fromChain: "solana", toChain: "ethereum", sellToken: "native", buyToken: "native", sellAmount: "100000000", taker: SOL_TAKER };
  it("com integrator cadastrado: taxa do plano pedida ao LI.FI", async () => {
    vi.stubEnv("LIFI_INTEGRATOR", "zswap");
    const body = await (await pedir({ mode: "list", ...CROSS })).json();
    expect(s.lifi.mock.calls[0][0]).toMatchObject({ feeBps: 100, integrator: "zswap" });
    expect(body.taxa).toMatchObject({ bps: 100 });
  });
  it("sem integrator: sem taxa (igual às EVM)", async () => {
    const body = await (await pedir({ mode: "list", ...CROSS })).json();
    expect(s.lifi.mock.calls[0][0].feeBps ?? 0).toBe(0);
    expect(body.taxa).toMatchObject({ bps: 0 });
  });
});

describe("A33 continua", () => {
  it("a lista Jupiter não expõe a conta de taxa nem nada executável", async () => {
    const body = await (await pedir({ mode: "list", ...SOL_SOL("native", USDC), taker: SOL_TAKER })).json();
    const txt = JSON.stringify(body.quotes);
    expect(txt).not.toContain(CONTA_USDC);
    expect(txt).not.toMatch(/raw|routePlan|swapTransaction|platformFee/);
  });
});
