/**
 * LIFI-UPSTREAM-01 (15/10) — o LiFi não devolvia NENHUMA cotação desde a Fase 9.2 (`dfff405`, 10/08).
 *
 * Causa provada contra a API real (evidência `lifi-upstream-01-20261015/`): toda cotação levava
 * `fee` + `integrator=z-swap` + `referrer`, e o integrator nunca foi cadastrado no Partner Portal
 * do LiFi. A API recusa: HTTP 400, code 1011, *"Integrator "z-swap" is not configured for collecting
 * fees"*. A rota engolia o erro (lista → `null`; firme → `upstream_failed`), e o LiFi é a ÚNICA fonte
 * cross-chain: Bridge e swap entre redes ficaram sem rota.
 *
 * Decisão do dono (15/10): restaurar já, SEM taxa nas rotas LiFi, até existir um integrator
 * cadastrado (`LIFI_INTEGRATOR`). Sem ele, nada de `fee`, e a taxa DIVULGADA nessas rotas é 0 —
 * a tela não pode anunciar cobrança que não existe.
 *
 * A rota e a `fetchLiFiQuote` são as REAIS; o falso é só o servidor do LiFi, com a mesma regra.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TAKER = "0x" + "c".repeat(40);
const CADASTRADO = "zswap-portal";
const s = vi.hoisted(() => ({ pedidos: [] as URL[], zxPrice: vi.fn() }));

vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: async () => ({ ok: true }), getClientId: () => "lifi" }));
vi.mock("@/lib/admin/track", () => ({ recordEvent: vi.fn(async () => undefined), notifyTelegram: vi.fn(), logSecurity: vi.fn() }));
vi.mock("@/lib/admin/kill-switches", () => ({ checarKillSwitches: async () => ({ bloqueado: false }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/tier/check", () => ({ getTierForWallet: async () => ({ tier: "free" }) }));
vi.mock("@/lib/api/zerox", async (orig) => ({ ...(await orig<typeof import("@/lib/api/zerox")>()), fetchZeroXPrice: s.zxPrice }));

import { GET } from "@/app/api/quote/route";
import { fetchLiFiQuote, LIFI_NATIVE } from "@/lib/api/lifi";

/** O LiFi real: `fee` exige integrator, e integrator com `fee` tem de estar cadastrado no portal. */
function servidorLiFi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url);
    s.pedidos.push(u);
    const fee = u.searchParams.get("fee"), integ = u.searchParams.get("integrator");
    if (fee && !integ) return Response.json({ message: "Argument fee requires integrator to be set too.", code: 1011 }, { status: 400 });
    if (fee && integ !== CADASTRADO) {
      return Response.json({ message: `Integrator "${integ}" is not configured for collecting fees.`, code: 1011 }, { status: 400 });
    }
    return Response.json({
      tool: "stargate", toolDetails: { name: "Stargate" },
      action: { fromChainId: 1, toChainId: 42161, toAddress: u.searchParams.get("toAddress") },
      estimate: { fromAmount: "20000000000000000", toAmount: "19950000000000000", toAmountMin: "19850000000000000",
        executionDuration: 60, approvalAddress: "0x" + "d".repeat(40), gasCosts: [], feeCosts: [] },
      includedSteps: [{ tool: "stargate", type: "cross", toolDetails: { name: "Stargate" } }],
      transactionRequest: { to: "0x" + "a".repeat(40), data: "0xcafe" + "00".repeat(40), value: "20000000000000000" },
    });
  }));
}

const CROSS = { fromChain: "ethereum", toChain: "arbitrum", sellToken: "native", buyToken: "native", sellAmount: "20000000000000000", taker: TAKER };
const pedir = (p: Record<string, string>) => GET(new NextRequest("http://localhost/api/quote?" + new URLSearchParams(p)));

beforeEach(() => {
  vi.clearAllMocks();
  s.pedidos = [];
  vi.stubEnv("LIFI_INTEGRATOR", "");
  servidorLiFi();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("LIFI-UPSTREAM-01 · sem integrator cadastrado, o LiFi volta a cotar — sem taxa", () => {
  it("lista cross-chain devolve a cotação LiFi (era vazia)", async () => {
    const body = await (await pedir({ mode: "list", ...CROSS })).json();
    expect(body.quotes.map((q: { source: string }) => q.source)).toEqual(["lifi"]);
    expect(body.quotes[0].buyAmount).toBe("19950000000000000");
  });

  it("o pedido ao LiFi NÃO leva fee, integrator nem referrer", async () => {
    await pedir({ mode: "list", ...CROSS });
    const q = s.pedidos.at(-1)!.searchParams;
    expect(q.get("fee")).toBeNull();
    expect(q.get("integrator")).toBeNull();
    expect(q.get("referrer")).toBeNull();
  });

  it("⚠️ a taxa DIVULGADA nessas rotas é 0 (não se anuncia cobrança que não existe)", async () => {
    const lista = await (await pedir({ mode: "list", ...CROSS })).json();
    expect(lista.taxa).toMatchObject({ bps: 0, pct: 0 });
    const firme = await (await pedir({ mode: "quote", source: "lifi", ...CROSS })).json();
    expect(firme.taxa).toMatchObject({ bps: 0, pct: 0 });
  });

  it("cotação firme LiFi volta a funcionar (era upstream_failed)", async () => {
    const r = await pedir({ mode: "quote", source: "lifi", ...CROSS });
    expect(r.status).toBe(200);
    expect((await r.json()).result.transactionRequest.data).toMatch(/^0xcafe/);
  });

  it("A33 continua: a cotação LiFi da LISTA não carrega nada executável", async () => {
    const body = await (await pedir({ mode: "list", ...CROSS })).json();
    const txt = JSON.stringify(body.quotes);
    expect(txt).not.toMatch(/raw|transactionRequest|approvalAddress|cafe/);
  });
});

describe("LIFI-UPSTREAM-01 · com integrator cadastrado, a taxa volta sozinha", () => {
  beforeEach(() => vi.stubEnv("LIFI_INTEGRATOR", CADASTRADO));

  it("o pedido leva fee (fração) + o integrator cadastrado, e a cotação chega", async () => {
    const body = await (await pedir({ mode: "list", ...CROSS })).json();
    expect(body.quotes).toHaveLength(1);
    const q = s.pedidos.at(-1)!.searchParams;
    expect(q.get("fee")).toBe("0.01");            // free = 100 bps
    expect(q.get("integrator")).toBe(CADASTRADO);
    expect(body.taxa).toMatchObject({ bps: 100 });
  });

  it("⚠️ referrer NÃO é usado como destinatário da taxa (no LiFi ele é só rastreio)", async () => {
    await pedir({ mode: "list", ...CROSS });
    expect(s.pedidos.at(-1)!.searchParams.get("referrer")).toBeNull();
  });
});

describe("LIFI-UPSTREAM-01 · o resto da escada de taxa não muda", () => {
  it("swap na MESMA rede (0x) segue com a taxa do plano", async () => {
    s.zxPrice.mockResolvedValue({ sellAmount: "1", buyAmount: "2", minBuyAmount: "2", route: { fills: [] } });
    vi.stubEnv("ZEROX_API_KEY", "synthetic");
    const body = await (await pedir({ mode: "list", fromChain: "ethereum", toChain: "ethereum", sellToken: "native",
      buyToken: "0x" + "b".repeat(40), sellAmount: "1000" })).json();
    expect(body.taxa).toMatchObject({ bps: 100 });
    expect(s.zxPrice.mock.calls[0][0]).toMatchObject({ feeBps: 100 });
  });
});

describe("LIFI-UPSTREAM-01 · a própria `fetchLiFiQuote` (sem depender da rota zerar a taxa)", () => {
  const args = { fromChainId: 1, toChainId: 42161, fromToken: LIFI_NATIVE, toToken: LIFI_NATIVE,
    fromAmount: "20000000000000000", fromAddress: TAKER, feeBps: 100, feeRecipient: "0x" + "9".repeat(40) };

  it("taxa + destinatário SEM integrator: nenhum `fee` sai, e a cotação chega (era 400/1011)", async () => {
    const q = await fetchLiFiQuote(args);
    expect(q.estimate.toAmount).toBe("19950000000000000");
    const p = s.pedidos.at(-1)!.searchParams;
    expect(p.get("fee")).toBeNull();
    expect(p.get("integrator")).toBeNull();
    expect(p.get("referrer")).toBeNull();
  });

  it("com integrator cadastrado: `fee` em fração e o integrator informado", async () => {
    await fetchLiFiQuote({ ...args, integrator: CADASTRADO });
    const p = s.pedidos.at(-1)!.searchParams;
    expect(p.get("fee")).toBe("0.01");
    expect(p.get("integrator")).toBe(CADASTRADO);
  });

  it("feeBps 0 com integrator: sem `fee` (nada a cobrar)", async () => {
    await fetchLiFiQuote({ ...args, feeBps: 0, integrator: CADASTRADO });
    expect(s.pedidos.at(-1)!.searchParams.get("fee")).toBeNull();
  });
});

