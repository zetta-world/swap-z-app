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
 * `lite-api.jup.ag` é o nível gratuito (sem chave). `api.jup.ag` é o nível pago
 * e exige chave — por isso a base é configurável: quando o volume justificar
 * uma chave, muda-se a env e nada no código precisa mudar.
 *
 * Jupiter roteia por todas as AMMs relevantes de Solana (Raydium, Orca,
 * Meteora, Phoenix, Lifinity, OpenBook, Whirlpool) e cuida sozinho do
 * wrap/unwrap de SOL nativo quando `wrapAndUnwrapSol = true`.
 */

export const JUPITER_BASE =
  process.env.JUPITER_BASE_URL ?? "https://lite-api.jup.ag/swap/v1";

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
}

interface SwapArgs {
  quoteResponse:     JupQuote;
  userPublicKey:     string;
  wrapAndUnwrapSol?: boolean;
  /** Optional priority fee tip in lamports. */
  prioritizationFeeLamports?: number | "auto";
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
 */
async function jupFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    const hint =
      cause === "ENOTFOUND" ? " — host não existe (endpoint desligado?)"
      : cause === "ECONNREFUSED" ? " — conexão recusada"
      : cause === "ETIMEDOUT" ? " — timeout de conexão"
      : "";
    throw new Error(`Jupiter inacessível em ${host}${hint}${cause ? ` [${cause}]` : ""}`);
  }
}

// ─── Calls ──────────────────────────────────────────────────────────

/**
 * Fetch a quote (indicative if `userPublicKey` is omitted; the same quote
 * is also passed to /v6/swap to build the transaction).
 */
export async function fetchJupiterQuote(args: QuoteArgs): Promise<JupQuote> {
  const params = new URLSearchParams({
    inputMint:    args.inputMint,
    outputMint:   args.outputMint,
    amount:       args.amount,
    slippageBps:  String(args.slippageBps ?? 50),
    swapMode:     "ExactIn",
  });
  if (args.onlyDirectRoutes) params.set("onlyDirectRoutes", "true");

  const res = await jupFetch(`${JUPITER_BASE}/quote?${params.toString()}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 5 },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jupiter ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json() as Promise<JupQuote>;
}

/**
 * Build a swap transaction from a previously-fetched quote. The returned
 * base64 transaction must be signed by the user wallet (Phantom / Solflare)
 * and submitted to the Solana RPC.
 */
export async function fetchJupiterSwap(args: SwapArgs): Promise<JupSwapResponse> {
  const body = {
    quoteResponse:    args.quoteResponse,
    userPublicKey:    args.userPublicKey,
    wrapAndUnwrapSol: args.wrapAndUnwrapSol ?? true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: args.prioritizationFeeLamports ?? "auto",
  };
  const res = await jupFetch(`${JUPITER_BASE}/swap`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Jupiter swap ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json() as Promise<JupSwapResponse>;
}
