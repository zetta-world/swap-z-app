/**
 * W1 (20/10) — o lado do navegador: estado do saldo, cliente `/api/solana/saldo`, consulta
 * compartilhada (TanStack real) e troca de conta. Sem DOM: estado puro + QueryClient de verdade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { montarSaldo, opcoesSaldoSolana, saldoPronto } from "@/lib/hooks/useTokenBalance";
import { buscarSaldoSolana, ErroSaldo } from "@/lib/solana/saldo-cliente";
import { findToken } from "@/lib/tokens";

const SOL = findToken("solana", "SOL")!;
const USDC = findToken("solana", "USDC")!;
const A = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const nada = () => {};

describe("estado do saldo (montarSaldo)", () => {
  it("sem carteira → DISCONNECTED (não é zero, não habilita MAX)", () => {
    const b = montarSaldo(SOL, 150, { habilitado: false, dados: { raw: 5n, decimals: 9, symbol: null }, erro: null, refetch: nada });
    expect(b).toMatchObject({ status: "DISCONNECTED", isZero: false, display: "—", usdValue: null });
    expect(saldoPronto(b)).toBe(false);
  });

  it("primeira leitura → LOADING", () => {
    expect(montarSaldo(SOL, 150, { habilitado: true, dados: undefined, erro: null, refetch: nada }))
      .toMatchObject({ status: "LOADING", loading: true, isZero: false });
  });

  it("⚠️ erro sem leitura anterior → ERROR: isZero FALSE, '—', sem USD (antes: isZero true = erro virava zero)", () => {
    const b = montarSaldo(USDC, 1, { habilitado: true, dados: undefined, erro: "proibido", refetch: nada });
    expect(b).toMatchObject({ status: "ERROR", isZero: false, display: "—", usdValue: null, error: "proibido" });
    expect(saldoPronto(b)).toBe(false);
  });

  it("SOL positivo: 251905070 lamports = 0.25190507 SOL, valor em USD", () => {
    const b = montarSaldo(SOL, 200, { habilitado: true, dados: { raw: 251_905_070n, decimals: 9, symbol: null }, erro: null, refetch: nada });
    expect(b).toMatchObject({ status: "READY_POSITIVE", formatted: "0.25190507", isZero: false });
    expect(b.usdValue).toBeCloseTo(50.381014, 5);
    expect(saldoPronto(b)).toBe(true);
  });

  it("USDC positivo 11.501 e zero REAL", () => {
    expect(montarSaldo(USDC, 1, { habilitado: true, dados: { raw: 11_501_000n, decimals: 6, symbol: null }, erro: null, refetch: nada }))
      .toMatchObject({ status: "READY_POSITIVE", formatted: "11.501", display: "11.501" });
    const z = montarSaldo(USDC, 1, { habilitado: true, dados: { raw: 0n, decimals: null, symbol: null }, erro: null, refetch: nada });
    expect(z).toMatchObject({ status: "READY_ZERO", isZero: true, display: "0", decimals: 6 });
    expect(saldoPronto(z)).toBe(false);
  });

  it("atualização falhou depois de uma leitura → STALE: último valor, marcado, não é 'pronto' nem zero", () => {
    const b = montarSaldo(USDC, 1, { habilitado: true, dados: { raw: 11_501_000n, decimals: 6, symbol: null }, erro: "limite", refetch: nada });
    expect(b).toMatchObject({ status: "STALE", formatted: "11.501", error: "limite", isZero: false });
    expect(saldoPronto(b)).toBe(false);
  });

  it("desconectar durante a leitura → DISCONNECTED mesmo com dado em mãos", () => {
    expect(montarSaldo(USDC, 1, { habilitado: false, dados: undefined, erro: null, refetch: nada }).status).toBe("DISCONNECTED");
  });
});

let respostas: ((owner: string, mint: string) => Response | Promise<Response>);
let chamadas: string[] = [];
beforeEach(() => {
  chamadas = [];
  respostas = (owner, mint) => Response.json({ ok: true, owner, mint, raw: owner === A ? "11501000" : "42", decimals: 6, contas: 1 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url), "http://x");
    chamadas.push(u.pathname + u.search);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return respostas(u.searchParams.get("owner")!, u.searchParams.get("mint")!);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("cliente /api/solana/saldo", () => {
  it("lê do SERVIDOR (nunca de um RPC no navegador) e devolve bigint exato", async () => {
    expect(await buscarSaldoSolana(A, USDC.address)).toEqual({ raw: 11_501_000n, decimals: 6 });
    expect(chamadas[0]).toBe(`/api/solana/saldo?owner=${A}&mint=${USDC.address}`);
  });

  it("⚠️ resposta de OUTRA carteira (troca de conta no meio) é descartada", async () => {
    respostas = (_o, mint) => Response.json({ ok: true, owner: B, mint, raw: "999", decimals: 6 });
    await expect(buscarSaldoSolana(A, USDC.address)).rejects.toMatchObject({ tipo: "resposta", transitorio: false });
  });

  for (const [rotulo, res, tipo, transitorio] of [
    ["502 proibido (403 do fornecedor)", () => Response.json({ ok: false, erro: "proibido", transitorio: false }, { status: 502 }), "proibido", false],
    ["502 limite", () => Response.json({ ok: false, erro: "limite", transitorio: true }, { status: 502 }), "limite", true],
    ["429 da nossa rota", () => Response.json({ ok: false, erro: "rate_limited" }, { status: 429 }), "limite", true],
    ["503 sem corpo", () => new Response("x", { status: 503 }), "http_503", true],
    ["200 com raw inválido", () => Response.json({ ok: true, owner: A, mint: "native", raw: "-1" }), "resposta", false],
  ] as const) {
    it(`${rotulo} → ErroSaldo ${tipo} (transitório: ${transitorio}) — nunca 0`, async () => {
      respostas = res as () => Response;
      const e = await buscarSaldoSolana(A, "native").catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroSaldo);
      expect(e).toMatchObject({ tipo, transitorio });
    });
  }

  it("queda de rede → conexao (transitório); cancelamento é propagado como cancelamento", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(buscarSaldoSolana(A, "native")).rejects.toMatchObject({ tipo: "conexao", transitorio: true });
    const c = new AbortController(); c.abort();
    await expect(buscarSaldoSolana(A, "native", c.signal)).rejects.not.toBeInstanceOf(ErroSaldo);
  });
});

describe("consulta compartilhada (TanStack real)", () => {
  const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });

  it("Swap e Portfólio pedindo o mesmo saldo → UMA chamada, o MESMO valor", async () => {
    const qc = novoCliente();
    const swap = new QueryObserver(qc, opcoesSaldoSolana(A, USDC.address));
    const portfolio = new QueryObserver(qc, opcoesSaldoSolana(A, USDC.address));
    const u1 = swap.subscribe(nada); const u2 = portfolio.subscribe(nada);
    await vi.waitFor(() => expect(swap.getCurrentResult().data).toBeDefined());
    expect(portfolio.getCurrentResult().data).toEqual(swap.getCurrentResult().data);
    expect(chamadas).toHaveLength(1);
    u1(); u2();
  });

  it("troca de conta: a chave muda, o saldo de A nunca aparece em B", async () => {
    const qc = novoCliente();
    await qc.fetchQuery(opcoesSaldoSolana(A, USDC.address));
    expect(qc.getQueryData(opcoesSaldoSolana(B, USDC.address).queryKey)).toBeUndefined();
    const b = await qc.fetchQuery(opcoesSaldoSolana(B, USDC.address));
    expect(b.raw).toBe(42n);
    expect(qc.getQueryData<{ raw: bigint }>(opcoesSaldoSolana(A, USDC.address).queryKey)?.raw).toBe(11_501_000n);
  });

  it("resposta ATRASADA de A chegando depois da troca para B fica na chave de A", async () => {
    const qc = novoCliente();
    let libera!: () => void;
    respostas = (owner, mint) => owner === A
      ? new Promise<Response>((r) => { libera = () => r(Response.json({ ok: true, owner, mint, raw: "11501000", decimals: 6 })); })
      : Response.json({ ok: true, owner, mint, raw: "42", decimals: 6 });
    const pA = qc.fetchQuery(opcoesSaldoSolana(A, USDC.address));
    const b = await qc.fetchQuery(opcoesSaldoSolana(B, USDC.address));
    libera(); await pA;
    expect(b.raw).toBe(42n);
    expect(qc.getQueryData<{ raw: bigint }>(opcoesSaldoSolana(B, USDC.address).queryKey)?.raw).toBe(42n);
  });

  it("retry SÓ em falha transitória: 429 tenta 3 vezes no total; 403 do fornecedor, 1 vez", async () => {
    const qc = novoCliente();
    respostas = () => Response.json({ ok: false, erro: "limite", transitorio: true }, { status: 502 });
    await expect(qc.fetchQuery({ ...opcoesSaldoSolana(A, "native"), retryDelay: 0 })).rejects.toBeInstanceOf(ErroSaldo);
    expect(chamadas).toHaveLength(3);
    chamadas = [];
    respostas = () => Response.json({ ok: false, erro: "proibido", transitorio: false }, { status: 502 });
    await expect(qc.fetchQuery({ ...opcoesSaldoSolana(B, "native"), retryDelay: 0 })).rejects.toBeInstanceOf(ErroSaldo);
    expect(chamadas).toHaveLength(1);
  });

  it("recupera depois do erro: a próxima leitura válida substitui o erro", async () => {
    const qc = novoCliente();
    respostas = () => Response.json({ ok: false, erro: "proibido", transitorio: false }, { status: 502 });
    await expect(qc.fetchQuery(opcoesSaldoSolana(A, "native"))).rejects.toBeInstanceOf(ErroSaldo);
    respostas = (owner, mint) => Response.json({ ok: true, owner, mint, raw: "7", decimals: 9 });
    expect((await qc.fetchQuery({ ...opcoesSaldoSolana(A, "native"), staleTime: 0 })).raw).toBe(7n);
  });

  it("sem polling: nenhuma opção de intervalo; volta ao app/reconexão só relê quando passou do staleTime", () => {
    const o = opcoesSaldoSolana(A, "native") as Record<string, unknown>;
    expect(o.refetchInterval).toBeUndefined();
    expect(o).toMatchObject({ refetchOnWindowFocus: true, refetchOnReconnect: true, staleTime: 15_000 });
  });
});
