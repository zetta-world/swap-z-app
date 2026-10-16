/**
 * Jupiter Swap API — agregador de Solana.
 *
 *   GET  /quote  — cotação (indicativa e firme, mesmo endpoint)
 *   POST /swap   — monta a transação (base64, pronta para assinar)
 *
 * ⚠ MIGRAÇÃO 29/07 — O HOST ANTIGO MORREU.
 *
 * Isto apontava para `https://quote-api.jup.ag/v6`. Esse hostname deixou de
 * existir: NÃO RESOLVE MAIS EM DNS (NXDOMAIN), não é 404 nem 410 — o host foi
 * desligado pela Jupiter. Como o erro acontece na CONEXÃO, ele chega como
 * "fetch failed" genérico, sem status HTTP: por isso passou despercebido em vez
 * de aparecer como uma falha de API legível.
 *
 * O efeito era silencioso e total: TODO swap de Solana da plataforma estava
 * quebrado, não só a sonda do guard. Foi a sonda que expôs o problema.
 *
 * CHAVE (L-062A, 16/10): `api.jup.ag` é o endpoint AUTENTICADO — exige o header
 * `x-api-key`, mas NÃO significa "nível pago": a Jupiter dá chave gratuita
 * (plano Free, 1 req/s) e os planos pagos usam o MESMO host. `lite-api.jup.ag`
 * é o acesso SEM chave (0,5 req/s, e foi lá que vimos 429 em 16/10). A chave foi
 * criada pelo dono em 16/10 e vive SÓ na Vercel (`JUPITER_API_KEY`, servidor);
 * o código nunca a contém. Regras em `configJupiter()`.
 *
 * Jupiter roteia por todas as AMMs relevantes de Solana (Raydium, Orca,
 * Meteora, Phoenix, Lifinity, OpenBook, Whirlpool) e cuida sozinho do
 * wrap/unwrap de SOL nativo quando `wrapAndUnwrapSol = true`.
 */

export const JUPITER_BASE_AUTENTICADA = "https://api.jup.ag/swap/v1";
export const JUPITER_BASE_SEM_CHAVE = "https://lite-api.jup.ag/swap/v1";
const HOST_AUTENTICADO = "api.jup.ag";

export interface ConfigJupiter {
  /** `autenticada` = `api.jup.ag` + `x-api-key`; `sem-chave` = `lite-api`, sem header. */
  modo: "autenticada" | "sem-chave";
  base: string;
  /** Headers comuns de toda chamada à Jupiter (a chave, quando houver). NUNCA logar. */
  headers: Record<string, string>;
  /** `JUPITER_BASE_URL` ignorado por ser incoerente com a chave (motivo, sem segredo). */
  incoerencia: string | null;
}

/**
 * ⚠️ A REGRA (lida a cada chamada — a env pode mudar entre deploys/testes):
 *
 *   · `JUPITER_API_KEY` preenchida → modo `autenticada`: host `api.jup.ag` e `x-api-key`.
 *     `JUPITER_BASE_URL` só vale se for `https://api.jup.ag/...`; qualquer outro host
 *     (a `lite-api`, um proxy, http) é IGNORADO e vira `incoerencia` — a chave só sai
 *     para o host da Jupiter que a exige, nunca para outro lugar.
 *   · Sem chave → modo `sem-chave`: `JUPITER_BASE_URL` ou a `lite-api`. Uma base em
 *     `api.jup.ag` sem chave daria 401 em todo swap → ignorada, `lite-api` + `incoerencia`.
 *
 * Sem chave a Jupiter ainda funciona (mais devagar, 429 mais cedo): o swap nunca para
 * por configuração; quem chama torna isso VISÍVEL (`/api/quote` avisa o dono em produção).
 */
export function configJupiter(): ConfigJupiter {
  const chave = (process.env.JUPITER_API_KEY ?? "").trim();
  const override = (process.env.JUPITER_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const ehAutenticada = (u: string) => {
    try { const x = new URL(u); return x.protocol === "https:" && x.host === HOST_AUTENTICADO; }
    catch { return false; }
  };
  if (chave) {
    if (override && !ehAutenticada(override)) {
      return { modo: "autenticada", base: JUPITER_BASE_AUTENTICADA, headers: { "x-api-key": chave },
        incoerencia: "JUPITER_BASE_URL ignorada: com JUPITER_API_KEY a base tem de ser https://api.jup.ag" };
    }
    return { modo: "autenticada", base: override || JUPITER_BASE_AUTENTICADA, headers: { "x-api-key": chave }, incoerencia: null };
  }
  if (override && ehAutenticada(override)) {
    return { modo: "sem-chave", base: JUPITER_BASE_SEM_CHAVE, headers: {},
      incoerencia: "JUPITER_BASE_URL aponta para api.jup.ag sem JUPITER_API_KEY (daria 401) — usando lite-api" };
  }
  return { modo: "sem-chave", base: override || JUPITER_BASE_SEM_CHAVE, headers: {}, incoerencia: null };
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

// ─── Quote response ─────────────────────────────────────────────────

export interface JupRoutePlanStep {
  swapInfo: {
    ammKey:    string;
    label?:    string;            // e.g. "Raydium", "Orca", "Meteora DLMM"
    inputMint: string;
    outputMint: string;
    inAmount:  string;
    outAmount: string;
    feeAmount: string;
    feeMint:   string;
  };
  percent:  number;               // 0-100
}

export interface JupQuote {
  inputMint:           string;
  inAmount:            string;
  outputMint:          string;
  outAmount:           string;
  otherAmountThreshold: string;   // minBuyAmount equivalent
  swapMode:            "ExactIn" | "ExactOut";
  slippageBps:         number;
  platformFee?: {
    amount:  string;
    feeBps:  number;
  };
  priceImpactPct:      string;
  routePlan:           JupRoutePlanStep[];
  contextSlot?:        number;
  timeTaken?:          number;
}

// ─── Swap response ──────────────────────────────────────────────────

export interface JupSwapResponse {
  swapTransaction:           string;     // base64-encoded VersionedTransaction
  lastValidBlockHeight:      number;
  prioritizationFeeLamports?: number;
}

// ─── Args ───────────────────────────────────────────────────────────

interface QuoteArgs {
  inputMint:  string;
  outputMint: string;
  amount:     string;     // base units (lamports for SOL, decimals for SPL)
  slippageBps?: number;   // 1-5000 (default 50)
  /** Skip indirect routes — only direct AMM pairs. Defaults false. */
  onlyDirectRoutes?: boolean;
  /**
   * Taxa da plataforma (L-061, 16/10). ⚠️ Só com `feeAccount` no `/swap` da MESMA cotação — a rota
   * decide os dois juntos (`lib/solana/conta-de-taxa.ts`). O `outAmount` volta já líquido.
   */
  platformFeeBps?: number;
}

interface SwapArgs {
  quoteResponse:     JupQuote;
  userPublicKey:     string;
  wrapAndUnwrapSol?: boolean;
  /** Optional priority fee tip in lamports. */
  prioritizationFeeLamports?: number | "auto";
  /** CONTA DE TOKEN que recebe a taxa (mint de um dos lados). Exigida quando a cotação teve `platformFeeBps`. */
  feeAccount?: string;
}


/**
 * Envolve o fetch para que uma falha de CONEXÃO deixe rastro utilizável.
 *
 * O `fetch` do Node lança literalmente "fetch failed" quando o host não
 * resolve ou recusa conexão — sem status, sem URL, sem causa. Foi exatamente
 * assim que a morte do `quote-api.jup.ag` ficou invisível: parecia erro
 * genérico de rede, e não "o endereço que a gente chama não existe mais".
 *
 * Aqui o erro passa a dizer QUAL host falhou e QUAL foi a causa raiz, para que
 * o próximo desligamento de endpoint seja diagnosticado em segundos.
 *
 * L-062A: é também o ÚNICO lugar que monta a URL (`configJupiter().base` + path) e
 * aplica os headers comuns (`x-api-key`) sem sobrescrever os da chamada. Toda falha
 * vira `JupiterError` com `tipo` (limite=429 · chave=401/403 · http · conexao) e
 * `modo` (autenticada/sem-chave), e sai um log `[jupiter] {modo,tipo,status,host}`
 * — sem a chave, que também é tirada do corpo de erro devolvido pela Jupiter.
 */
export interface OpcoesJupiter {
  /** Chamado quando a Jupiter recusa a chave (401/403) — a chamada é refeita sem ela. */
  aoRecusarChave?: (status: number) => void;
}

async function jupFetch(path: string, init: RequestInit = {}, opts: OpcoesJupiter & { semChave?: boolean } = {}): Promise<Response> {
  const cfg: ConfigJupiter = opts.semChave
    ? { modo: "sem-chave", base: JUPITER_BASE_SEM_CHAVE, headers: {}, incoerencia: null }
    : configJupiter();
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
  // a chave, na `lite-api`, e avisa quem chamou. Uma chave errada na Vercel não pode parar
  // todo swap da Solana; o aviso existe para ela ser corrigida.
  if ((res.status === 401 || res.status === 403) && cfg.modo === "autenticada" && !opts.semChave) {
    console.warn("[jupiter]", JSON.stringify({ modo: cfg.modo, tipo: "chave", status: res.status, host, refazendo: "sem-chave" }));
    opts.aoRecusarChave?.(res.status);
    return jupFetch(path, init, { semChave: true });
  }
  if (!res.ok) {
    const tipo: TipoFalhaJupiter = res.status === 429 ? "limite" : res.status === 401 || res.status === 403 ? "chave" : "http";
    console.warn("[jupiter]", JSON.stringify({ modo: cfg.modo, tipo, status: res.status, host }));
    const text = semChave(await res.text().catch(() => ""));
    const rotulo = path.startsWith("/swap") ? "Jupiter swap" : "Jupiter";
    throw new JupiterError(`${rotulo} ${res.status} [${cfg.modo}]: ${text.slice(0, 240)}`, tipo, cfg.modo, res.status);
  }
  return res;
}

// ─── Calls ──────────────────────────────────────────────────────────

/**
 * Fetch a quote (indicative if `userPublicKey` is omitted; the same quote
 * is also passed to /v6/swap to build the transaction).
 */
export async function fetchJupiterQuote(args: QuoteArgs, opts: OpcoesJupiter = {}): Promise<JupQuote> {
  const params = new URLSearchParams({
    inputMint:    args.inputMint,
    outputMint:   args.outputMint,
    amount:       args.amount,
    slippageBps:  String(args.slippageBps ?? 50),
    swapMode:     "ExactIn",
  });
  if (args.onlyDirectRoutes) params.set("onlyDirectRoutes", "true");
  if ((args.platformFeeBps ?? 0) > 0) params.set("platformFeeBps", String(args.platformFeeBps));

  const res = await jupFetch(`/quote?${params.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 5 },
  }, opts);
  return res.json() as Promise<JupQuote>;
}

/**
 * Build a swap transaction from a previously-fetched quote. The returned
 * base64 transaction must be signed by the user wallet (Phantom / Solflare)
 * and submitted to the Solana RPC.
 */
export async function fetchJupiterSwap(args: SwapArgs, opts: OpcoesJupiter = {}): Promise<JupSwapResponse> {
  const body = {
    quoteResponse:    args.quoteResponse,
    userPublicKey:    args.userPublicKey,
    wrapAndUnwrapSol: args.wrapAndUnwrapSol ?? true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: args.prioritizationFeeLamports ?? "auto",
    ...(args.feeAccount ? { feeAccount: args.feeAccount } : {}),
  };
  const res = await jupFetch("/swap", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body:    JSON.stringify(body),
  }, opts);
  return res.json() as Promise<JupSwapResponse>;
}
