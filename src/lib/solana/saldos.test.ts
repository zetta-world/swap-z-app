/**
 * W1 (20/10) — leitura de saldo Solana NO SERVIDOR + rota `/api/solana/saldo`.
 *
 * Causa raiz medida em 20/10: o RPC público responde 403 a toda chamada com `Origin` (navegador).
 * Aqui o RPC é falso e responde como a rede real (`getBalance`, `getTokenAccountsByOwner` jsonParsed).
 * ⚠️ O ponto central: erro do fornecedor NUNCA vira saldo zero; zero só quando a rede disse zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ rl: true, rlGlobal: true }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitDurable: async (id: string) => ({ ok: id.endsWith(":global") ? s.rlGlobal : s.rl, retryAfter: 30, remaining: 0, resetAt: 0 }),
  getClientId: () => "ip-teste",
}));

import { _limparCacheDeSaldos, chaveValida, lerSaldoSolana } from "@/lib/solana/saldos";
import { GET } from "@/app/api/solana/saldo/route";

const RPC_SECRETO = "https://mainnet.helius-rpc.com/?api-key=SEGREDO-HELIUS-123";
const DONO = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const OUTRO = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

type Corpo = { method: string; params: unknown[] };
let pedidos: { url: string; headers: Headers; corpo: Corpo }[] = [];
let resposta: (c: Corpo) => Response | Promise<Response>;
const conta = (amount: string, programa = TOKEN, mint = USDC) => ({
  pubkey: "x", account: { owner: programa, data: { parsed: { info: { mint, owner: DONO, tokenAmount: { amount, decimals: 6 } } } } },
});
const ok = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

beforeEach(() => {
  _limparCacheDeSaldos();
  s.rl = true; s.rlGlobal = true;
  pedidos = [];
  vi.stubEnv("HELIUS_RPC_URL", RPC_SECRETO);
  resposta = (c) => c.method === "getBalance"
    ? ok({ context: { slot: 1 }, value: 251_905_070 })
    : ok({ context: { slot: 1 }, value: [conta("11501000")] });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body)) as Corpo;
    pedidos.push({ url: String(url), headers: new Headers(init?.headers), corpo });
    return resposta(corpo);
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("leitura no servidor · valores", () => {
  it("SOL positivo: lamports exatos, 9 casas, via getBalance no RPC do servidor (sem Origin)", async () => {
    const l = await lerSaldoSolana(DONO, "native");
    expect(l).toMatchObject({ ok: true, raw: "251905070", decimals: 9 });
    expect(pedidos[0].url).toBe(RPC_SECRETO);
    expect(pedidos[0].corpo).toMatchObject({ method: "getBalance", params: [DONO, { commitment: "confirmed" }] });
    expect(pedidos[0].headers.has("origin")).toBe(false);
  });

  it("SOL zero REAL (a rede respondeu 0) → ok, raw 0", async () => {
    resposta = () => ok({ context: { slot: 1 }, value: 0 });
    expect(await lerSaldoSolana(DONO, "native")).toMatchObject({ ok: true, raw: "0" });
  });

  it("USDC positivo: getTokenAccountsByOwner filtrado pelo MINT, jsonParsed", async () => {
    const l = await lerSaldoSolana(DONO, USDC);
    expect(l).toMatchObject({ ok: true, raw: "11501000", decimals: 6, contas: 1 });
    expect(pedidos[0].corpo).toMatchObject({ method: "getTokenAccountsByOwner",
      params: [DONO, { mint: USDC }, { commitment: "confirmed", encoding: "jsonParsed" }] });
  });

  it("USDC zero real (conta existe com 0) e conta inexistente (nenhuma) → ok, raw 0 — a rede respondeu", async () => {
    resposta = () => ok({ context: { slot: 1 }, value: [conta("0")] });
    expect(await lerSaldoSolana(DONO, USDC)).toMatchObject({ ok: true, raw: "0", contas: 1 });
    _limparCacheDeSaldos();
    resposta = () => ok({ context: { slot: 1 }, value: [] });
    expect(await lerSaldoSolana(DONO, USDC)).toMatchObject({ ok: true, raw: "0", contas: 0, decimals: null });
  });

  it("múltiplas contas do mesmo mint (inclusive Token-2022) são SOMADAS em inteiro, sem perder precisão", async () => {
    resposta = () => ok({ context: { slot: 1 }, value: [conta("18446744073709551615"), conta("1", TOKEN22), conta("5")] });
    expect(await lerSaldoSolana(DONO, USDC)).toMatchObject({ ok: true, raw: "18446744073709551621", contas: 3 });
  });

  it("conta de OUTRO mint na resposta → erro de resposta (não soma lixo)", async () => {
    resposta = () => ok({ context: { slot: 1 }, value: [conta("5", TOKEN, "So11111111111111111111111111111111111111112")] });
    expect(await lerSaldoSolana(DONO, USDC)).toMatchObject({ ok: false, tipo: "resposta" });
  });
});

describe("⚠️ falha do fornecedor nunca é zero", () => {
  for (const [rotulo, prep, tipo, transitorio] of [
    ["HTTP 403 (o que o RPC público faz com navegador)", () => new Response('{"error":{"code":403}}', { status: 403 }), "proibido", false],
    ["JSON-RPC erro 403 em HTTP 200", () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: 403, message: "Access forbidden" } }), "proibido", false],
    ["HTTP 429", () => new Response("too many", { status: 429 }), "limite", true],
    ["HTTP 500", () => new Response("x", { status: 500 }), "rpc", true],
    ["timeout", () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, "timeout", true],
    ["queda de conexão", () => { throw new TypeError("fetch failed"); }, "conexao", true],
    ["corpo ilegível", () => new Response("<html>", { status: 200 }), "resposta", false],
    ["valor não numérico", () => ok({ context: {}, value: "abc" }), "resposta", false],
  ] as const) {
    it(`${rotulo} → ok:false tipo=${tipo} transitorio=${transitorio}, sem raw`, async () => {
      resposta = prep as () => Response;
      const l = await lerSaldoSolana(DONO, "native");
      expect(l).toEqual({ ok: false, owner: DONO, mint: "native", tipo, transitorio });
      expect(JSON.stringify(l)).not.toContain("raw");
    });
  }

  it("recupera depois do erro (cache de erro é curto: 2 s)", async () => {
    resposta = () => new Response("x", { status: 429 });
    const t0 = Date.now();
    expect((await lerSaldoSolana(DONO, "native", t0)).ok).toBe(false);
    resposta = () => ok({ context: { slot: 2 }, value: 7 });
    expect((await lerSaldoSolana(DONO, "native", t0 + 3_000))).toMatchObject({ ok: true, raw: "7" });
  });
});

describe("cache e deduplicação", () => {
  it("duas leituras simultâneas do mesmo (dono, mint) → UMA chamada ao RPC", async () => {
    const [a, b] = await Promise.all([lerSaldoSolana(DONO, USDC), lerSaldoSolana(DONO, USDC)]);
    expect(a).toEqual(b);
    expect(pedidos).toHaveLength(1);
  });

  it("dentro de 10 s responde do cache; donos diferentes NUNCA compartilham", async () => {
    await lerSaldoSolana(DONO, "native");
    await lerSaldoSolana(DONO, "native");
    expect(pedidos).toHaveLength(1);
    const outro = await lerSaldoSolana(OUTRO, "native");
    expect(outro.owner).toBe(OUTRO);
    expect(pedidos).toHaveLength(2);
  });
});

describe("validação", () => {
  it("chaveValida: base58 de 32 bytes sim; lixo, vazio, 0x, curto não", () => {
    expect(chaveValida(DONO)).toBe(true);
    expect(chaveValida(USDC)).toBe(true);
    for (const v of ["", "0x" + "a".repeat(40), "abc", "O0Il" + "1".repeat(40), null, 42, DONO + "1"]) expect(chaveValida(v)).toBe(false);
  });
});

const pedir = (q: string) => GET(new NextRequest(`http://localhost/api/solana/saldo?${q}`));

describe("rota /api/solana/saldo", () => {
  it("200: só o número, como string inteira; sem cache compartilhado", async () => {
    const r = await pedir(`owner=${DONO}&mint=${USDC}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ ok: true, owner: DONO, mint: USDC, raw: "11501000", decimals: 6, contas: 1 });
  });

  it("mint ausente = SOL nativo", async () => {
    expect(await (await pedir(`owner=${DONO}`)).json()).toMatchObject({ mint: "native", raw: "251905070" });
  });

  it("400 para dono/mint inválidos — e NÃO chama o RPC", async () => {
    expect((await pedir("owner=0xabc")).status).toBe(400);
    expect((await pedir(`owner=${DONO}&mint=lixo`)).status).toBe(400);
    expect((await pedir("")).status).toBe(400);
    expect(pedidos).toHaveLength(0);
  });

  it("não é proxy: não existe parâmetro que escolha método ou RPC", async () => {
    await pedir(`owner=${DONO}&mint=native&method=sendTransaction&rpc=https://evil.example`);
    expect(pedidos.map((p) => p.corpo.method)).toEqual(["getBalance"]);
    expect(pedidos[0].url).toBe(RPC_SECRETO);
  });

  it("429 por IP e 503 no teto global — sem tocar o RPC", async () => {
    s.rl = false;
    const r = await pedir(`owner=${DONO}`);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("30");
    s.rl = true; s.rlGlobal = false;
    expect((await pedir(`owner=${DONO}`)).status).toBe(503);
    expect(pedidos).toHaveLength(0);
  });

  it("falha do fornecedor → 502 com o TIPO, sem raw; e a credencial não aparece em resposta nem log", async () => {
    resposta = () => new Response(`forbidden ${RPC_SECRETO}`, { status: 403 });
    const r = await pedir(`owner=${DONO}&mint=${USDC}`);
    expect(r.status).toBe(502);
    const corpo = await r.text();
    expect(JSON.parse(corpo)).toEqual({ ok: false, owner: DONO, mint: USDC, erro: "proibido", transitorio: false });
    expect(corpo).not.toContain("SEGREDO");
    expect(corpo).not.toContain("helius");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("SEGREDO");
  });
});
