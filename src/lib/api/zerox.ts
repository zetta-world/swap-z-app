/**
 * 0x Swap API v2 — AllowanceHolder flow.
 *
 * Two endpoints:
 *   - /swap/allowance-holder/price  → indicative quote (no allowance needed)
 *                                     Used for live preview as the user types.
 *   - /swap/allowance-holder/quote  → firm quote with ready-to-send calldata
 *                                     Used when the user clicks Execute.
 *
 * Why AllowanceHolder over Permit2: a swap is a SINGLE eth_sendTransaction —
 * no EIP-712 typed-data signature, no signature-appending to calldata. The
 * Permit2 sign-then-send double wallet popup was failing constantly on
 * mobile in-app browsers (the wallet drops the second request while the
 * first dialog is still closing).
 *
 * Flow when selling ERC-20 (first time per token):
 *   1. fetch /quote → `issues.allowance` is set
 *   2. approve(issues.allowance.spender, MaxUint256)   — one-time tx
 *   3. re-fetch /quote (fresh calldata after the approval wait)
 *   4. sendTransaction({ to, data, value, gas })
 *
 * Flow when allowance already granted, or selling chain-native:
 *   1. fetch /quote → `issues.allowance` is null
 *   2. sendTransaction({ to, data, value, gas })       — that's it
 */

import type { ChainId } from "../chains";

const BASE_URL = "https://api.0x.org";

// Mapping from internal ChainId to 0x's numeric chainId
export const ZEROX_CHAIN_IDS: Partial<Record<ChainId, number>> = {
  ethereum:  1,
  bsc:       56,
  polygon:   137,
  base:      8453,
  arbitrum:  42161,
  optimism:  10,
  avalanche: 43114,
};

// Special address 0x uses to represent the chain's native currency
export const ZEROX_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export function isZeroXSupported(chain: ChainId): boolean {
  return chain in ZEROX_CHAIN_IDS;
}

// ─── 0x API response types ───────────────────────────────────────────

export interface ZxFill {
  source:        string;        // e.g. "Uniswap_V3"
  proportionBps: number;        // share of the swap (0-10000)
  from:          string;
  to:            string;
}

export interface ZxFee {
  amount:      string;          // base units
  token:       string;
  type:        "volume" | "gas" | "zeroex";
}

export interface ZxIssue {
  allowance?:  { actual: string; spender: string };
  balance?:    { token: string; actual: string; expected: string };
  simulationIncomplete?: boolean;
  invalidSourcesPassed?: string[];
}

export interface ZxTransaction {
  to:    string;
  data:  string;
  gas:   string | null;
  gasPrice: string | null;
  value: string;
}

export interface ZxRoute {
  fills: ZxFill[];
  tokens: { address: string; symbol: string }[];
}

export interface ZxPriceResponse {
  blockNumber:      string;
  buyAmount:        string;
  buyToken:         string;
  sellAmount:       string;
  sellToken:        string;
  minBuyAmount:     string;
  gas:              string | null;
  gasPrice:         string | null;
  liquidityAvailable: boolean;
  route:            ZxRoute;
  fees:             { integratorFee?: ZxFee | null; zeroExFee?: ZxFee | null; gasFee?: ZxFee | null };
  issues?:          ZxIssue;
  totalNetworkFee:  string | null;
}

export interface ZxQuoteResponse extends ZxPriceResponse {
  transaction:  ZxTransaction;
}

// ─── Server-side fetchers (called from /api/quote) ───────────────────

interface QuoteArgs {
  chainId:      number;
  sellToken:    string;   // address or ZEROX_NATIVE
  buyToken:     string;
  sellAmount:   string;   // base units, decimal string
  taker?:       string;   // user's address (recommended)
  slippageBps?: number;
  /**
   * Taxa da plataforma, em pontos-base (Fase 9.2). Só é enviada com
   * `feeRecipient` junto — ver a nota em `aplicarTaxa`.
   */
  feeBps?:      number;
  feeRecipient?: string;
}

/**
 * O token em que a taxa é retida.
 *
 * ⚠️ ESTA FUNÇÃO NASCEU DE UMA HIPÓTESE QUE SE PROVOU FALSA, e o comentário
 * fica para ninguém repetir o caminho.
 *
 * Em 11/08 dois swaps compraram BNB nativo e voltaram com `integratorFee:
 * null`. Eu concluí "o 0x não retém taxa em nativo" e escrevi isto. Errado: a
 * cotação FIRME nunca mandava parâmetro de taxa nenhum (ver `fetchZeroXQuote`),
 * então `integratorFee` viria nulo para QUALQUER par — nativo ou não. A prova
 * chegou no swap das 10:29, que comprou USDT (ERC-20) e também voltou nulo.
 *
 * ⚠️ ENTÃO A PREMISSA DAQUI SEGUE NÃO VERIFICADA: não sabemos se o 0x retém em
 * nativo, porque nunca chegamos a perguntar direito. A função fica porque a
 * regra que ela implementa é do próprio 0x — `swapFeeToken` tem que ser o de
 * compra ou o de venda — e escolher entre os dois é correto de qualquer forma.
 * Se um dia a taxa em nativo funcionar, esta preferência não atrapalha.
 *
 * A regra do 0x é que `swapFeeToken` seja o de COMPRA ou o de VENDA. Então
 * quando o de compra é nativo, sobra o de venda — e é ele que vai.
 *
 * ⚠️ A PREFERÊNCIA PELO TOKEN DE SAÍDA CONTINUA, e o motivo é o mesmo de
 * antes: cobrar na saída é cobrar sobre o que o usuário RECEBEU. A entrada é
 * o segundo lugar, não o primeiro.
 *
 * ⚠️ E A RESSALVA ANTIGA — "cobrar na entrada cobraria antes da troca
 * acontecer, inclusive quando ela falha" — não se aplica aqui, e é por isso
 * que este caminho é seguro: o 0x Settler faz TUDO numa transação só. Se a
 * troca reverte, a retenção reverte junto. Não existe estado em que a taxa
 * saia e o swap não aconteça.
 *
 * Devolve `null` quando os dois lados são nativos — que não é uma troca, mas
 * se chegar aqui é melhor não pedir taxa nenhuma do que pedir uma que o 0x
 * vai ignorar em silêncio.
 */
export function tokenDaTaxa(sellToken: string, buyToken: string): string | null {
  const nativo = (t: string) => t.toLowerCase() === ZEROX_NATIVE.toLowerCase();
  if (!nativo(buyToken))  return buyToken;    // preferido: o que o usuário recebe
  if (!nativo(sellToken)) return sellToken;   // saída nativa → cobra na entrada
  return null;                                 // nativo dos dois lados: sem taxa possível
}

/**
 * ⚠️ A TAXA SÓ VAI SE OS DOIS LADOS EXISTIREM (Fase 9.2, 11/08).
 *
 * `swapFeeBps` sem `swapFeeRecipient` é uma cotação que o 0x recusa — ou pior,
 * aceita e retém para lugar nenhum. Mandar um sem o outro seria cobrar do
 * usuário sem destino, que é o defeito que a trava de `fees.ts` existe para
 * impedir; aqui ela é repetida no ponto de contato com a rede.
 *
 * ⚠️ E OS TRÊS ANDAM JUNTOS OU NENHUM VAI. Sem `swapFeeToken` utilizável não
 * adianta mandar os outros dois: o 0x aceita e não retém — que é exatamente o
 * silêncio que custou os dois swaps de 11/08.
 */
function aplicarTaxa(params: URLSearchParams, args: QuoteArgs): void {
  const bps = args.feeBps ?? 0;
  if (!(bps > 0) || !args.feeRecipient) return;
  const token = tokenDaTaxa(args.sellToken, args.buyToken);
  if (!token) return;
  params.set("swapFeeBps", String(bps));
  params.set("swapFeeRecipient", args.feeRecipient);
  params.set("swapFeeToken", token);
}

export async function fetchZeroXPrice(args: QuoteArgs, apiKey: string): Promise<ZxPriceResponse> {
  const params = new URLSearchParams({
    chainId:    String(args.chainId),
    sellToken:  args.sellToken,
    buyToken:   args.buyToken,
    sellAmount: args.sellAmount,
  });
  if (args.taker)       params.set("taker", args.taker);
  if (args.slippageBps) params.set("slippageBps", String(args.slippageBps));
  aplicarTaxa(params, args);

  const res = await fetch(`${BASE_URL}/swap/allowance-holder/price?${params.toString()}`, {
    headers: {
      "0x-api-key": apiKey,
      "0x-version": "v2",
      "Accept":     "application/json",
    },
    // Indicative — cache aggressively for the same params
    next: { revalidate: 5 },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`0x price ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json() as Promise<ZxPriceResponse>;
}

export async function fetchZeroXQuote(args: QuoteArgs, apiKey: string): Promise<ZxQuoteResponse> {
  if (!args.taker) {
    throw new Error("taker (wallet address) is required for firm quote");
  }
  const params = new URLSearchParams({
    chainId:    String(args.chainId),
    sellToken:  args.sellToken,
    buyToken:   args.buyToken,
    sellAmount: args.sellAmount,
    taker:      args.taker,
  });
  if (args.slippageBps) params.set("slippageBps", String(args.slippageBps));
  /**
   * ⚠️ ESTA LINHA NÃO EXISTIA, E ERA O DEFEITO INTEIRO (11/08).
   *
   * `aplicarTaxa` era chamada só em `fetchZeroXPrice` — a cotação INDICATIVA,
   * a que a tela usa para mostrar número. A cotação FIRME, que é a que vira a
   * transação que o usuário assina, nunca mandou `swapFeeBps`,
   * `swapFeeRecipient` nem `swapFeeToken`.
   *
   * Então a taxa aparecia na tela e não existia na transação. Todo swap da
   * plataforma, desde que a cobrança foi ligada, cobrou ZERO.
   *
   * ⚠️ E O TESTE QUE DEVIA PEGAR ISSO PASSAVA VERDE. Ele fazia
   * `expect(zerox).toContain('params.set("swapFeeBps"')` — leitura do ARQUIVO
   * inteiro. `aplicarTaxa` contém essas linhas, então o teste dava certo
   * enquanto ninguém a chamava no caminho que importa. Ele provava que o
   * código EXISTIA, nunca que ele RODAVA.
   *
   * Eu persegui três hipóteses erradas antes desta (token nativo, direção do
   * par, conta do 0x) porque todas partiam de "os parâmetros foram enviados e
   * o 0x recusou". Nenhum parâmetro foi enviado.
   */
  aplicarTaxa(params, args);

  const res = await fetch(`${BASE_URL}/swap/allowance-holder/quote?${params.toString()}`, {
    headers: {
      "0x-api-key": apiKey,
      "0x-version": "v2",
      "Accept":     "application/json",
    },
    // Firm quote — must NOT cache
    cache: "no-store",
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`0x quote ${res.status}: ${errText.slice(0, 200)}`);
  }
  return res.json() as Promise<ZxQuoteResponse>;
}
