/**
 * Jupiter Swap API V2 — caminho Router (`GET /swap/v2/build`), agregador de Solana.
 *
 *   GET /build — cotação + instruções cruas; a TRANSAÇÃO É MONTADA AQUI (`montarTransacaoJupiter`).
 *
 * L-062B (16/10, decisão do dono): Router `/build` em vez do Meta-Aggregator `/order`. Motivo é
 * dinheiro: no `/build` a Jupiter não cobra nada e a taxa da plataforma é `platformFeeBps` +
 * `feeAccount` como na v1 (escada 100/50/25/10 inteira, 100% nossa). No `/order` a taxa de
 * integrador tem mínimo de 50 bps, a Jupiter fica com 20% e cobra a própria do usuário.
 * Ver `docs/PLANO-JUPITER-SWAP-V2.md`.
 *
 * ⚠ MIGRAÇÃO 29/07 — O HOST ANTIGO MORREU. `quote-api.jup.ag/v6` deixou de resolver em DNS;
 * o erro chegava como "fetch failed" genérico e TODO swap de Solana parou sem ninguém ver.
 * Por isso `jupFetch` diz qual host falhou e por quê.
 *
 * CHAVE (L-062A, 16/10): `api.jup.ag` com `x-api-key` é o acesso AUTENTICADO — não "nível
 * pago" (o plano Free tem chave, 1 req/s). Sem chave, o MESMO host atende a 0,5 req/s (a
 * `lite-api` está sendo desligada pela Jupiter e saiu daqui em L-062B). A chave vive SÓ na
 * Vercel (`JUPITER_API_KEY`, servidor); o código nunca a contém. Regras em `configJupiter()`.
 */

import {
  AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { CARTEIRA_TAXA_SOLANA } from "@/lib/tier/fees";
import { rpcSolanaServidor } from "@/lib/solana/rpc-servidor";

export const JUPITER_BASE = "https://api.jup.ag/swap/v2";
const HOST_JUPITER = "api.jup.ag";

export interface ConfigJupiter {
  /** `autenticada` = `x-api-key` presente; `sem-chave` = mesmo host, sem header (0,5 req/s). */
  modo: "autenticada" | "sem-chave";
  base: string;
  /** Headers comuns de toda chamada à Jupiter (a chave, quando houver). NUNCA logar. */
  headers: Record<string, string>;
  /** `JUPITER_BASE_URL` ignorada por apontar para fora de `https://api.jup.ag` (motivo, sem segredo). */
  incoerencia: string | null;
}

/**
 * ⚠️ A REGRA (lida a cada chamada — a env pode mudar entre deploys/testes):
 *
 *   · O host é SEMPRE `https://api.jup.ag`. `JUPITER_BASE_URL` só vale se for
 *     `https://api.jup.ag/...`; qualquer outro host (a `lite-api`, um proxy, http) é IGNORADO
 *     e vira `incoerencia` — a chave nunca sai para outro lugar.
 *   · `JUPITER_API_KEY` preenchida → `autenticada` (`x-api-key`); vazia → `sem-chave`.
 *
 * Sem chave a Jupiter ainda funciona (0,5 req/s, 429 mais cedo): o swap nunca para por
 * configuração; quem chama torna isso VISÍVEL (`/api/quote` avisa o dono em produção).
 */
export function configJupiter(): ConfigJupiter {
  const chave = (process.env.JUPITER_API_KEY ?? "").trim();
  const override = (process.env.JUPITER_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const ehJupiter = (u: string) => {
    try { const x = new URL(u); return x.protocol === "https:" && x.host === HOST_JUPITER; }
    catch { return false; }
  };
  const modo = chave ? "autenticada" as const : "sem-chave" as const;
  const headers: Record<string, string> = chave ? { "x-api-key": chave } : {};
  if (override && !ehJupiter(override)) {
    return { modo, base: JUPITER_BASE, headers,
      incoerencia: "JUPITER_BASE_URL ignorada: a base tem de ser https://api.jup.ag (a chave nunca sai para outro host)" };
  }
  return { modo, base: override || JUPITER_BASE, headers, incoerencia: null };
}

/** Tipo de falha da Jupiter, para operação distinguir 429 de chave recusada de rede. */
export type TipoFalhaJupiter = "limite" | "chave" | "http" | "conexao";

/** Erro da Jupiter com o modo e o tipo — a mensagem nunca carrega a chave. */
export class JupiterError extends Error {
  constructor(message: string, readonly tipo: TipoFalhaJupiter, readonly modo: ConfigJupiter["modo"], readonly status?: number) {
    super(message);
    this.name = "JupiterError";
  }
}

/** Tira a chave de qualquer texto que vá para mensagem/log (corpo de erro do upstream incluso). */
function semChave(texto: string): string {
  const chave = (process.env.JUPITER_API_KEY ?? "").trim();
  return chave ? texto.split(chave).join("[redacted]") : texto;
}

/** Jupiter address for native SOL (wrapped SOL mint). */
export const JUPITER_SOL_MINT = "So11111111111111111111111111111111111111112";

// ─── Formato devolvido ao resto do app (o mesmo da v1: o navegador não muda) ─

export interface JupRoutePlanStep {
  swapInfo: {
    ammKey:    string;
    label?:    string;            // e.g. "Raydium", "Orca", "Meteora DLMM"
    inputMint: string;
    outputMint: string;
    inAmount:  string;
    outAmount: string;
    feeAmount?: string;
    feeMint?:   string;
  };
  percent:  number;               // 0-100
  bps?:     number;               // 0-10000 (v2)
}

export interface JupQuote {
  inputMint:           string;
  inAmount:            string;
  outputMint:          string;
  outAmount:           string;
  otherAmountThreshold: string;   // minBuyAmount equivalent
  swapMode:            "ExactIn" | "ExactOut";
  slippageBps:         number;
  /**
   * Taxa da plataforma CONFIRMADA na instrução de swap (`taxaNaInstrucao`). O `/build` não devolve
   * este campo: ele só existe aqui quando o `feeAccount` pedido está nas contas da `swapInstruction`.
   */
  platformFee?: {
    feeBps:  number;
    feeAccount: string;
  };
  priceImpactPct:      string;
  routePlan:           JupRoutePlanStep[];
}

export interface JupSwapResponse {
  swapTransaction:           string;     // base64-encoded VersionedTransaction (v0), sem assinatura
  lastValidBlockHeight:      number;
  computeUnitLimit?:         number;
  /** W3: vínculo HMAC desta transação com a cotação do servidor (`lib/solana/vinculo.ts`). */
  vinculo?:                  string;
}

// ─── Resposta crua do `/build` ──────────────────────────────────────

export interface JupInstrucao {
  programId: string;
  accounts:  { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data:      string;                     // base64
}

export interface JupBuild {
  inputMint: string; outputMint: string; inAmount: string; outAmount: string;
  otherAmountThreshold: string; swapMode: "ExactIn"; slippageBps: number; priceImpactPct: string;
  routePlan: JupRoutePlanStep[];
  computeBudgetInstructions: JupInstrucao[];
  setupInstructions: JupInstrucao[];
  swapInstruction: JupInstrucao;
  cleanupInstruction: JupInstrucao | null;
  otherInstructions: JupInstrucao[];
  tipInstruction: JupInstrucao | null;
  addressesByLookupTableAddress: Record<string, string[]> | null;
  blockhashWithMetadata: { blockhash: number[]; lastValidBlockHeight: number };
  transactionVersion: number | string;
}

// ─── Args ───────────────────────────────────────────────────────────

export interface BuildArgs {
  inputMint:  string;
  outputMint: string;
  amount:     string;     // base units (lamports for SOL, decimals for SPL)
  slippageBps?: number;   // 1-5000 (default 50)
  /**
   * Carteira de quem troca — o `/build` EXIGE (400 sem ela). Na lista sem carteira conectada,
   * `fetchJupiterQuote` usa a carteira de taxa da plataforma SÓ para cotar: nada é assinado e a
   * lista não devolve instrução nenhuma (A33).
   */
  taker?: string;
  /**
   * Taxa da plataforma (L-061). ⚠️ Sempre junto com `feeAccount` (conta de token de um dos mints,
   * conferida na rede por `lib/solana/conta-de-taxa.ts`). O `outAmount` volta já líquido.
   */
  platformFeeBps?: number;
  feeAccount?: string;
  /** Contas da ROTA (1–64, padrão da Jupiter 64). Reduzido quando a transação montada não cabe. */
  maxAccounts?: number;
}

/** Envolve o fetch para que uma falha de CONEXÃO deixe rastro utilizável.
 *
 * O `fetch` do Node lança literalmente "fetch failed" quando o host não resolve ou recusa
 * conexão — sem status, sem URL, sem causa. Aqui o erro diz QUAL host falhou e a causa raiz.
 *
 * L-062A: é o ÚNICO lugar que monta a URL (`configJupiter().base` + path) e aplica os headers
 * comuns (`x-api-key`) sem sobrescrever os da chamada. Toda falha vira `JupiterError` com `tipo`
 * (limite=429 · chave=401/403 · http · conexao) e `modo` (autenticada/sem-chave), e sai um log
 * `[jupiter] {modo,tipo,status,host}` (também no sucesso, `tipo: "ok"`) — sem a chave, que também
 * é tirada do corpo de erro devolvido pela Jupiter.
 */
export interface OpcoesJupiter {
  /** Chamado quando a Jupiter recusa a chave (401/403) — a chamada é refeita sem ela. */
  aoRecusarChave?: (status: number) => void;
}

async function jupFetch(path: string, init: RequestInit = {}, opts: OpcoesJupiter & { semChave?: boolean } = {}): Promise<Response> {
  const base = configJupiter();
  const cfg: ConfigJupiter = opts.semChave ? { ...base, modo: "sem-chave", headers: {} } : base;
  const url = `${cfg.base}${path}`;
  // Headers da chamada preservados; a chave entra só se a chamada não trouxe uma.
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(cfg.headers)) if (!headers.has(k)) headers.set(k, v);
  const host = (() => { try { return new URL(url).host; } catch { return "?"; } })();
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    const hint =
      cause === "ENOTFOUND" ? " — host não existe (endpoint desligado?)"
      : cause === "ECONNREFUSED" ? " — conexão recusada"
      : cause === "ETIMEDOUT" ? " — timeout de conexão"
      : "";
    console.warn("[jupiter]", JSON.stringify({ modo: cfg.modo, tipo: "conexao", host, cause: cause ?? null }));
    throw new JupiterError(`Jupiter inacessível em ${host}${hint}${cause ? ` [${cause}]` : ""} [${cfg.modo}]`, "conexao", cfg.modo);
  }
  // ⚠️ Chave RECUSADA (401/403): mesmo padrão do LI.FI (`fetchLiFiQuote`) — refaz UMA vez sem
  // a chave (mesmo host, acesso sem chave) e avisa quem chamou. Uma chave errada na Vercel não
  // pode parar todo swap da Solana; o aviso existe para ela ser corrigida.
  if ((res.status === 401 || res.status === 403) && cfg.modo === "autenticada") {
    console.warn("[jupiter]", JSON.stringify({ modo: cfg.modo, tipo: "chave", status: res.status, host, refazendo: "sem-chave" }));
    opts.aoRecusarChave?.(res.status);
    return jupFetch(path, init, { semChave: true });
  }
  if (!res.ok) {
    const tipo: TipoFalhaJupiter = res.status === 429 ? "limite" : res.status === 401 || res.status === 403 ? "chave" : "http";
    console.warn("[jupiter]", JSON.stringify({ modo: cfg.modo, tipo, status: res.status, host }));
    const text = semChave(await res.text().catch(() => ""));
    throw new JupiterError(`Jupiter build ${res.status} [${cfg.modo}]: ${text.slice(0, 240)}`, tipo, cfg.modo, res.status);
  }
  // Sucesso também deixa rastro (sem segredo): é o que prova, nos logs, se a chamada foi autenticada.
  console.info("[jupiter]", JSON.stringify({ modo: cfg.modo, tipo: "ok", status: res.status, host }));
  return res;
}

// ─── Chamadas ───────────────────────────────────────────────────────

/** `GET /build`. Taxa sem conta (ou conta sem taxa) é erro de programação: recusa antes de chamar. */
export async function fetchJupiterBuild(args: BuildArgs & { taker: string }, opts: OpcoesJupiter = {}, init: RequestInit = { cache: "no-store" }): Promise<JupBuild> {
  const fee = args.platformFeeBps ?? 0;
  if ((fee > 0) !== !!args.feeAccount) {
    throw new Error("Jupiter: platformFeeBps e feeAccount andam juntos (L-061)");
  }
  const params = new URLSearchParams({
    inputMint:   args.inputMint,
    outputMint:  args.outputMint,
    amount:      args.amount,
    taker:       args.taker,
    slippageBps: String(args.slippageBps ?? 50),
  });
  if (args.maxAccounts) params.set("maxAccounts", String(args.maxAccounts));
  if (fee > 0) {
    params.set("platformFeeBps", String(fee));
    params.set("feeAccount", args.feeAccount!);
  }
  const res = await jupFetch(`/build?${params.toString()}`, { ...init, headers: { Accept: "application/json" } }, opts);
  return res.json() as Promise<JupBuild>;
}

/**
 * ⚠️ A PROVA DE QUE A TAXA ENTROU. O `/build` não devolve `platformFee`; com taxa, o `feeAccount`
 * passa a ser uma das contas da `swapInstruction` (medido 16/10: presente com taxa, ausente sem).
 * Sem essa conta na instrução a Jupiter não vai cobrar — e a tela não pode dizer que cobra.
 */
export function taxaNaInstrucao(build: JupBuild, feeAccount: string | undefined): boolean {
  if (!feeAccount) return false;
  return (build.swapInstruction?.accounts ?? []).some((a) => a.pubkey === feeAccount);
}

/** O `/build` no formato de cotação que o resto do app (e o navegador) já conhece. */
export function quoteDoBuild(build: JupBuild, pedido: Pick<BuildArgs, "platformFeeBps" | "feeAccount"> = {}): JupQuote {
  const fee = pedido.platformFeeBps ?? 0;
  return {
    inputMint: build.inputMint, inAmount: build.inAmount,
    outputMint: build.outputMint, outAmount: build.outAmount,
    otherAmountThreshold: build.otherAmountThreshold,
    swapMode: "ExactIn", slippageBps: build.slippageBps, priceImpactPct: build.priceImpactPct,
    routePlan: build.routePlan ?? [],
    ...(fee > 0 && taxaNaInstrucao(build, pedido.feeAccount)
      ? { platformFee: { feeBps: fee, feeAccount: pedido.feeAccount! } } : {}),
  };
}

/**
 * Cotação para a LISTA (indicativa). `taker` ausente → carteira de taxa da plataforma, só para
 * cotar (o `/build` exige um). Cache curto: lista não leva transação.
 */
export async function fetchJupiterQuote(args: BuildArgs, opts: OpcoesJupiter = {}): Promise<JupQuote> {
  const build = await fetchJupiterBuild({ ...args, taker: args.taker || CARTEIRA_TAXA_SOLANA }, opts,
    { next: { revalidate: 5 } } as RequestInit);
  return quoteDoBuild(build, args);
}

/** Cotação FIRME: um `/build` para a carteira de quem troca + a transação montada aqui. */
export async function fetchJupiterFirm(args: BuildArgs & { taker: string }, opts: OpcoesJupiter = {}): Promise<{ quote: JupQuote; swap: JupSwapResponse }> {
  const build = await fetchJupiterBuild(args, opts);
  try {
    return { quote: quoteDoBuild(build, args), swap: await montarTransacaoJupiter(build, args.taker) };
  } catch (e) {
    if (!(e instanceof TransacaoGrandeError) || args.maxAccounts) throw e;
    // ⚠️ Rota longa demais para UMA transação (L-062B, produção 16/10: JUP→WIF em 5 trechos deu 65
    // contas). Refaz UMA vez pedindo uma rota menor — preço um pouco pior, mas o swap sai.
    console.warn("[jupiter]", JSON.stringify({ tipo: "tx-grande", contas: e.contas, bytes: e.bytes, refazendo: { maxAccounts: MAX_ACCOUNTS_REDUZIDO } }));
    const menor = { ...args, maxAccounts: MAX_ACCOUNTS_REDUZIDO };
    const b2 = await fetchJupiterBuild(menor, opts);
    return { quote: quoteDoBuild(b2, menor), swap: await montarTransacaoJupiter(b2, args.taker) };
  }
}

// ─── Montagem da transação (v0) ─────────────────────────────────────

/**
 * ⚠️ LIMITES DE UMA TRANSAÇÃO SOLANA. No `/swap` da v1 a Jupiter montava a transação e cuidava
 * disto; no `/build` quem monta somos nós. Estourar = a rede recusa (`TooManyAccountLocks` acima
 * de 64 contas; pacote acima de 1232 bytes) — visto em produção em 16/10 (65 contas, rollback).
 */
export const MAX_CONTAS_TX = 64;
export const MAX_BYTES_TX = 1232;
/** `maxAccounts` da segunda tentativa quando a rota não coube (a docs da Jupiter indica reduzir). */
export const MAX_ACCOUNTS_REDUZIDO = 40;

/** A transação montada não cabe numa transação Solana — nunca é devolvida ao navegador. */
export class TransacaoGrandeError extends Error {
  constructor(readonly contas: number, readonly bytes: number) {
    super(`Jupiter: transação grande demais (${contas} contas / ${bytes} bytes; limite ${MAX_CONTAS_TX} / ${MAX_BYTES_TX})`);
    this.name = "TransacaoGrandeError";
  }
}

/** Contas travadas (estáticas + via lookup table) e tamanho serializado (com 1 assinatura). */
export function tamanhoDaTransacao(tx: VersionedTransaction): { contas: number; bytes: number } {
  const viaAlt = tx.message.addressTableLookups.reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0);
  // O web3.js serializa a mensagem num buffer de 1232 bytes: acima disso ele LANÇA — também é "não cabe".
  let bytes: number;
  try { bytes = tx.serialize().length; } catch { bytes = MAX_BYTES_TX + 1; }
  return { contas: tx.message.staticAccountKeys.length + viaAlt, bytes };
}

/** Teto de compute units de uma transação Solana. */
export const CU_TETO = 1_400_000;
/**
 * Teto do preço de CU (micro-lamports). A docs da Jupiter manda validar: o preço segue as taxas
 * recentes e dá pico quando blocos trazem lances extremos. 1.000.000 µlamports × 1,4 M CU = 0,0014 SOL
 * no pior caso — prioridade alta sem deixar um pico esvaziar a carteira de alguém.
 */
export const CU_PRECO_TETO = 1_000_000;

const instrucao = (i: JupInstrucao) => new TransactionInstruction({
  programId: new PublicKey(i.programId),
  keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(i.data, "base64"),
});

/** Preço de CU da Jupiter (SetComputeUnitPrice = discriminador 3, u64 LE), com teto; sem preço → null. */
function precoDeCu(build: JupBuild): number | null {
  for (const i of build.computeBudgetInstructions ?? []) {
    const d = Buffer.from(i.data, "base64");
    if (d[0] === 3 && d.length >= 9) return Number(d.readBigUInt64LE(1));
  }
  return null;
}

function compilar(build: JupBuild, taker: string, limite: number): VersionedTransaction {
  const alts = Object.entries(build.addressesByLookupTableAddress ?? {}).map(([chave, enderecos]) =>
    new AddressLookupTableAccount({
      key: new PublicKey(chave),
      state: {
        deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0,
        addresses: enderecos.map((e) => new PublicKey(e)),
      },
    }));
  const preco = precoDeCu(build);
  const instrucoes = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: limite }),
    ...(preco != null ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.min(preco, CU_PRECO_TETO) })] : []),
    // Qualquer outra instrução de compute budget da Jupiter fica de fora: duplicata derruba a tx.
    ...(build.setupInstructions ?? []).map(instrucao),
    instrucao(build.swapInstruction),
    ...(build.cleanupInstruction ? [instrucao(build.cleanupInstruction)] : []),
    ...(build.otherInstructions ?? []).map(instrucao),
  ];
  const msg = new TransactionMessage({
    payerKey: new PublicKey(taker),
    // 32 bytes → base58: a mesma codificação de uma chave pública.
    recentBlockhash: new PublicKey(Uint8Array.from(build.blockhashWithMetadata.blockhash)).toBase58(),
    instructions: instrucoes,
  }).compileToV0Message(alts);
  return new VersionedTransaction(msg);
}

/** Compute units consumidas numa simulação sem assinatura; null se a simulação falhar. */
async function simularCu(tx: VersionedTransaction): Promise<{ cu: number } | { cu: null; porque: string }> {
  try {
    const res = await fetch(rpcSolanaServidor(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "simulateTransaction", params: [
        Buffer.from(tx.serialize()).toString("base64"),
        { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "processed" },
      ] }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return { cu: null, porque: `RPC HTTP ${res.status}` };
    const j = await res.json() as { result?: { value?: { err?: unknown; unitsConsumed?: number } } };
    const v = j.result?.value;
    if (!v) return { cu: null, porque: "simulação sem resultado" };
    if (v.err) return { cu: null, porque: `simulação recusou: ${JSON.stringify(v.err).slice(0, 80)}` };
    return typeof v.unitsConsumed === "number" && v.unitsConsumed > 0
      ? { cu: v.unitsConsumed } : { cu: null, porque: "simulação sem unitsConsumed" };
  } catch (e) {
    return { cu: null, porque: `simulação falhou: ${e instanceof Error ? e.message.slice(0, 80) : "erro"}` };
  }
}

/**
 * ⚠️ Monta a transação que o usuário vai assinar — v0, pagador = `taker`, blockhash e lookup tables
 * da própria resposta do `/build`. Limite de CU = simulação × 1,2 (teto 1,4 M), como manda a docs da
 * Jupiter; simulação falhou (ex.: saldo insuficiente — o swap falharia de qualquer jeito) → teto.
 * O web3.js nunca põe um programa invocado numa lookup table, então o guard do navegador
 * (`solana-guard.ts`) continua enxergando todos os programas.
 */
export async function montarTransacaoJupiter(build: JupBuild, taker: string): Promise<JupSwapResponse> {
  if (String(build.transactionVersion ?? "0") !== "0") {
    throw new Error(`Jupiter: transactionVersion ${build.transactionVersion} não suportada (só v0)`);
  }
  const rascunho = compilar(build, taker, CU_TETO);
  // Antes de simular: uma transação que não cabe nunca sai daqui (o limite de CU não muda o tamanho).
  const t = tamanhoDaTransacao(rascunho);
  if (t.contas > MAX_CONTAS_TX || t.bytes > MAX_BYTES_TX) throw new TransacaoGrandeError(t.contas, t.bytes);
  const sim = await simularCu(rascunho);
  const limite = sim.cu != null ? Math.min(CU_TETO, Math.ceil(sim.cu * 1.2)) : CU_TETO;
  if (sim.cu == null) console.warn("[jupiter]", JSON.stringify({ tipo: "simulacao", porque: sim.porque, limite }));
  const tx = compilar(build, taker, limite);
  return {
    swapTransaction: Buffer.from(tx.serialize()).toString("base64"),
    lastValidBlockHeight: build.blockhashWithMetadata.lastValidBlockHeight,
    computeUnitLimit: limite,
  };
}
