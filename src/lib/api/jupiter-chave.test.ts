/**
 * L-062A + L-062B (16/10) — cliente Jupiter na Swap API V2, caminho Router `/build`.
 *
 * Chave: com `JUPITER_API_KEY`, `x-api-key` em toda chamada; sem chave, o MESMO host sem header
 * (a `lite-api` saiu). A chave só vai para `https://api.jup.ag`, nunca aparece em erro, e uma
 * chave recusada não para o swap.
 *
 * `/build`: a transação é montada AQUI a partir da resposta REAL medida em 16/10
 * (`__fixtures__/jupiter-build-20261016.json`). O `fetch` é falso (Jupiter + RPC de simulação).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputeBudgetProgram, PublicKey, VersionedTransaction } from "@solana/web3.js";
import fixture from "./__fixtures__/jupiter-build-20261016.json";
import {
  configJupiter, CU_PRECO_TETO, CU_TETO, fetchJupiterBuild, fetchJupiterFirm, fetchJupiterQuote,
  JupiterError, montarTransacaoJupiter, quoteDoBuild, taxaNaInstrucao, type JupBuild,
} from "@/lib/api/jupiter";
import { verifyJupiterTransaction, extractProgramIds } from "@/lib/swap/solana-guard";
import { CARTEIRA_TAXA_SOLANA } from "@/lib/tier/fees";

const CHAVE = "jup-chave-de-teste-0123456789abcdef";
const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const CONTA_USDC = "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo";
const COM_TAXA = fixture.com_taxa_100bps_feeAccount_En1J8 as unknown as JupBuild;
const SEM_TAXA = fixture.sem_taxa as unknown as JupBuild;
const ARGS = { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "100000000" };

type Chamada = { url: string; headers: Headers; body?: string };
let chamadas: Chamada[] = [];
let jupiter: (c: Chamada) => Response | Promise<Response>;
let simulacao: () => Response | Promise<Response>;
let corpoSimulacao: { params?: [string, Record<string, unknown>] } = {};

beforeEach(() => {
  chamadas = [];
  corpoSimulacao = {};
  jupiter = (c) => Response.json(new URL(c.url).searchParams.has("platformFeeBps") ? COM_TAXA : SEM_TAXA);
  simulacao = () => Response.json({ jsonrpc: "2.0", id: 1, result: { value: { err: null, unitsConsumed: 100_000 } } });
  vi.stubEnv("JUPITER_API_KEY", "");
  vi.stubEnv("JUPITER_BASE_URL", "");
  vi.stubEnv("HELIUS_RPC_URL", "https://rpc.exemplo.test");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c = { url: String(url), headers: new Headers(init?.headers), body: init?.body ? String(init.body) : undefined };
    if (c.url.startsWith("https://rpc.exemplo.test")) { corpoSimulacao = JSON.parse(c.body ?? "{}"); return simulacao(); }
    chamadas.push(c);
    return jupiter(c);
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const logs = () => JSON.stringify([vi.mocked(console.warn).mock.calls, vi.mocked(console.info).mock.calls]);

describe("chave · host sempre api.jup.ag/swap/v2", () => {
  it("com chave: /build em api.jup.ag/swap/v2 + x-api-key; sucesso logado como autenticada, sem a chave", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    await fetchJupiterBuild({ ...ARGS, taker: TAKER });
    expect(chamadas[0].url.startsWith("https://api.jup.ag/swap/v2/build?")).toBe(true);
    expect(chamadas[0].headers.get("x-api-key")).toBe(CHAVE);
    expect(chamadas[0].headers.get("accept")).toBe("application/json");
    expect(logs()).toContain('\\"modo\\":\\"autenticada\\"');
    expect(logs()).not.toContain(CHAVE);
  });

  it("chave com espaço em volta é aparada", async () => {
    vi.stubEnv("JUPITER_API_KEY", `  ${CHAVE}\n`);
    await fetchJupiterBuild({ ...ARGS, taker: TAKER });
    expect(chamadas[0].headers.get("x-api-key")).toBe(CHAVE);
  });

  for (const v of ["", "   "]) {
    it(`sem chave (${JSON.stringify(v)}): MESMO host, sem header, modo sem-chave — a lite-api saiu`, async () => {
      vi.stubEnv("JUPITER_API_KEY", v);
      await fetchJupiterBuild({ ...ARGS, taker: TAKER });
      expect(new URL(chamadas[0].url).host).toBe("api.jup.ag");
      expect(chamadas[0].headers.has("x-api-key")).toBe(false);
      expect(configJupiter()).toMatchObject({ modo: "sem-chave", incoerencia: null });
    });
  }

  for (const base of ["https://lite-api.jup.ag/swap/v1", "https://proxy.exemplo.com/swap/v2", "http://api.jup.ag/swap/v2"]) {
    it(`JUPITER_BASE_URL=${base} → ignorada, a chave nunca sai para ela, incoerência registrada`, async () => {
      vi.stubEnv("JUPITER_API_KEY", CHAVE);
      vi.stubEnv("JUPITER_BASE_URL", base);
      await fetchJupiterBuild({ ...ARGS, taker: TAKER });
      expect(chamadas[0].url.startsWith("https://api.jup.ag/swap/v2/")).toBe(true);
      expect(configJupiter().incoerencia).not.toBeNull();
    });
  }

  it("JUPITER_BASE_URL https://api.jup.ag/... → aceita (barra final removida)", () => {
    vi.stubEnv("JUPITER_BASE_URL", "https://api.jup.ag/swap/v2/");
    expect(configJupiter()).toMatchObject({ base: "https://api.jup.ag/swap/v2", incoerencia: null });
  });
});

describe("falhas · tipo, modo e nenhuma chave na mensagem", () => {
  it("429 autenticada: tipo limite; corpo que ecoa a chave é censurado", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    jupiter = () => new Response(`Too many requests for ${CHAVE}`, { status: 429 });
    const e = await fetchJupiterBuild({ ...ARGS, taker: TAKER }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(JupiterError);
    expect(e).toMatchObject({ tipo: "limite", modo: "autenticada", status: 429 });
    expect((e as Error).message).toMatch(/^Jupiter build 429 \[autenticada\]/);
    expect((e as Error).message).not.toContain(CHAVE);
    expect((e as Error).message).toContain("[redacted]");
    expect(logs()).not.toContain(CHAVE);
  });

  it("429 sem chave vem marcado sem-chave", async () => {
    jupiter = () => new Response("Too many requests", { status: 429 });
    expect(await fetchJupiterBuild({ ...ARGS, taker: TAKER }).catch((x: unknown) => x)).toMatchObject({ tipo: "limite", modo: "sem-chave" });
  });

  it("conexão: tipo conexao com host e causa", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    jupiter = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); };
    const e = await fetchJupiterBuild({ ...ARGS, taker: TAKER }).catch((x: unknown) => x);
    expect(e).toMatchObject({ tipo: "conexao" });
    expect((e as Error).message).toMatch(/api\.jup\.ag.*ENOTFOUND/);
  });

  for (const status of [401, 403]) {
    it(`${status}: refaz UMA vez sem a chave no mesmo host e avisa`, async () => {
      vi.stubEnv("JUPITER_API_KEY", CHAVE);
      jupiter = (c) => c.headers.has("x-api-key") ? new Response(`bad ${CHAVE}`, { status }) : Response.json(SEM_TAXA);
      const aoRecusarChave = vi.fn();
      const b = await fetchJupiterBuild({ ...ARGS, taker: TAKER }, { aoRecusarChave });
      expect(b.outAmount).toBe(SEM_TAXA.outAmount);
      expect(aoRecusarChave).toHaveBeenCalledWith(status);
      expect(chamadas.map((c) => new URL(c.url).host)).toEqual(["api.jup.ag", "api.jup.ag"]);
      expect(chamadas[1].headers.has("x-api-key")).toBe(false);
      expect(logs()).not.toContain(CHAVE);
    });
  }

  it("se sem a chave também falhar, sobe como sem-chave (sem laço)", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    jupiter = () => new Response("nope", { status: 401 });
    const e = await fetchJupiterBuild({ ...ARGS, taker: TAKER }).catch((x: unknown) => x);
    expect(chamadas).toHaveLength(2);
    expect(e).toMatchObject({ tipo: "chave", modo: "sem-chave", status: 401 });
  });
});

describe("/build · parâmetros e taxa", () => {
  for (const bps of [10, 25, 50, 100]) {
    it(`platformFeeBps=${bps} + feeAccount chegam juntos ao /build`, async () => {
      await fetchJupiterBuild({ ...ARGS, taker: TAKER, platformFeeBps: bps, feeAccount: CONTA_USDC });
      const p = new URL(chamadas[0].url).searchParams;
      expect(p.get("platformFeeBps")).toBe(String(bps));
      expect(p.get("feeAccount")).toBe(CONTA_USDC);
      expect(p.get("taker")).toBe(TAKER);
    });
  }

  it("sem taxa → nem platformFeeBps nem feeAccount", async () => {
    await fetchJupiterBuild({ ...ARGS, taker: TAKER });
    const p = new URL(chamadas[0].url).searchParams;
    expect(p.has("platformFeeBps")).toBe(false);
    expect(p.has("feeAccount")).toBe(false);
  });

  it("taxa sem conta, ou conta sem taxa → recusa ANTES de chamar a Jupiter", async () => {
    await expect(fetchJupiterBuild({ ...ARGS, taker: TAKER, platformFeeBps: 100 })).rejects.toThrow(/andam juntos/);
    await expect(fetchJupiterBuild({ ...ARGS, taker: TAKER, feeAccount: CONTA_USDC })).rejects.toThrow(/andam juntos/);
    expect(chamadas).toHaveLength(0);
  });

  it("lista sem carteira: o /build recebe a carteira de taxa da plataforma como taker (só cotação)", async () => {
    await fetchJupiterQuote(ARGS);
    expect(new URL(chamadas[0].url).searchParams.get("taker")).toBe(CARTEIRA_TAXA_SOLANA);
  });

  it("lista com carteira: o taker é a carteira de quem cota", async () => {
    await fetchJupiterQuote({ ...ARGS, taker: TAKER });
    expect(new URL(chamadas[0].url).searchParams.get("taker")).toBe(TAKER);
  });
});

describe("⚠️ prova da taxa — a conta tem de estar na instrução de swap", () => {
  it("resposta real com taxa: feeAccount na swapInstruction → platformFee confirmado", () => {
    expect(taxaNaInstrucao(COM_TAXA, CONTA_USDC)).toBe(true);
    expect(quoteDoBuild(COM_TAXA, { platformFeeBps: 100, feeAccount: CONTA_USDC }).platformFee).toEqual({ feeBps: 100, feeAccount: CONTA_USDC });
  });

  it("pedida mas AUSENTE da instrução (Jupiter ignorou) → sem platformFee", () => {
    expect(taxaNaInstrucao(SEM_TAXA, CONTA_USDC)).toBe(false);
    expect(quoteDoBuild(SEM_TAXA, { platformFeeBps: 100, feeAccount: CONTA_USDC }).platformFee).toBeUndefined();
  });

  it("formato de cotação preservado (outAmount líquido, routePlan com label), sem instruções", () => {
    const q = quoteDoBuild(COM_TAXA, { platformFeeBps: 100, feeAccount: CONTA_USDC });
    expect(q).toMatchObject({ inAmount: "100000000", outAmount: COM_TAXA.outAmount, swapMode: "ExactIn", slippageBps: 50 });
    expect(q.routePlan[0].swapInfo.label).toBeTruthy();
    expect(JSON.stringify(q)).not.toMatch(/swapInstruction|setupInstructions|addressesByLookupTableAddress/);
  });
});

describe("montagem da transação (v0) a partir da resposta real", () => {
  const ler = (b64: string) => VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  const cuDe = (tx: VersionedTransaction, disc: number) => {
    const keys = tx.message.staticAccountKeys;
    for (const ix of tx.message.compiledInstructions) {
      if (keys[ix.programIdIndex].equals(ComputeBudgetProgram.programId) && ix.data[0] === disc) {
        return disc === 2 ? Buffer.from(ix.data).readUInt32LE(1) : Number(Buffer.from(ix.data).readBigUInt64LE(1));
      }
    }
    return null;
  };

  it("v0, pagador = taker, blockhash e validade da própria resposta, nada assinado", async () => {
    const r = await montarTransacaoJupiter(COM_TAXA, TAKER);
    const tx = ler(r.swapTransaction);
    expect(tx.version).toBe(0);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(TAKER);
    expect(tx.message.recentBlockhash).toBe(new PublicKey(Uint8Array.from(COM_TAXA.blockhashWithMetadata.blockhash)).toBase58());
    expect(r.lastValidBlockHeight).toBe(COM_TAXA.blockhashWithMetadata.lastValidBlockHeight);
    expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true);
  });

  it("ordem das instruções: limite CU, preço CU, setup, SWAP, limpeza, outras — idêntica à da Jupiter", async () => {
    const tx = ler((await montarTransacaoJupiter(COM_TAXA, TAKER)).swapTransaction);
    const dados = tx.message.compiledInstructions.map((ix) => Buffer.from(ix.data).toString("base64"));
    const esperado = [
      ...COM_TAXA.setupInstructions.map((i) => i.data),
      COM_TAXA.swapInstruction.data,
      ...(COM_TAXA.cleanupInstruction ? [COM_TAXA.cleanupInstruction.data] : []),
      ...COM_TAXA.otherInstructions.map((i) => i.data),
    ];
    expect(COM_TAXA.cleanupInstruction).not.toBeNull(); // a fixture real tem limpeza (unwrap): a ordem importa
    expect(dados.slice(2)).toEqual(esperado);
  });

  it("o guard Solana do navegador APROVA e enxerga todos os programas (nenhum programa em ALT)", async () => {
    const tx = ler((await montarTransacaoJupiter(COM_TAXA, TAKER)).swapTransaction);
    expect(extractProgramIds(tx)).not.toBeNull();
    expect(verifyJupiterTransaction(tx)).toMatchObject({ ok: true, unknownPrograms: [] });
    expect(tx.message.addressTableLookups.length).toBeGreaterThan(0);
  });

  it("a conta de taxa está na transação (estática ou via lookup table)", async () => {
    const tx = ler((await montarTransacaoJupiter(COM_TAXA, TAKER)).swapTransaction);
    const alts = Object.entries(COM_TAXA.addressesByLookupTableAddress ?? {});
    const estaticas = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const viaAlt = tx.message.addressTableLookups.flatMap((l) => {
      const addrs = alts.find(([k]) => k === l.accountKey.toBase58())?.[1] ?? [];
      return [...l.writableIndexes, ...l.readonlyIndexes].map((i) => addrs[i]);
    });
    expect([...estaticas, ...viaAlt]).toContain(CONTA_USDC);
  });

  it("limite de CU = simulação × 1,2; preço de CU da Jupiter mantido; um de cada", async () => {
    const r = await montarTransacaoJupiter(COM_TAXA, TAKER);
    const tx = ler(r.swapTransaction);
    expect(r.computeUnitLimit).toBe(120_000);
    expect(cuDe(tx, 2)).toBe(120_000);
    const precoJupiter = Number(Buffer.from(COM_TAXA.computeBudgetInstructions[0].data, "base64").readBigUInt64LE(1));
    expect(cuDe(tx, 3)).toBe(precoJupiter);
    const cb = tx.message.compiledInstructions.filter((ix) => tx.message.staticAccountKeys[ix.programIdIndex].equals(ComputeBudgetProgram.programId));
    expect(cb).toHaveLength(2);
  });

  it("simulação sem assinatura e com blockhash substituível", async () => {
    await montarTransacaoJupiter(COM_TAXA, TAKER);
    expect(corpoSimulacao.params?.[1]).toMatchObject({ sigVerify: false, replaceRecentBlockhash: true });
  });

  for (const [rotulo, sim] of [
    ["simulação recusou (ex.: saldo)", () => Response.json({ result: { value: { err: { InstructionError: [3, "x"] }, unitsConsumed: 5000 } } })],
    ["RPC 500", () => new Response("x", { status: 500 })],
    ["RPC fora", () => { throw new Error("down"); }],
  ] as const) {
    it(`${rotulo} → limite no teto (1,4 M), transação sai mesmo assim, com log`, async () => {
      simulacao = sim as () => Response;
      const r = await montarTransacaoJupiter(COM_TAXA, TAKER);
      expect(r.computeUnitLimit).toBe(CU_TETO);
      expect(cuDe(ler(r.swapTransaction), 2)).toBe(CU_TETO);
      expect(logs()).toContain("simulacao");
    });
  }

  it("simulação de 1,3 M → limite não passa de 1,4 M", async () => {
    simulacao = () => Response.json({ result: { value: { err: null, unitsConsumed: 1_300_000 } } });
    expect((await montarTransacaoJupiter(COM_TAXA, TAKER)).computeUnitLimit).toBe(CU_TETO);
  });

  it("preço de CU absurdo da Jupiter é cortado no teto", async () => {
    const d = Buffer.alloc(9); d[0] = 3; d.writeBigUInt64LE(50_000_000n, 1);
    const b = { ...COM_TAXA, computeBudgetInstructions: [{ ...COM_TAXA.computeBudgetInstructions[0], data: d.toString("base64") }] };
    expect(cuDe(ler((await montarTransacaoJupiter(b, TAKER)).swapTransaction), 3)).toBe(CU_PRECO_TETO);
  });

  it("limite de CU vindo da Jupiter não duplica o nosso", async () => {
    const lim = ComputeBudgetProgram.setComputeUnitLimit({ units: 999 });
    const b = { ...COM_TAXA, computeBudgetInstructions: [...COM_TAXA.computeBudgetInstructions,
      { programId: lim.programId.toBase58(), accounts: [], data: Buffer.from(lim.data).toString("base64") }] };
    const tx = ler((await montarTransacaoJupiter(b, TAKER)).swapTransaction);
    expect(cuDe(tx, 2)).toBe(120_000);
  });

  it("transactionVersion 1 → recusa (as carteiras ainda não assinam v1)", async () => {
    await expect(montarTransacaoJupiter({ ...COM_TAXA, transactionVersion: "1" }, TAKER)).rejects.toThrow(/v0/);
  });

  it("fetchJupiterFirm: UMA chamada à Jupiter, cotação com taxa confirmada + transação", async () => {
    vi.stubEnv("JUPITER_API_KEY", CHAVE);
    const { quote, swap } = await fetchJupiterFirm({ ...ARGS, taker: TAKER, platformFeeBps: 100, feeAccount: CONTA_USDC });
    expect(chamadas).toHaveLength(1);
    expect(quote.platformFee).toEqual({ feeBps: 100, feeAccount: CONTA_USDC });
    expect(ler(swap.swapTransaction).version).toBe(0);
  });
});
