/**
 * AUDITORIA EXTERNA (14/09, 2ª rodada) — A33: "modo de listagem entrega payload
 * executável sem consultar kill-switch".
 *
 * Fonte original recuperada da sessão local do auditor (`quote-killswitch-list.
 * test.ts`): com o swap desligado, `mode=quote` devolvia 503, e `mode=list` com
 * `taker` devolvia 200 com calldata firme do 0x — sem nem consultar a guarda.
 *
 * Decisão do dono (15/10): a listagem continua READ-ONLY e disponível mesmo com
 * o swap desligado; o que sai dela é que não pode ser executável. `mode=quote`
 * é a ÚNICA superfície de preparação de execução e segue sob `disable_swap` e
 * `maintenance_mode`.
 *
 * INVARIANTE: NO EXECUTABLE PAYLOAD FROM LIST MODE — para qualquer fonte.
 *
 * A rota é a REAL. Os fornecedores são falsos e devolvem, de propósito, todo o
 * material executável que cada um entrega de verdade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ROUTER = "0x" + "a".repeat(40);
const SPENDER = "0x" + "d".repeat(40);
const EVM_TAKER = "0x" + "c".repeat(40);
const SOL_TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const s = vi.hoisted(() => ({
  flags: { disable_swap: false, maintenance_mode: false } as Record<string, boolean>,
  guard: vi.fn(),
  zxQuote: vi.fn(), zxPrice: vi.fn(), lifi: vi.fn(), jupQuote: vi.fn(), jupFirm: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: async () => ({ ok: true }), getClientId: () => "a33" }));
vi.mock("@/lib/admin/track", () => ({ recordEvent: vi.fn(async () => undefined), notifyTelegram: vi.fn(), logSecurity: vi.fn() }));
vi.mock("@/lib/admin/kill-switches", () => ({ checarKillSwitches: s.guard }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/tier/check", () => ({ getTierForWallet: async () => ({ tier: "free" }) }));
vi.mock("@/lib/api/zerox", async (orig) => ({ ...(await orig<typeof import("@/lib/api/zerox")>()), fetchZeroXQuote: s.zxQuote, fetchZeroXPrice: s.zxPrice }));
vi.mock("@/lib/api/lifi", async (orig) => ({ ...(await orig<typeof import("@/lib/api/lifi")>()), fetchLiFiQuote: s.lifi }));
vi.mock("@/lib/api/jupiter", async (orig) => ({ ...(await orig<typeof import("@/lib/api/jupiter")>()), fetchJupiterQuote: s.jupQuote, fetchJupiterFirm: s.jupFirm }));

import { GET } from "@/app/api/quote/route";

// ── O que cada fornecedor devolve de verdade (com o material executável) ──
const zxFirme = () => ({
  sellAmount: "1000000000000000000", buyAmount: "2500000000", minBuyAmount: "2487500000",
  route: { fills: [{ source: "Uniswap_V3", proportionBps: "10000" }] },
  transaction: { to: ROUTER, data: "0xdeadbeef" + "00".repeat(64), value: "1000000000000000000", gas: "210000", gasPrice: "1000000000" },
  issues: { allowance: { spender: SPENDER, actual: "0" } },
  permit2: { eip712: { domain: { name: "Permit2" }, message: { spender: SPENDER } } },
  totalNetworkFee: "210000000000000",
});
const zxPreco = () => { const q = zxFirme() as Record<string, unknown>; delete q.transaction; delete q.permit2; return q; };
const lifiQ = () => ({
  tool: "stargate", toolDetails: { name: "Stargate" },
  action: { fromChainId: 1, toChainId: 8453, toAddress: EVM_TAKER },
  estimate: { fromAmount: "1000000000", toAmount: "998000000", toAmountMin: "990000000", executionDuration: 180,
    approvalAddress: SPENDER, gasCosts: [{ amountUSD: "1.20" }], feeCosts: [] },
  includedSteps: [{ tool: "stargate", type: "cross", toolDetails: { name: "Stargate" } }],
  transactionRequest: { to: ROUTER, data: "0xcafebabe" + "11".repeat(64), value: "0", gasLimit: "400000", chainId: 1, from: EVM_TAKER },
});
const jupQ = () => ({
  inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "1000000000", outAmount: "104500000", otherAmountThreshold: "103977500", slippageBps: 50,
  routePlan: [{ percent: 100, swapInfo: { label: "Raydium", ammKey: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2" } }],
  contextSlot: 1, timeTaken: 0.01,
});
const jupSwap = () => ({ swapTransaction: "A".repeat(600) + "==", lastValidBlockHeight: 1 });

// ── O detector: allowlist do contrato + varredura profunda ────────────────
const CAMPOS_DA_LISTAGEM = new Set([
  "source", "label", "durationSec", "isCrossChain", "fromChainId", "toChainId",
  "sellAmount", "buyAmount", "minBuyAmount", "buyAmountUsd", "gasUsd",
  "routeSummary", "hops", "isFirm", "isIndicative",
]);
const CAMPOS_DO_HOP = new Set(["protocol", "share", "color"]);
const CHAVE_EXECUTAVEL = /^(raw|transaction|transactionRequest|tx|data|to|from|value|gas|gasLimit|gasPrice|permit|permit2|eip712|approval|approvalAddress|allowanceTarget|spender|issues|callData|calldata|encodedTransaction|swapTransaction|quoteResponse|routePlan|signature)$/i;
function executavel(v: unknown, caminho = "quote"): string[] {
  const achados: string[] = [];
  if (typeof v === "string") {
    if (/^0x[0-9a-fA-F]{8,}$/.test(v)) achados.push(`${caminho}: hex de calldata/endereço`);
    if (v.length > 100 && /^[A-Za-z0-9+/=]+$/.test(v)) achados.push(`${caminho}: blob base64 (transação serializada?)`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => achados.push(...executavel(x, `${caminho}[${i}]`)));
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (CHAVE_EXECUTAVEL.test(k)) achados.push(`${caminho}.${k}: chave executável`);
      achados.push(...executavel(x, `${caminho}.${k}`));
    }
  }
  return achados;
}
function semPayload(quotes: unknown[]) {
  expect(quotes.length, "a comparação tem de funcionar").toBeGreaterThan(0);
  for (const q of quotes as Record<string, unknown>[]) {
    expect(Object.keys(q).filter((k) => !CAMPOS_DA_LISTAGEM.has(k)), "campo fora do contrato da listagem").toEqual([]);
    for (const h of (q.hops as Record<string, unknown>[]) ?? []) {
      expect(Object.keys(h).filter((k) => !CAMPOS_DO_HOP.has(k))).toEqual([]);
    }
    expect(executavel(q)).toEqual([]);
  }
}

const pedir = (p: Record<string, string>) => GET(new NextRequest("http://localhost/api/quote?" + new URLSearchParams(p)));
const EVM = { fromChain: "ethereum", toChain: "ethereum", sellToken: "native", buyToken: "0x" + "b".repeat(40), sellAmount: "1000000000000000000" };
const CROSS = { fromChain: "ethereum", toChain: "base", sellToken: "0x" + "b".repeat(40), buyToken: "0x" + "e".repeat(40), sellAmount: "1000000000" };
const SOL = { fromChain: "solana", toChain: "solana", sellToken: "native", buyToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", sellAmount: "1000000000" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ZEROX_API_KEY", "synthetic-key");
  s.flags = { disable_swap: false, maintenance_mode: false };
  s.guard.mockImplementation(async (nomes: string[]) => {
    const ligado = nomes.find((n) => s.flags[n]);
    return ligado ? { bloqueado: true, motivo: ligado } : { bloqueado: false };
  });
  s.zxQuote.mockImplementation(async () => zxFirme());
  s.zxPrice.mockImplementation(async () => zxPreco());
  s.lifi.mockImplementation(async () => lifiQ());
  s.jupQuote.mockImplementation(async () => jupQ());
  s.jupFirm.mockImplementation(async () => ({ quote: jupQ(), swap: jupSwap() }));
});
afterEach(() => vi.unstubAllEnvs());

describe("A33 · NO EXECUTABLE PAYLOAD FROM LIST MODE", () => {
  it("A · list SEM taker: 200, compara, zero payload executável", async () => {
    const r = await pedir({ mode: "list", ...EVM });
    expect(r.status).toBe(200);
    semPayload((await r.json()).quotes);
  });

  it("B · list COM taker (o achado original): 200, compara, zero payload executável", async () => {
    const r = await pedir({ mode: "list", ...EVM, taker: EVM_TAKER });
    expect(r.status).toBe(200);
    const body = await r.json();
    semPayload(body.quotes);
    // A busca firme continua no servidor (valores exatos e `isFirm` para o CTA)…
    expect(s.zxQuote).toHaveBeenCalledOnce();
    expect(body.quotes[0].isFirm).toBe(true);
    // …mas nada dela atravessa a resposta.
    expect(JSON.stringify(body)).not.toContain("deadbeef");
    expect(JSON.stringify(body)).not.toContain(ROUTER.slice(2));
  });

  it("C · list com disable_swap ligado: descoberta continua, zero payload", async () => {
    s.flags.disable_swap = true;
    const r = await pedir({ mode: "list", ...EVM, taker: EVM_TAKER });
    expect(r.status).toBe(200);
    semPayload((await r.json()).quotes);
  });

  it("D · list com maintenance_mode ligado: read-only, zero payload", async () => {
    s.flags.maintenance_mode = true;
    const r = await pedir({ mode: "list", ...EVM, taker: EVM_TAKER });
    expect(r.status).toBe(200);
    semPayload((await r.json()).quotes);
  });

  it("E · quote com disable_swap ligado: bloqueado, fornecedor nem é chamado", async () => {
    s.flags.disable_swap = true;
    const r = await pedir({ mode: "quote", source: "0x", ...EVM, taker: EVM_TAKER });
    expect(r.status).toBe(503);
    expect((await r.json()).detail).toBe("disable_swap");
    expect(s.zxQuote).not.toHaveBeenCalled();
  });

  it("F · quote com maintenance_mode ligado: bloqueado", async () => {
    s.flags.maintenance_mode = true;
    const r = await pedir({ mode: "quote", source: "lifi", ...CROSS, taker: EVM_TAKER });
    expect(r.status).toBe(503);
    expect((await r.json()).detail).toBe("maintenance_mode");
    expect(s.lifi).not.toHaveBeenCalled();
  });

  it("F · a guarda do quote é consultada com a política 'usuario_confirma' (inalterada)", async () => {
    await pedir({ mode: "quote", source: "0x", ...EVM, taker: EVM_TAKER });
    expect(s.guard).toHaveBeenCalledWith(["disable_swap", "maintenance_mode"], "usuario_confirma");
  });

  it("G · quote com interruptores abertos: payload firme sai, nos três fornecedores", async () => {
    const zx = await (await pedir({ mode: "quote", source: "0x", ...EVM, taker: EVM_TAKER })).json();
    expect(zx.result.transaction.data).toMatch(/^0xdeadbeef/);
    const lf = await (await pedir({ mode: "quote", source: "lifi", ...CROSS, taker: EVM_TAKER })).json();
    expect(lf.result.transactionRequest.data).toMatch(/^0xcafebabe/);
    const jp = await (await pedir({ mode: "quote", source: "jupiter", ...SOL, taker: SOL_TAKER })).json();
    expect(jp.result.swap.swapTransaction.length).toBeGreaterThan(100);
  });

  it("H · 0x: list sem calldata, sem transaction, sem permit2, sem spender", async () => {
    const body = await (await pedir({ mode: "list", ...EVM, taker: EVM_TAKER })).json();
    const q = body.quotes.find((x: { source: string }) => x.source === "0x");
    expect(q).toBeDefined();
    semPayload([q]);
  });

  it("I · LiFi: list sem transactionRequest e sem approvalAddress", async () => {
    const body = await (await pedir({ mode: "list", ...CROSS, taker: EVM_TAKER })).json();
    const q = body.quotes.find((x: { source: string }) => x.source === "lifi");
    expect(q).toBeDefined();
    expect(q.isCrossChain).toBe(true);
    semPayload([q]);
  });

  it("J · Jupiter: list sem quoteResponse/routePlan (o insumo do /swap) e sem transação", async () => {
    const body = await (await pedir({ mode: "list", ...SOL, taker: SOL_TAKER })).json();
    const q = body.quotes.find((x: { source: string }) => x.source === "jupiter");
    expect(q).toBeDefined();
    semPayload([q]);
    expect(s.jupFirm).not.toHaveBeenCalled(); // L-062B: a lista nunca monta transação
  });

  it("a comparação continua: valores, rota e ranking chegam intactos", async () => {
    const body = await (await pedir({ mode: "list", ...EVM, taker: EVM_TAKER })).json();
    expect(body.quotes[0]).toMatchObject({
      source: "0x", sellAmount: "1000000000000000000", buyAmount: "2500000000", minBuyAmount: "2487500000",
      routeSummary: "Uniswap V3", isCrossChain: false, isIndicative: false,
    });
    expect(body.quotes[0].hops[0]).toMatchObject({ protocol: "Uniswap V3", share: 1 });
  });
});
