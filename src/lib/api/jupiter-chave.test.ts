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
import { ComputeBudgetProgram, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import fixture from "./__fixtures__/jupiter-build-20261016.json";
import {
  configJupiter, CU_PRECO_TETO, CU_TETO, fetchJupiterBuild, fetchJupiterFirm, fetchJupiterQuote,
  ACRESCIMO_MINIMO_CARTEIRA, FOLGA_BYTES_CARTEIRA, FOLGA_CONTAS_CARTEIRA, JupiterError, PRAZO_ROTA_MENOR_MS, MAX_ACCOUNTS_REDUZIDO, MAX_BYTES_TX, MAX_CONTAS_TX,
  montarTransacaoJupiter, quoteDoBuild, tamanhoDaTransacao, taxaNaInstrucao, temFolgaParaCarteira, TransacaoGrandeError,
  type JupBuild,
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
let jupiter: (c: Chamada, init?: RequestInit) => Response | Promise<Response>;
let simulacao: () => Response | Promise<Response>;
let corpoSimulacao: { params?: [string, Record<string, unknown>] } = {};
let simulacoes = 0;
/** `getLatestBlockhash` do RPC do servidor (padrão: indisponível → cai no blockhash da Jupiter, como antes). */
let blockhashRpc: () => Response | Promise<Response>;
let pedidosBlockhash = 0;

beforeEach(() => {
  chamadas = [];
  corpoSimulacao = {};
  simulacoes = 0;
  pedidosBlockhash = 0;
  blockhashRpc = () => new Response("indisponível", { status: 503 });
  jupiter = (c) => Response.json(new URL(c.url).searchParams.has("platformFeeBps") ? COM_TAXA : SEM_TAXA);
  simulacao = () => Response.json({ jsonrpc: "2.0", id: 1, result: { value: { err: null, unitsConsumed: 100_000 } } });
  vi.stubEnv("JUPITER_API_KEY", "");
  vi.stubEnv("JUPITER_BASE_URL", "");
  vi.stubEnv("HELIUS_RPC_URL", "https://rpc.exemplo.test");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const c = { url: String(url), headers: new Headers(init?.headers), body: init?.body ? String(init.body) : undefined };
    if (c.url.startsWith("https://rpc.exemplo.test")) {
      const corpo = JSON.parse(c.body ?? "{}");
      if (corpo.method === "getLatestBlockhash") { pedidosBlockhash++; return blockhashRpc(); }
      corpoSimulacao = corpo; simulacoes++; return simulacao();
    }
    chamadas.push(c);
    return jupiter(c, init);
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

/**
 * ⚠️ PRODUÇÃO 16/10 (rollback): JUP→WIF numa rota de 5 trechos virou uma transação de 65 contas — a
 * rede recusa acima de 64 (`TooManyAccountLocks`). No `/build` o limite é responsabilidade nossa.
 */
describe("⚠️ transação tem de caber na rede (64 contas, 1232 bytes)", () => {
  const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
  /** A resposta real + uma instrução com `extras` contas novas (simula uma rota longa). */
  const inchada = (extras: number, dados = ""): JupBuild => ({
    ...COM_TAXA,
    otherInstructions: [{ programId: MEMO, data: Buffer.from(dados).toString("base64"),
      accounts: Array.from({ length: extras }, () => ({ pubkey: Keypair.generate().publicKey.toBase58(), isSigner: false, isWritable: false })) }],
  });

  it("a resposta real cabe com folga", async () => {
    const tx = VersionedTransaction.deserialize(Buffer.from((await montarTransacaoJupiter(COM_TAXA, TAKER)).swapTransaction, "base64"));
    const t = tamanhoDaTransacao(tx);
    expect(t.contas).toBeLessThanOrEqual(MAX_CONTAS_TX);
    expect(t.bytes).toBeLessThanOrEqual(MAX_BYTES_TX);
  });

  it("65+ contas → TransacaoGrandeError, sem simular e sem devolver transação", async () => {
    corpoSimulacao = {};
    const e = await montarTransacaoJupiter(inchada(30), TAKER).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransacaoGrandeError);
    expect((e as TransacaoGrandeError).contas).toBeGreaterThan(MAX_CONTAS_TX);
    expect(corpoSimulacao.params).toBeUndefined();
  });

  it("acima de 1232 bytes → TransacaoGrandeError", async () => {
    const e = await montarTransacaoJupiter(inchada(0, "x".repeat(900)), TAKER).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TransacaoGrandeError);
    expect((e as TransacaoGrandeError).bytes).toBeGreaterThan(MAX_BYTES_TX);
  });

  it("firme: rota não coube → refaz UMA vez com maxAccounts reduzido e o swap sai", async () => {
    const grande = inchada(30);
    jupiter = (c) => Response.json(new URL(c.url).searchParams.has("maxAccounts") ? COM_TAXA : grande);
    const { quote, swap } = await fetchJupiterFirm({ ...ARGS, taker: TAKER, platformFeeBps: 100, feeAccount: CONTA_USDC });
    expect(chamadas).toHaveLength(2);
    expect(new URL(chamadas[0].url).searchParams.has("maxAccounts")).toBe(false);
    expect(new URL(chamadas[1].url).searchParams.get("maxAccounts")).toBe(String(MAX_ACCOUNTS_REDUZIDO));
    expect(new URL(chamadas[1].url).searchParams.get("feeAccount")).toBe(CONTA_USDC);
    expect(quote.platformFee).toEqual({ feeBps: 100, feeAccount: CONTA_USDC });
    expect(tamanhoDaTransacao(VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"))).contas).toBeLessThanOrEqual(MAX_CONTAS_TX);
    expect(logs()).toContain("tx-grande");
  });

  it("firme: nem a rota reduzida coube → erro (nunca uma transação inválida), sem laço", async () => {
    jupiter = () => Response.json(inchada(30));
    await expect(fetchJupiterFirm({ ...ARGS, taker: TAKER })).rejects.toBeInstanceOf(TransacaoGrandeError);
    expect(chamadas).toHaveLength(2);
  });

  /**
   * ⚠️ LIGHTHOUSE v2 (24/10): a Phantom assina ACRESCENTANDO asserções (programa Lighthouse = conta nova,
   * ~220 B na resposta real). Uma transação no limite exato é assinada e depois não cabe.
   */
  describe("folga para o que a carteira acrescenta", () => {
    const tam = async (b: JupBuild) => tamanhoDaTransacao(VersionedTransaction.deserialize(
      Buffer.from((await montarTransacaoJupiter(b, TAKER)).swapTransaction, "base64")));
    const tamSwap = (s: { swapTransaction: string }) => tamanhoDaTransacao(VersionedTransaction.deserialize(Buffer.from(s.swapTransaction, "base64")));
    /** Cabe na rede, mas sem a folga de bytes. */
    const semFolgaDeBytes = async () => {
      const base = await tam(COM_TAXA);
      const b = inchada(0, "x".repeat(MAX_BYTES_TX - FOLGA_BYTES_CARTEIRA - base.bytes + 40));
      const t = await tam(b);
      expect(t.bytes).toBeGreaterThan(MAX_BYTES_TX - FOLGA_BYTES_CARTEIRA);
      expect(t.bytes).toBeLessThanOrEqual(MAX_BYTES_TX);
      return b;
    };

    it("a resposta real tem folga → uma chamada só, nada refeito", async () => {
      expect(temFolgaParaCarteira(await tam(COM_TAXA))).toBe(true);
      await fetchJupiterFirm({ ...ARGS, taker: TAKER, platformFeeBps: 100, feeAccount: CONTA_USDC });
      expect(chamadas).toHaveLength(1);
      expect(logs()).not.toContain("tx-sem-folga");
    });

    it("sem folga de BYTES → refaz UMA vez com maxAccounts reduzido e usa a menor", async () => {
      const grande = await semFolgaDeBytes();
      jupiter = (c) => Response.json(new URL(c.url).searchParams.has("maxAccounts") ? COM_TAXA : grande);
      const { quote, swap } = await fetchJupiterFirm({ ...ARGS, taker: TAKER, platformFeeBps: 100, feeAccount: CONTA_USDC });
      expect(chamadas).toHaveLength(2);
      expect(new URL(chamadas[1].url).searchParams.get("maxAccounts")).toBe(String(MAX_ACCOUNTS_REDUZIDO));
      expect(new URL(chamadas[1].url).searchParams.get("feeAccount")).toBe(CONTA_USDC);
      expect(quote.platformFee).toEqual({ feeBps: 100, feeAccount: CONTA_USDC });
      expect(temFolgaParaCarteira(tamSwap(swap))).toBe(true);
      expect(logs()).toContain("tx-sem-folga");
    });

    it("EXATAMENTE 64 contas (a Phantom faria 65) → refaz", async () => {
      const base = await tam(COM_TAXA);
      // Contas a mais vindas das PRÓPRIAS lookup tables (1 byte cada) — 64 contas estáticas não caberiam em bytes.
      const usadas = new Set(VersionedTransaction.deserialize(Buffer.from((await montarTransacaoJupiter(COM_TAXA, TAKER)).swapTransaction, "base64")).message.staticAccountKeys.map((k) => k.toBase58()));
      const daTabela = Object.values(COM_TAXA.addressesByLookupTableAddress ?? {}).flat().filter((a) => !usadas.has(a));
      const extras = MAX_CONTAS_TX - base.contas - 1;   // +1 = o programa Memo
      const no64: JupBuild = { ...COM_TAXA, otherInstructions: [{ programId: MEMO, data: "",
        accounts: [...new Set(daTabela)].slice(0, extras).map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })) }] };
      // Endereços da tabela já usados pela rota não contam de novo: ajusta até dar 64.
      let t = await tam(no64);
      const pool = [...new Set(daTabela)];
      for (let i = extras; t.contas < MAX_CONTAS_TX && i < pool.length; i++) {
        no64.otherInstructions![0].accounts.push({ pubkey: pool[i], isSigner: false, isWritable: false });
        t = await tam(no64);
      }
      expect(t.contas).toBe(MAX_CONTAS_TX);
      expect(t.bytes).toBeLessThanOrEqual(MAX_BYTES_TX);
      jupiter = (c) => Response.json(new URL(c.url).searchParams.has("maxAccounts") ? COM_TAXA : no64);
      const { swap } = await fetchJupiterFirm({ ...ARGS, taker: TAKER });
      expect(chamadas).toHaveLength(2);
      expect(tamSwap(swap).contas).toBeLessThanOrEqual(MAX_CONTAS_TX - FOLGA_CONTAS_CARTEIRA);
    });

    it("nem a rota menor tem folga, ou ela falhou → fica a PRIMEIRA (cabe na rede), nunca erro", async () => {
      const grande = await semFolgaDeBytes();
      jupiter = () => Response.json(grande);
      const a = await fetchJupiterFirm({ ...ARGS, taker: TAKER });
      expect(chamadas).toHaveLength(2);
      expect(tamSwap(a.swap).bytes).toBeLessThanOrEqual(MAX_BYTES_TX);
      chamadas = [];
      jupiter = (c) => new URL(c.url).searchParams.has("maxAccounts") ? new Response("erro", { status: 500 }) : Response.json(grande);
      const b = await fetchJupiterFirm({ ...ARGS, taker: TAKER });
      expect(chamadas.length).toBeGreaterThanOrEqual(2);
      expect(tamSwap(b.swap)).toEqual(await tam(grande));
    });

    /** Uma resposta do `/build` com exatamente `alvo` bytes a mais que a real (instrução Memo). */
    const comBytes = async (alvo: number) => {
      // O tamanho dos dados é compact-u16 (1 byte < 128, 2 bytes depois): ajusta pela medida.
      let n = alvo - (await tam(inchada(0, ""))).bytes;
      let b = inchada(0, "x".repeat(n));
      for (let i = 0; i < 3 && (await tam(b)).bytes !== alvo; i++) { n -= (await tam(b)).bytes - alvo; b = inchada(0, "x".repeat(n)); }
      expect((await tam(b)).bytes).toBe(alvo);
      return b;
    };

    it("⚠️ a rota menor SEM a mesma taxa nunca substitui a primeira (a taxa da plataforma não se perde)", async () => {
      const grande = await semFolgaDeBytes();
      jupiter = (c) => Response.json(new URL(c.url).searchParams.has("maxAccounts") ? SEM_TAXA : grande);
      simulacoes = 0;
      const { quote } = await fetchJupiterFirm({ ...ARGS, taker: TAKER, platformFeeBps: 100, feeAccount: CONTA_USDC });
      expect(chamadas).toHaveLength(2);
      expect(quote.platformFee).toEqual({ feeBps: 100, feeAccount: CONTA_USDC });
      expect(logs()).toContain('\\"porque\\":\\"taxa_diferente\\"');
      expect(simulacoes).toBe(1);   // a rota descartada nem foi simulada
    });

    it("nenhuma tem folga completa, mas só a menor comporta o MÍNIMO da carteira → a menor", async () => {
      const limite = MAX_BYTES_TX - ACRESCIMO_MINIMO_CARTEIRA.bytes;
      const primeira = await comBytes(MAX_BYTES_TX - 10);          // não comporta nem a asserção do pagador
      const menor = await comBytes(limite - 20);                   // sem folga completa, mas comporta o mínimo
      expect((await tam(menor)).bytes).toBeGreaterThan(MAX_BYTES_TX - FOLGA_BYTES_CARTEIRA);
      jupiter = (c) => Response.json(new URL(c.url).searchParams.has("maxAccounts") ? menor : primeira);
      const { swap } = await fetchJupiterFirm({ ...ARGS, taker: TAKER });
      expect(tamSwap(swap).bytes).toBe(limite - 20);
      expect(logs()).toContain('\\"escolhida\\":\\"segunda\\"');
    });

    it("rota menor que não responde no prazo → fica a primeira, sem prender a cotação", async () => {
      const grande = await semFolgaDeBytes();
      jupiter = (c, init) => new URL(c.url).searchParams.has("maxAccounts")
        ? new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("prazo", "TimeoutError"))))
        : Response.json(grande);
      const inicio = Date.now();
      const { swap } = await fetchJupiterFirm({ ...ARGS, taker: TAKER });
      expect(Date.now() - inicio).toBeLessThan(PRAZO_ROTA_MENOR_MS + 2_000);
      expect(tamSwap(swap)).toEqual(await tam(grande));
      expect(logs()).toContain('\\"escolhida\\":\\"primeira\\"');
      expect(logs()).toContain('\\"porque\\":\\"erro:');
    }, 10_000);

    it("pedido que JÁ veio com maxAccounts não refaz (sem laço)", async () => {
      const grande = await semFolgaDeBytes();
      jupiter = () => Response.json(grande);
      await fetchJupiterFirm({ ...ARGS, taker: TAKER, maxAccounts: 30 });
      expect(chamadas).toHaveLength(1);
    });
  });
});

/**
 * ⚠️ 1º SWAP REAL EM PRODUÇÃO (25/10): `BlockhashNotFound`. O blockhash do `/build` vem de cache da Jupiter e chegou com
 * ~35 s de vida. A transação passa a usar um blockhash NOVO do RPC do servidor — o mesmo nó do preflight do envio.
 */
describe("blockhash do próprio servidor", () => {
  const NOVO = Keypair.generate().publicKey.toBase58();
  const ok = (blockhash: unknown, lastValidBlockHeight: unknown) => () =>
    Response.json({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: { blockhash, lastValidBlockHeight } } });
  const ler = (s: { swapTransaction: string }) => VersionedTransaction.deserialize(Buffer.from(s.swapTransaction, "base64"));
  const daJupiter = (COM_TAXA as JupBuild).blockhashWithMetadata;

  it("usa o blockhash e o lastValidBlockHeight do RPC do servidor (`confirmed`), não os da Jupiter", async () => {
    blockhashRpc = ok(NOVO, daJupiter.lastValidBlockHeight + 120);
    const swap = await montarTransacaoJupiter(COM_TAXA, TAKER);
    expect(ler(swap).message.recentBlockhash).toBe(NOVO);
    expect(swap.lastValidBlockHeight).toBe(daJupiter.lastValidBlockHeight + 120);
    expect(pedidosBlockhash).toBe(1);
    expect(logs()).toContain('\\"origem\\":\\"servidor\\",\\"blocosAMais\\":120');
  });

  it("o pedido é `getLatestBlockhash` com compromisso `confirmed` (o mesmo do preflight do envio)", async () => {
    let corpo: { method?: string; params?: unknown[] } = {};
    blockhashRpc = ok(NOVO, 5);
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const b = init?.body ? JSON.parse(String(init.body)) : {};
      if (b.method === "getLatestBlockhash") corpo = b;
      return (original as typeof fetch)(url, init);
    }));
    await montarTransacaoJupiter(COM_TAXA, TAKER);
    expect(corpo).toMatchObject({ method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] });
  });

  it.each<[string, () => Response | Promise<Response>]>([
    ["RPC fora (503)", () => new Response("x", { status: 503 })],
    ["blockhash ausente", ok(undefined, 10)],
    ["blockhash que não é base58 de 32 bytes", ok("nao-e-blockhash", 10)],
    ["lastValidBlockHeight inválido", ok(NOVO, -1)],
    ["lastValidBlockHeight não inteiro", ok(NOVO, 1.5)],
    ["resposta ilegível", () => new Response("<html>", { status: 200 })],
    ["rede caiu", () => { throw new TypeError("fetch failed"); }],
  ])("%s → cai no blockhash da Jupiter, com log, e a cotação sai", async (_, r) => {
    blockhashRpc = r;
    const swap = await montarTransacaoJupiter(COM_TAXA, TAKER);
    expect(ler(swap).message.recentBlockhash).toBe(new PublicKey(Uint8Array.from(daJupiter.blockhash)).toBase58());
    expect(swap.lastValidBlockHeight).toBe(daJupiter.lastValidBlockHeight);
    expect(logs()).toContain('\\"origem\\":\\"jupiter\\"');
  });

  it("a cotação firme entrega o lastValidBlockHeight do blockhash que ESTÁ na transação (vai para o vínculo e a W3-C)", async () => {
    blockhashRpc = ok(NOVO, 777);
    const { swap } = await fetchJupiterFirm({ ...ARGS, taker: TAKER, platformFeeBps: 100, feeAccount: CONTA_USDC });
    expect(ler(swap).message.recentBlockhash).toBe(NOVO);
    expect(swap.lastValidBlockHeight).toBe(777);
  });
});

