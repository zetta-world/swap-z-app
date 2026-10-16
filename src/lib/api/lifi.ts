/**
 * LiFi v1 Quote API — same-chain DEX aggregation + cross-chain bridge+swap.
 *
 * Endpoint: https://li.quest/v1/quote
 * No API key required for free tier (rate-limited per IP).
 *
 * LiFi unifies bridges (Stargate, Across, Hop, LayerZero, Wormhole, Squid…)
 * and DEX aggregators (1inch, Paraswap, 0x, OpenOcean, KyberSwap…) into a
 * single quote endpoint. Cross-chain swaps execute as ONE user signature
 * that triggers the bridge on source → bridge delivers → swap on destination,
 * all atomic from the user's perspective.
 */

import type { ChainId } from "../chains";

export const LIFI_BASE = "https://li.quest/v1";

export const LIFI_CHAIN_IDS: Partial<Record<ChainId, number>> = {
  ethereum:  1,
  bsc:       56,
  polygon:   137,
  base:      8453,
  arbitrum:  42161,
  optimism:  10,
  avalanche: 43114,
  // Solana — LiFi's synthetic chain id for mainnet-beta. Same-chain Solana
  // quotes route through Jupiter (better depth); LiFi handles SOL↔EVM bridges.
  solana:    1151111081099710,
};

export const LIFI_NATIVE = "0x0000000000000000000000000000000000000000";

export function isLiFiSupported(chain: ChainId): boolean {
  return chain in LIFI_CHAIN_IDS;
}

// ─── Response types ─────────────────────────────────────────────────

export interface LfToken {
  address: string;
  symbol:  string;
  decimals: number;
  chainId: number;
  name?:   string;
  logoURI?: string;
  priceUSD?: string;
}

export interface LfStep {
  type:    string;        // "swap" | "cross" | …
  tool:    string;        // e.g. "stargateV2", "1inch", "paraswap"
  toolDetails?: { name?: string; logoURI?: string };
  action:  {
    fromToken: LfToken;
    toToken:   LfToken;
    fromChainId: number;
    toChainId:   number;
    fromAmount: string;
  };
  estimate: {
    fromAmount: string;
    toAmount:   string;
    toAmountMin: string;
    executionDuration: number;
  };
}

export interface LfFeeCost {
  name?:        string;
  description?: string;
  token:        LfToken;
  amount:       string;
  amountUSD?:   string;
  percentage?:  string;
}

export interface LfGasCost {
  type?:        string;
  price?:       string;
  estimate?:    string;
  limit?:       string;
  amount:       string;
  amountUSD?:   string;
  token:        LfToken;
}

export interface LfTransactionRequest {
  data:     string;
  to:       string;
  value:    string;
  from?:    string;
  chainId?: number;
  gasLimit?: string;
  gasPrice?: string;
}

export interface LfQuote {
  type:    string;          // "lifi"
  id:      string;
  action: {
    fromChainId: number;
    toChainId:   number;
    fromToken:   LfToken;
    toToken:     LfToken;
    fromAmount:  string;
    slippage:    number;
    fromAddress?: string;
    /**
     * ⚠️ O DESTINO QUE A LI.FI DIZ QUE VAI USAR — e o tipo nao o modelava.
     *
     * A rota manda `toAddress` no pedido; a LiFi ecoa na resposta. Sem o
     * campo aqui, o dado chegava e era DESCARTADO na fronteira do tipo, e
     * ninguem tinha como conferir se o que voltou e o que foi pedido.
     *
     * Opcional de proposito: se a LiFi parar de devolver, a ausencia NAO
     * pode virar recusa — conferir o que existe, nunca exigir o que talvez
     * nao venha.
     */
    toAddress?:  string;
  };
  estimate: {
    fromAmount:        string;
    toAmount:          string;
    toAmountMin:       string;
    approvalAddress:   string;
    executionDuration: number;   // seconds
    feeCosts?:         LfFeeCost[];
    gasCosts?:         LfGasCost[];
  };
  includedSteps?:    LfStep[];
  transactionRequest: LfTransactionRequest;
  tool?:    string;        // top-level tool name
  toolDetails?: { name?: string; logoURI?: string };
}

interface QuoteArgs {
  fromChainId:  number;
  toChainId:    number;
  fromToken:    string;     // address (use LIFI_NATIVE for native)
  toToken:      string;
  fromAmount:   string;     // base units
  fromAddress?: string;
  /** Override the destination address on the target chain. */
  toAddress?:   string;
  slippageBps?: number;     // 1-5000
  /** Taxa da plataforma em pontos-base (Fase 9.2). Só é enviada com `integrator` (LIFI-UPSTREAM-01). */
  feeBps?:      number;
  /** ⚠️ NÃO vai ao LiFi: lá a taxa cai na carteira cadastrada no portal, não num parâmetro. */
  feeRecipient?: string;
  /** Integrator CADASTRADO no Partner Portal do LiFi (`integradorLiFi()`). Sem ele, sem taxa. */
  integrator?:  string;
}

/**
 * ⚠️⚠️ LIFI-UPSTREAM-01 (15/10): o integrator que cobra taxa no LiFi.
 *
 * Desde a Fase 9.2 (`dfff405`, 10/08) toda cotação levava `fee` + `integrator=z-swap` +
 * `referrer`. O LiFi só aceita `fee` de integrator CADASTRADO no Partner Portal
 * (portal.li.fi), com a carteira de taxa configurada LÁ — e "z-swap" nunca foi.
 * Resposta: HTTP 400, code 1011, em TODA cotação; a rota engolia o erro, e o LiFi é a
 * única fonte cross-chain. Dois meses sem Bridge.
 *
 * Decisão do dono (15/10): sem integrator cadastrado, NENHUMA taxa vai ao LiFi (e a
 * rota divulga 0% nessas cotações). Cadastrado, `LIFI_INTEGRATOR` liga a taxa sem deploy.
 * `referrer` saiu: no LiFi ele é só rastreio, nunca foi destinatário de taxa.
 */
export function integradorLiFi(): string | null {
  return lerIntegradorLiFi(process.env.LIFI_INTEGRATOR).valor;
}

/**
 * ⚠️⚠️ VALOR INVÁLIDO NÃO PODE DERRUBAR O CROSS-CHAIN (16/10, ativação).
 *
 * Na ativação, o valor gravado na Vercel não era só `zswap`, e o LI.FI recusou TODA cotação:
 * *"/integrator must be an alphanumeric string (additionally "-", "_", and "." are allowed)
 * with a maximum length of 23 characters"* (400/1011). Um erro de digitação numa variável
 * tirou Bridge e swap entre redes do ar.
 *
 * Agora: aspas nas pontas e o prefixo `LIFI_INTEGRATOR=` colado por engano são removidos; o
 * que sobra tem de seguir a regra do LI.FI. Se não seguir, a taxa LI.FI fica DESLIGADA (a
 * cotação segue sem taxa e a tela diz 0%) e `motivo` diz o porquê — tamanho e classes de
 * caractere, NUNCA o valor (a key pode ter sido colada aqui por engano).
 */
export const INTEGRADOR_LIFI_VALIDO = /^[A-Za-z0-9._-]{1,23}$/;

export function lerIntegradorLiFi(bruto: string | undefined): { valor: string | null; motivo: string | null } {
  let v = (bruto ?? "").trim();
  if (!v) return { valor: null, motivo: null };
  v = v.replace(/^LIFI_INTEGRATOR\s*=\s*/i, "").trim();
  v = v.replace(/^(["'`])(.*)\1$/, "$2").trim();
  if (INTEGRADOR_LIFI_VALIDO.test(v)) return { valor: v, motivo: null };
  const classes = [
    v.length > 23 ? `mais de 23 caracteres (${v.length})` : `${v.length} caracteres`,
    /\s/.test(v) ? "espaço" : "",
    /["'`]/.test(v) ? "aspas" : "",
    /=/.test(v) ? "sinal '='" : "",
    /[^A-Za-z0-9._\-\s"'`=]/.test(v) ? "outros caracteres fora de letras/números/-/_/." : "",
  ].filter(Boolean).join(", ");
  return { valor: null, motivo: `LIFI_INTEGRATOR inválido para o LI.FI: ${classes}` };
}

/**
 * Fetch a single best-route quote from LiFi. Throws on HTTP errors.
 * Designed to be called from server routes — never include LiFi key in
 * the browser bundle.
 */
export async function fetchLiFiQuote(
  args: QuoteArgs,
  integratorKey?: string,
  opcoes: { aoRecusarChave?: (detalhe: string) => void } = {},
): Promise<LfQuote> {
  // LiFi's /v1/quote REQUIRES fromAddress to build the signable route — it
  // rejects requests without it ("querystring must have required property
  // 'fromAddress'", code 1011). An empty/undefined taker would otherwise be
  // dropped silently here and surface as a confusing remote 400, so we fail
  // locally with a clear message. Callers without a connected wallet must
  // skip LiFi rather than reach this function.
  if (!args.fromAddress) {
    throw new Error("LiFi quote requires fromAddress (no wallet connected)");
  }

  const params = new URLSearchParams({
    fromChain:    String(args.fromChainId),
    toChain:      String(args.toChainId),
    fromToken:    args.fromToken,
    toToken:      args.toToken,
    fromAmount:   args.fromAmount,
    fromAddress:  args.fromAddress,
    order:        "RECOMMENDED",
  });
  if (args.toAddress)   params.set("toAddress",   args.toAddress);
  if (args.slippageBps) params.set("slippage", (args.slippageBps / 10_000).toString());
  /**
   * ⚠️ A TAXA SÓ VAI COM INTEGRATOR CADASTRADO (LIFI-UPSTREAM-01; antes, Fase 9.2,
   * exigia só destinatário e o LI.FI recusava tudo). A LI.FI recebe a
   * taxa como FRAÇÃO (0.01 = 1%), não em pontos-base — mandar `100` ali seria
   * pedir 10.000%. A conversão fica aqui, no ponto de contato, e não em quem
   * chama: quem chama fala em bps, que é a unidade da escada.
   */
  if ((args.feeBps ?? 0) > 0 && args.integrator) {
    params.set("fee", ((args.feeBps as number) / 10_000).toString());
    params.set("integrator", args.integrator);
  }

  const pedir = (comChave: boolean) => fetch(`${LIFI_BASE}/quote?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      ...(comChave && integratorKey ? { "x-lifi-api-key": integratorKey } : {}),
    },
    // Same-chain quotes change every block; don't cache aggressively
    next: { revalidate: 5 },
  });
  let res = await pedir(true);
  /**
   * ⚠️⚠️ KEY RECUSADA NÃO DERRUBA O CROSS-CHAIN (16/10, ativação). Uma key colada errada na
   * Vercel fez o LI.FI responder 401 "Invalid API key" (1010) a TODA cotação. A key é
   * opcional (atribuição e limite próprio): sem ela a cotação sai igual, com a mesma taxa.
   * Então: 401 com key → refaz SEM a key e avisa quem chamou. Sem key, 401 é erro mesmo.
   */
  if (res.status === 401 && integratorKey) {
    const detalhe = (await res.text().catch(() => "")).slice(0, 200);
    opcoes.aoRecusarChave?.(detalhe);
    res = await pedir(false);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LiFi ${res.status}: ${errText.slice(0, 240)}`);
  }
  return res.json() as Promise<LfQuote>;
}

/**
 * ⚠️⚠️ A TAXA PRÓPRIA DO LI.FI, para separar a nossa da dela (LIFI-UPSTREAM-01, ativação 15/10).
 *
 * Medido com o integrator cadastrado: o LI.FI não devolve a taxa do integrador numa linha
 * própria — soma à dele em "LIFI Fixed Fee" (sem `fee`: 0,0025; `fee=0.01`: 0,0125). Acordo
 * comercial pode mudar a parte dele, então ela é configurável. Se mudar sem ajuste aqui, a
 * conta erra para o lado do ALARME ("taxa não retida"), nunca para o de receita fingida.
 */
export const LIFI_TAXA_PROPRIA = Number(process.env.LIFI_SERVICE_FEE ?? 0.0025);

/** A parte da Z-SWAP na cotação, ou `null` se a resposta não prova que ela foi retida. */
export function taxaDoIntegradorNaCotacao(
  q: LfQuote, fracaoPedida: number,
): { pct: number; pctTotal: number; amount: string; token?: string } | null {
  if (!(fracaoPedida > 0)) return null;
  const custos = q?.estimate?.feeCosts ?? [];
  const tol = 1e-6;
  // 1) Linha própria do integrador (se o LI.FI um dia separar).
  const propria = custos.find((f) => /integrator|z-?swap|referrer/i.test(`${f.name ?? ""}${f.description ?? ""}`));
  if (propria) {
    const p = Number(propria.percentage);
    if (Number.isFinite(p) && p + tol >= fracaoPedida) {
      return { pct: p, pctTotal: p, amount: String(propria.amount), token: propria.token?.symbol };
    }
  }
  // 2) Somada à do LI.FI: a nossa é o que passa da taxa própria dele.
  const fixa = custos.find((f) => /lifi/i.test(f.name ?? "") && /fixed/i.test(`${f.name ?? ""}${f.description ?? ""}`));
  if (!fixa) return null;
  const total = Number(fixa.percentage);
  if (!Number.isFinite(total) || total <= 0) return null;
  const nossa = total - LIFI_TAXA_PROPRIA;
  if (nossa + tol < fracaoPedida) return null;
  let amount = String(fixa.amount);
  try {
    const escala = 1_000_000n;
    amount = ((BigInt(fixa.amount) * BigInt(Math.round((nossa / total) * 1_000_000))) / escala).toString();
  } catch { /* quantidade ilegível: devolve a total, e o pct diz a parte */ }
  return { pct: Number(nossa.toFixed(8)), pctTotal: total, amount, token: fixa.token?.symbol };
}
