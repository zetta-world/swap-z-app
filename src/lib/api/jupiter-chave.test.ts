/**
 * L-062A (16/10) — CHAVE DA JUPITER. Com `JUPITER_API_KEY`: host `api.jup.ag` + `x-api-key` em
 * toda chamada. Sem chave: `lite-api`, sem header. A chave só sai para `api.jup.ag`, nunca aparece
 * em erro, e uma chave recusada não para o swap (refaz sem ela, avisa).
 *
 * O `fetch` é falso: registra URL e headers de cada chamada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configJupiter, fetchJupiterQuote, fetchJupiterSwap, JupiterError, type JupQuote } from "@/lib/api/jupiter";

const CHAVE = "jup-chave-de-teste-0123456789abcdef";
type Chamada = { url: string; headers: Headers; body?: string };
let chamadas: Chamada[] = [];
let resposta: (c: Chamada) => Response | Promise<Response>;

const QUOTE = { inputMint: "a", outputMint: "b", inAmount: "1", outAmount: "1", otherAmountThreshold: "1",
  swapMode: "ExactIn", slippageBps: 50, priceImpactPct: "0", routePlan: [] } as unknown as JupQuote;
const ARGS = { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "1000" };

beforeEach(() => {
  chamadas = [];
  resposta = (c) => c.url.includes("/swap") && !c.url.includes("/quote")
    ? Response.json({ swapTransaction: "AA", lastValidBlockHeight: 1 })
    : Response.json(QUOTE);
  vi.stubEnv("JUPITER_API_KEY", "");
  vi.stubEnv("JUPITER_BASE_URL", "");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c = { url: String(url), headers: new Headers(init?.headers), body: init?.body ? String(init.body) : undefined };
    chamadas.push(c);
    return resposta(c);
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("A · chave presente → api.jup.ag + x-api-key", () => {
  it("quote e swap vão para api.jup.ag com a chave", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    await fetchJupiterQuote(ARGS);
    await fetchJupiterSwap({ quoteResponse: QUOTE, userPublicKey: "u" });
    expect(chamadas.map((c) => new URL(c.url).host)).toEqual(["api.jup.ag", "api.jup.ag"]);
    expect(chamadas[0].url.startsWith("https://api.jup.ag/swap/v1/quote?")).toBe(true);
    expect(chamadas[1].url).toBe("https://api.jup.ag/swap/v1/swap");
    expect(chamadas.every((c) => c.headers.get("x-api-key") === CHAVE)).toBe(true);
    expect(configJupiter().modo).toBe("autenticada");
  });

  it("sucesso também é registrado: modo autenticada, host api.jup.ag, sem a chave", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await fetchJupiterQuote(ARGS);
    const linha = JSON.stringify(info.mock.calls);
    expect(linha).toContain('\\"modo\\":\\"autenticada\\"');
    expect(linha).toContain('\\"tipo\\":\\"ok\\"');
    expect(linha).toContain("api.jup.ag");
    expect(linha).not.toContain(CHAVE);
  });

  it("sucesso sem chave é registrado como sem-chave", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await fetchJupiterQuote(ARGS);
    expect(JSON.stringify(info.mock.calls)).toContain('\\"modo\\":\\"sem-chave\\"');
  });

  it("chave com espaço em volta é aparada", async () => {
    vi.stubEnv("JUPITER_API_KEY", `  ${CHAVE}\n`);
    await fetchJupiterQuote(ARGS);
    expect(chamadas[0].headers.get("x-api-key")).toBe(CHAVE);
  });
});

describe("B · chave ausente → lite-api, sem header", () => {
  for (const v of ["", "   "]) {
    it(`JUPITER_API_KEY=${JSON.stringify(v)}: lite-api, modo sem-chave`, async () => {
      vi.stubEnv("JUPITER_API_KEY", v);
      await fetchJupiterQuote(ARGS);
      expect(new URL(chamadas[0].url).host).toBe("lite-api.jup.ag");
      expect(chamadas[0].headers.has("x-api-key")).toBe(false);
      expect(configJupiter()).toMatchObject({ modo: "sem-chave", incoerencia: null });
    });
  }
});

describe("JUPITER_BASE_URL × JUPITER_API_KEY — sem configuração incoerente silenciosa", () => {
  it("chave + base na lite-api → base ignorada, vai para api.jup.ag, incoerência registrada", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    vi.stubEnv("JUPITER_BASE_URL", "https://lite-api.jup.ag/swap/v1");
    await fetchJupiterQuote(ARGS);
    expect(new URL(chamadas[0].url).host).toBe("api.jup.ag");
    expect(configJupiter().incoerencia).toMatch(/ignorada/);
  });

  it("chave + base em OUTRO host (proxy) → a chave NUNCA sai para ele", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    vi.stubEnv("JUPITER_BASE_URL", "https://proxy.exemplo.com/swap/v1");
    await fetchJupiterQuote(ARGS);
    expect(new URL(chamadas[0].url).host).toBe("api.jup.ag");
    expect(configJupiter().incoerencia).not.toBeNull();
  });

  it("chave + base http://api.jup.ag (sem TLS) → ignorada", () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    vi.stubEnv("JUPITER_BASE_URL", "http://api.jup.ag/swap/v1");
    expect(configJupiter()).toMatchObject({ base: "https://api.jup.ag/swap/v1" });
    expect(configJupiter().incoerencia).not.toBeNull();
  });

  it("chave + base https://api.jup.ag/... → aceita (barra final removida), coerente", () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    vi.stubEnv("JUPITER_BASE_URL", "https://api.jup.ag/swap/v1/");
    expect(configJupiter()).toMatchObject({ modo: "autenticada", base: "https://api.jup.ag/swap/v1", incoerencia: null });
  });

  it("SEM chave + base api.jup.ag (daria 401) → lite-api, incoerência registrada", async () => {
    vi.stubEnv("JUPITER_BASE_URL", "https://api.jup.ag/swap/v1");
    await fetchJupiterQuote(ARGS);
    expect(new URL(chamadas[0].url).host).toBe("lite-api.jup.ag");
    expect(configJupiter().incoerencia).toMatch(/401/);
  });

  it("sem chave + base customizada → respeitada (comportamento antigo)", () => {
    vi.stubEnv("JUPITER_BASE_URL", "https://outra.exemplo.com/v1");
    expect(configJupiter()).toMatchObject({ modo: "sem-chave", base: "https://outra.exemplo.com/v1", incoerencia: null });
  });
});

describe("C · a chave nunca aparece em erro nem em log", () => {
  it("429: JupiterError tipo limite, modo autenticada; corpo que ecoa a chave é censurado", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    resposta = () => new Response(`Too many requests for key ${CHAVE}`, { status: 429 });
    const e = await fetchJupiterQuote(ARGS).catch((x) => x);
    expect(e).toBeInstanceOf(JupiterError);
    expect(e).toMatchObject({ tipo: "limite", modo: "autenticada", status: 429 });
    expect(e.message).toMatch(/^Jupiter 429 \[autenticada\]/);
    expect(e.message).not.toContain(CHAVE);
    expect(e.message).toContain("[redacted]");
    const logs = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logs).not.toContain(CHAVE);
    expect(logs).toContain('\\"tipo\\":\\"limite\\"');
  });

  it("swap 500: tipo http, sem a chave", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    resposta = () => new Response(`erro interno ${CHAVE}`, { status: 500 });
    const e = await fetchJupiterSwap({ quoteResponse: QUOTE, userPublicKey: "u" }).catch((x) => x);
    expect(e).toMatchObject({ tipo: "http", status: 500 });
    expect(e.message).toMatch(/^Jupiter swap 500/);
    expect(e.message).not.toContain(CHAVE);
  });

  it("falha de conexão: tipo conexao, host e causa, sem a chave", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    resposta = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); };
    const e = await fetchJupiterQuote(ARGS).catch((x) => x);
    expect(e).toMatchObject({ tipo: "conexao", modo: "autenticada" });
    expect(e.message).toMatch(/api\.jup\.ag.*ENOTFOUND/);
    expect(e.message + JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(CHAVE);
  });

  it("sem chave, 429 vem marcado sem-chave (distingue keyless de autenticada)", async () => {
    resposta = () => new Response("Too many requests", { status: 429 });
    const e = await fetchJupiterQuote(ARGS).catch((x) => x);
    expect(e).toMatchObject({ tipo: "limite", modo: "sem-chave" });
  });
});

describe("401/403 — chave recusada não para o swap", () => {
  for (const status of [401, 403]) {
    it(`${status}: refaz UMA vez na lite-api sem a chave e avisa`, async () => {
      vi.stubEnv("JUPITER_API_KEY", CHAVE);
      resposta = (c) => c.headers.has("x-api-key") ? new Response(`invalid key ${CHAVE}`, { status }) : Response.json(QUOTE);
      const aoRecusarChave = vi.fn();
      const q = await fetchJupiterQuote(ARGS, { aoRecusarChave });
      expect(q.outAmount).toBe("1");
      expect(aoRecusarChave).toHaveBeenCalledWith(status);
      expect(chamadas.map((c) => new URL(c.url).host)).toEqual(["api.jup.ag", "lite-api.jup.ag"]);
      expect(chamadas[1].headers.has("x-api-key")).toBe(false);
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(CHAVE);
    });
  }

  it("se a lite-api também falhar, o erro sobe como sem-chave (sem laço)", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    resposta = () => new Response("nope", { status: 401 });
    const e = await fetchJupiterQuote(ARGS).catch((x) => x);
    expect(chamadas).toHaveLength(2);
    expect(e).toMatchObject({ tipo: "chave", modo: "sem-chave", status: 401 });
  });
});

describe("D/E · headers por chamada preservados", () => {
  it("GET /quote: Accept application/json + x-api-key", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    await fetchJupiterQuote(ARGS);
    expect(chamadas[0].headers.get("accept")).toBe("application/json");
    expect(chamadas[0].headers.get("x-api-key")).toBe(CHAVE);
  });

  it("POST /swap: Content-Type + Accept + x-api-key", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    await fetchJupiterSwap({ quoteResponse: QUOTE, userPublicKey: "u" });
    const h = chamadas[0].headers;
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("accept")).toBe("application/json");
    expect(h.get("x-api-key")).toBe(CHAVE);
  });
});

describe("F/G · taxa Solana intacta", () => {
  for (const bps of [10, 25, 50, 100]) {
    it(`platformFeeBps=${bps} chega à cotação autenticada`, async () => {
      vi.stubEnv("JUPITER_API_KEY", CHAVE);
      await fetchJupiterQuote({ ...ARGS, platformFeeBps: bps });
      expect(new URL(chamadas[0].url).searchParams.get("platformFeeBps")).toBe(String(bps));
    });
  }

  it("sem taxa → sem platformFeeBps", async () => {
    await fetchJupiterQuote(ARGS);
    expect(new URL(chamadas[0].url).searchParams.has("platformFeeBps")).toBe(false);
  });

  it("feeAccount chega ao /swap autenticado", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    await fetchJupiterSwap({ quoteResponse: QUOTE, userPublicKey: "u", feeAccount: "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo" });
    expect(JSON.parse(chamadas[0].body!)).toMatchObject({ feeAccount: "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo" });
  });
});
