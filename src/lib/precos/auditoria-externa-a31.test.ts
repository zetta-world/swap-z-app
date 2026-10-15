/**
 * AUDITORIA EXTERNA (14/09, 2ª rodada) — A31: "consulta de preços altera a
 * identidade dos tokens Solana".
 *
 * Fonte original recuperada da sessão local do auditor (ver
 * `docs/AUDIT-RECONCILIATION.md` §4.1). Endereço Solana é base58: o case É a
 * identidade (bytes diferentes). EVM é hex: o case é só apresentação (checksum).
 *
 * Os casos passam pelo código REAL: rota `/api/prices`, chave do cliente,
 * GeckoTerminal e o vigia de ordens — este último de ponta a ponta contra a
 * própria rota. O fornecedor é falso e só reconhece o endereço EXATO.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bs58 from "bs58";

vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: async () => ({ ok: true }), getClientId: () => "a31" }));

import { GET } from "@/app/api/prices/route";
import { tokenPriceKey } from "@/lib/hooks/useTokenPrices";
import { getTokenInfo } from "@/lib/api/geckoterminal";
import { findToken, DEFAULT_TOKENS } from "@/lib/tokens";

const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

/** Fornecedor que, como a GeckoTerminal real, só acha o mint Solana pelo case exato. */
function fornecedor(precos: Record<string, number>) {
  const pedidos: string[] = [];
  const conhecido = (a: string) => {
    for (const [k, v] of Object.entries(precos)) {
      if (k.startsWith("0x") ? k.toLowerCase() === a.toLowerCase() : k === a) return { k, v };
    }
    return null;
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    pedidos.push(url);
    if (url.includes("/tokens/multi/")) {
      const addrs = url.split("/tokens/multi/")[1].split(",");
      const data = addrs.map(conhecido).filter(Boolean).map((x) => ({
        // EVM volta minúsculo, Solana volta exato — como a API real.
        attributes: { address: x!.k.startsWith("0x") ? x!.k.toLowerCase() : x!.k, price_usd: String(x!.v) },
      }));
      return Response.json({ data });
    }
    const m = url.match(/\/tokens\/([^/?]+)$/);
    if (m) {
      const x = conhecido(m[1]);
      return x ? Response.json({ data: { attributes: { address: x.k, price_usd: String(x.v), name: "t", symbol: "T" } } })
        : new Response("not found", { status: 404 });
    }
    return new Response("?", { status: 404 });
  }));
  return pedidos;
}
const precosDaRota = async (tokens: string) =>
  (await (await GET(new NextRequest(`http://localhost/api/prices?tokens=${encodeURIComponent(tokens)}`))).json()).prices as Record<string, number | null>;

afterEach(() => vi.unstubAllGlobals());

describe("A31 · a identidade do mint Solana atravessa a consulta de preço", () => {
  it("os bytes mudam com o case: minúsculo é OUTRO endereço", () => {
    expect([...bs58.decode(USDC_SOL)]).not.toEqual([...bs58.decode(USDC_SOL.toLowerCase())]);
  });

  it("USDC Solana: a rota pede o mint EXATO e devolve o preço na chave do cliente", async () => {
    const pedidos = fornecedor({ [USDC_SOL]: 1 });
    const tok = findToken("solana", "USDC")!;
    const precos = await precosDaRota(tokenPriceKey(tok));
    expect(pedidos[0]).toContain(`/solana/tokens/multi/${USDC_SOL}`);
    expect(precos[tokenPriceKey(tok)]).toBe(1);
  });

  it("JUP e WIF (mints reais) também", async () => {
    fornecedor({ [JUP]: 0.42, [WIF]: 0.9 });
    const jup = findToken("solana", "JUP")!, wif = findToken("solana", "WIF")!;
    const precos = await precosDaRota([tokenPriceKey(jup), tokenPriceKey(wif)].join(","));
    expect(precos[tokenPriceKey(jup)]).toBe(0.42);
    expect(precos[tokenPriceKey(wif)]).toBe(0.9);
  });

  it("a chave do cliente preserva o mint exatamente", () => {
    expect(tokenPriceKey(findToken("solana", "USDC")!)).toBe(`solana:${USDC_SOL}`);
  });

  it("controle EVM: checksum vira minúsculo no pedido e na chave, e o preço chega", async () => {
    const pedidos = fornecedor({ [USDC_ETH]: 1.001 });
    const tok = findToken("ethereum", "USDC")!;
    expect(tokenPriceKey(tok)).toBe(`ethereum:${USDC_ETH.toLowerCase()}`);
    const precos = await precosDaRota(tokenPriceKey(tok));
    expect(pedidos[0]).toContain(USDC_ETH.toLowerCase());
    expect(precos[tokenPriceKey(tok)]).toBe(1.001);
  });

  it("lote misto (Solana + EVM + nativo) num pedido só", async () => {
    fornecedor({ [USDC_SOL]: 1, [USDC_ETH]: 1.001 });
    vi.mocked(fetch).mockImplementationOnce(async () => Response.json({ solana: { usd: 150 } })); // CoinGecko (nativos vêm primeiro)
    const sol = findToken("solana", "SOL")!, us = findToken("solana", "USDC")!, ue = findToken("ethereum", "USDC")!;
    const precos = await precosDaRota([sol, us, ue].map(tokenPriceKey).join(","));
    expect(precos[tokenPriceKey(sol)]).toBe(150);
    expect(precos[tokenPriceKey(us)]).toBe(1);
    expect(precos[tokenPriceKey(ue)]).toBe(1.001);
  });

  it("token sem cobertura e fornecedor fora do ar: null, nunca preço inventado", async () => {
    fornecedor({});
    const desconhecido = "So11111111111111111111111111111111111111112";
    expect((await precosDaRota(`solana:${desconhecido}`))[`solana:${desconhecido}`]).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("upstream down"); }));
    expect((await precosDaRota(`solana:${USDC_SOL}`))[`solana:${USDC_SOL}`]).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect((await precosDaRota(`solana:${USDC_SOL}`))[`solana:${USDC_SOL}`]).toBeNull();
  });

  it("⚠️ ida e volta para TODO token do registro: a chave que o cliente pede é a chave que a rota devolve", async () => {
    const contratos = DEFAULT_TOKENS.filter((t) => t.address !== "native" && t.chain !== "zetta");
    fornecedor(Object.fromEntries(contratos.map((t, i) => [t.address, i + 1])));
    for (const t of contratos) {
      const precos = await precosDaRota(tokenPriceKey(t));
      expect(Object.keys(precos), `${t.chain}:${t.symbol}`).toEqual([tokenPriceKey(t)]);
    }
  });

  it("GeckoTerminal (info do token, usada por /api/risk e ZION): mint Solana exato; EVM minúsculo", async () => {
    const pedidos = fornecedor({ [USDC_SOL]: 1, [USDC_ETH]: 1 });
    expect((await getTokenInfo("solana", USDC_SOL))?.priceUsd).toBe(1);
    expect(pedidos.at(-1)).toContain(`/tokens/${USDC_SOL}`);
    expect((await getTokenInfo("ethereum", USDC_ETH))?.priceUsd).toBe(1);
    expect(pedidos.at(-1)).toContain(`/tokens/${USDC_ETH.toLowerCase()}`);
  });
});

// ── O vigia de ordens, de ponta a ponta contra a rota real ────────────────
const w = vi.hoisted(() => ({ ordens: [] as unknown[], marcadas: [] as unknown[] }));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useEffect: (fn: () => void) => { fn(); },
  useRef: <T,>(v: T) => ({ current: v }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/lib/store/swap", () => ({ useSwap: () => ({
  setFromToken: vi.fn(), setToToken: vi.fn(), setAmountIn: vi.fn(), setSelectedSource: vi.fn(), setExecuteOpen: vi.fn(),
}) }));
vi.mock("@/lib/zion/orders", () => ({
  listPendingOrders: () => w.ordens,
  updatePendingOrder: (id: string, p: unknown) => { w.marcadas.push({ id, ...(p as object) }); },
}));
import { useOrderWatcher } from "@/lib/hooks/useOrderWatcher";

describe("A31 (mesma fronteira) · o vigia de ordens acha o preço de token com contrato", () => {
  beforeEach(() => { w.ordens = []; w.marcadas = []; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** Monta o vigia (o hook roda síncrono: `useEffect` está trocado por chamada direta). */
  function useMontarVigia(precos: Record<string, number>) {
    fornecedor(precos);
    const rota = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) =>
      url.startsWith("/api/prices") ? GET(new NextRequest(`http://localhost${url}`)) : rota(url, init)));
    useOrderWatcher();
  }
  async function primeiraPassada() {
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 20 && w.marcadas.length === 0; i++) await Promise.resolve();
  }

  it("venda-alvo de LINK (contrato EVM com checksum) dispara quando o preço passa do alvo", async () => {
    const link = findToken("ethereum", "LINK")!;
    w.ordens = [{ id: "o1", status: "pending", card: { kind: "sell_safe", chain: "ethereum", triggerPrice: "20",
      from: { symbol: "LINK" }, to: { symbol: "USDC" } } }];
    useMontarVigia({ [link.address]: 25 });
    await primeiraPassada();
    expect(w.marcadas).toEqual([expect.objectContaining({ id: "o1", status: "triggered" })]);
  });

  it("compra-limite de WIF (mint Solana) dispara quando o preço cai abaixo do alvo", async () => {
    w.ordens = [{ id: "o2", status: "pending", card: { kind: "buy_limit", chain: "solana", triggerPrice: "1",
      from: { symbol: "USDC" }, to: { symbol: "WIF" } } }];
    useMontarVigia({ [WIF]: 0.9 });
    await primeiraPassada();
    expect(w.marcadas).toEqual([expect.objectContaining({ id: "o2", status: "triggered" })]);
  });

  it("gêmea: preço do lado errado do alvo NÃO dispara", async () => {
    const link = findToken("ethereum", "LINK")!;
    w.ordens = [{ id: "o3", status: "pending", card: { kind: "sell_safe", chain: "ethereum", triggerPrice: "30",
      from: { symbol: "LINK" }, to: { symbol: "USDC" } } }];
    useMontarVigia({ [link.address]: 25 });
    await primeiraPassada();
    expect(w.marcadas).toEqual([]);
  });
});
