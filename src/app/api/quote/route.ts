import { NextRequest, NextResponse } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { recordEvent, notifyTelegram, logSecurity } from "@/lib/admin/track";
import { isValidChain, validateAddress, validateAmount } from "@/lib/validate";
import { conferirDestinatario, familiaDaRede } from "@/lib/swap/recipient";
import {
  fetchZeroXPrice, fetchZeroXQuote, isZeroXSupported, ZEROX_CHAIN_IDS, ZEROX_NATIVE, tokenDaTaxa,
} from "@/lib/api/zerox";
import {
  fetchLiFiQuote, isLiFiSupported, LIFI_CHAIN_IDS, LIFI_NATIVE, integradorLiFi, lerIntegradorLiFi, taxaDoIntegradorNaCotacao,
} from "@/lib/api/lifi";
import {
  fetchJupiterQuote, fetchJupiterFirm, JUPITER_SOL_MINT, configJupiter,
} from "@/lib/api/jupiter";
import {
  normalizeZeroX, normalizeLiFi, normalizeJupiter,
  rankQuotes, paraListagem, type NormalizedQuote,
} from "@/lib/api/quote-types";
import type { ChainId } from "@/lib/chains";
import { envNumber } from "@/lib/env-number";
import { bpsEfetivos, destinatarioDaTaxa } from "@/lib/tier/fees";
import { contaDeTaxaParaPar } from "@/lib/solana/conta-de-taxa";
import { getSession } from "@/lib/auth/session";
import { getTierForWallet } from "@/lib/tier/check";
import type { Tier } from "@/lib/tier/types";
import { checarKillSwitches } from "@/lib/admin/kill-switches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-instance DURABLE limit (pentest 28/07). This route is unauthenticated
// and every call hits a PAID upstream (0x /quote + LiFi) with Cache-Control
// no-store, so nothing absorbs a flood. The old in-memory limiter is
// per-Vercel-instance module state, so the effective ceiling was max ×
// live-instances — under load Vercel fans out and an attacker burns the
// owner's 0x/LiFi quota (a real bill) and exhausts it for legitimate users.
// The durable limiter enforces ONE deployment-wide per-IP budget (fails open
// to in-memory only if the DB is down). Limits are per IP/min; a debounced UI
// stays well under them. NOTE: this bounds per-IP abuse, NOT a distributed
// (many-IP) flood — that needs an upstream spend cap + WAF (see report).
const RL_LIST  = { windowMs: 60_000, max: 40 };   // multi-quote list (heavier)
const RL_FIRM  = { windowMs: 60_000, max: 25 };   // firm quote per source
// Deployment-wide ceiling on paid-upstream (0x/LiFi) calls per minute — the
// distributed-flood backstop the per-IP limit can't provide. See below.
//
// ⚠️ 3000 -> 600 (auditoria da ponte, 23/08). O comentario acima dizia
// "tune down se voce adicionar um WAF/alerta": a auditoria confirmou que NAO
// ha WAF, nem bot protection, nem regra de borda — entao este numero e a
// unica barreira, e 3000/min sustentados sao 4,32 MILHOES de chamadas pagas
// por dia. 600/min ainda e ~15x o teto por IP e milhares de vezes o trafego
// real de hoje; e env var, entao sobe sem deploy se o beta pedir.
const QUOTE_GLOBAL_MAX = envNumber(process.env.QUOTE_GLOBAL_MAX, 600, { positive: true });
// TETO DIÁRIO (auditoria 01/08). O teto por minuto acima é backstop de
// DISPONIBILIDADE, não de GASTO: 3000/min sustentados são 4,32 MILHÕES de
// chamadas por dia, e uma enchente que fique logo abaixo do limite nunca o
// dispara — ela só factura, indefinidamente. Um teto de conta precisa de
// janela do tamanho da conta. Também falha ABERTO se o banco estiver fora.
//
// ⚠️ 250.000 -> 25.000 pela mesma razao. Um teto de GASTO que ninguem nunca
// atingiu nao esta calibrado, esta desligado por outro nome.
const QUOTE_DAILY_MAX = envNumber(process.env.QUOTE_DAILY_MAX, 25_000, { positive: true });

/**
 * /api/quote — unified quote router.
 *
 * Query params:
 *   fromChain     ChainId  (required)
 *   toChain       ChainId  (optional, defaults to fromChain — same-chain)
 *   sellToken     "native" | 0x... (required)
 *   buyToken      "native" | 0x... (required)
 *   sellAmount    integer base units (required)
 *   taker         user wallet (required for `mode=quote` / `source=lifi`)
 *   slippageBps   1-1000 (default 50)
 *   mode          "list"   → list of normalized quotes (default)
 *                 "quote"  → firm quote from one source for execution
 *   source        "0x" | "lifi"  (required when mode=quote)
 *
 * When mode=list, dispatches to 0x (same-chain) and LiFi (any-chain) in
 * parallel and returns the unified list of quotes the comparison panel
 * renders.
 *
 * When mode=quote, returns the firm, signable payload from the selected
 * source (transaction calldata + permit2 / approvalAddress).
 */
/**
 * O plano de quem está cotando. Sem sessão é `free` — que é o plano de quem
 * não assinou, e portanto a taxa mais alta. Nunca lança: uma falha de
 * resolução vira `free`, nunca "sem taxa".
 */
async function tierDoCotante(): Promise<Tier> {
  try {
    const s = await getSession();
    if (!s) return "free";
    const { tier } = await getTierForWallet(s.sub, s.chain);
    return tier;
  } catch { return "free"; }
}

/**
 * ⚠️ PEDIMOS TAXA E O AGREGADOR NÃO CONFIRMOU — ISTO GRITA (11/08).
 *
 * Em dois swaps reais o 0x aceitou a cotação e devolveu `integratorFee: null`,
 * porque o token de saída era nativo e ele não retém taxa em nativo. A tela
 * dizia "Taxa da plataforma 1,00%" e a cobrança era ZERO. Ninguém teria
 * descoberto: a cotação volta 200, o swap funciona, o usuário fica feliz, e a
 * receita não existe.
 *
 * ⚠️ NÃO BLOQUEIA A COTAÇÃO, E ISSO É DE PROPÓSITO. O caminho de dinheiro que
 * falha FECHADO é o do usuário — ordem sem preço de referência é recusada. Já
 * a NOSSA receita é o outro lado: recusar a troca de alguém porque nós não
 * fomos pagos seria transformar um problema nosso em prejuízo dele.
 *
 * Então: alerta alto, swap segue. Perder taxa por um bug é ruim; perder o
 * usuário por causa dele é pior.
 */
function alertarTaxaNaoRetida(args: {
  aceita: unknown; bps: number; source: string; fromChain: string;
  sellToken: string; buyToken: string;
}): void {
  const temAceite = Array.isArray(args.aceita) ? args.aceita.length > 0 : args.aceita != null;
  if (args.bps <= 0 || temAceite) return;
  notifyTelegram(
    `⚠️ TAXA NÃO RETIDA — pedimos ${args.bps}bps ao ${args.source} em ${args.fromChain} `
    + `(${args.sellToken} → ${args.buyToken}) e a resposta não trouxe taxa de integrador. `
    + `A tela promete a taxa e a cobrança é ZERO.`,
    {
      dedupKey: `taxa-nao-retida:${args.source}:${args.fromChain}`,
      meta: { kind: "taxa_nao_retida", bps: args.bps, source: args.source,
              fromChain: args.fromChain, sellToken: args.sellToken, buyToken: args.buyToken },
    },
  );
}

export async function GET(req: NextRequest) {
  const zeroXKey = process.env.ZEROX_API_KEY;
  const lifiKey  = process.env.LIFI_API_KEY;        // optional — free tier works without
  // ⚠️ Key recusada pelo LI.FI: a cotação é refeita sem ela (ver `fetchLiFiQuote`) e o dono é avisado.
  const aoRecusarChave = (detalhe: string) => {
    console.warn(`[lifi] LIFI_API_KEY recusada pelo LI.FI — cotando sem a key: ${detalhe.slice(0, 120)}`);
    notifyTelegram("⚠️ LIFI_API_KEY recusada pelo LI.FI (\"Invalid API key\"). As cotações seguem SEM a key (mesma taxa). Corrija o valor na Vercel: a key completa, salva na criação — não a máscara do painel.",
      { dedupKey: "lifi:key-recusada", meta: { kind: "lifi_key_recusada" } });
  };

  const params = req.nextUrl.searchParams;
  const mode   = params.get("mode") === "quote" ? "quote" : "list";

  // ─── Rate limit ─────────────────────────────────────────────────────
  // (1) Per-IP durable budget — bounds a single attacker across instances.
  const rl = await rateLimitDurable(`q:${mode}:${getClientId(req.headers)}`, mode === "quote" ? RL_FIRM : RL_LIST);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  // (2) GLOBAL upstream budget (pentest 28/07) — a per-IP limit can't stop a
  // DISTRIBUTED (many-IP / botnet) flood from running up the owner's paid
  // 0x/LiFi bill. This is ONE deployment-wide ceiling on total upstream calls
  // per minute; past it we return 503 WITHOUT touching the upstream, so the
  // worst-case bill is capped instead of unbounded. Default 3000/min is far
  // above any single-app legitimate need (≈50 quotes/s) and only trips on
  // egregious abuse; tune down with QUOTE_GLOBAL_MAX if you add a WAF/alerting.
  // Fails OPEN (skips the check) if the DB is down — never blocks legit trading.
  const gb = await rateLimitDurable("q:global", { windowMs: 60_000, max: QUOTE_GLOBAL_MAX });
  if (!gb.ok) {
    /**
     * ⚠️⚠️ O TETO AVISA — antes ele devolvia 503 EM SILENCIO.
     *
     * Este e o backstop de conta paga: quando ele dispara, ou a plataforma
     * esta sob enchente distribuida, ou o limite ficou apertado demais para o
     * trafego legitimo. Os dois exigem que alguem SAIBA, e nenhum dos dois
     * avisava: o dono descobriria pela fatura do 0x, ou por usuario
     * reclamando que a cotacao nao carrega.
     *
     * ⚠️ E e o alerta que torna seguro APERTAR o numero. Sem ele, baixar o
     * teto seria trocar um risco de conta por um risco de indisponibilidade
     * muda — que e pior, porque a fatura pelo menos chega.
     *
     * Dedup de 5 min por chave (ver notifyTelegram): uma enchente vira UM
     * aviso, nao mil.
     */
    notifyTelegram(
      `🔴 <b>TETO DE COTACAO/MIN</b> atingido (` + QUOTE_GLOBAL_MAX + `/min).\nOu enchente distribuida, ou o limite esta apertado demais.`,
      { dedupKey: "quote:global", meta: { kind: "quote_budget_minute", max: QUOTE_GLOBAL_MAX } },
    );
    return NextResponse.json(
      { error: "quote_budget_exceeded", retryAfter: gb.retryAfter },
      { status: 503, headers: { "Retry-After": String(gb.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  // (3) TETO DIÁRIO — o que (2) não faz. Ver comentário em QUOTE_DAILY_MAX:
  // uma enchente logo abaixo de 3000/min passa por (2) para sempre.
  const gd = await rateLimitDurable("q:global:day", { windowMs: 86_400_000, max: QUOTE_DAILY_MAX });
  if (!gd.ok) {
    // ⚠️ Este e MAIS grave que o do minuto: significa que a plataforma esta
    // sem cotacao pelo resto do dia. Silencio aqui e a loja fechada com a
    // placa de aberta.
    notifyTelegram(
      `🔴 <b>TETO DIARIO DE COTACAO</b> atingido (` + QUOTE_DAILY_MAX + `/dia).\nA plataforma esta SEM cotacao ate a janela virar.`,
      { dedupKey: "quote:daily", meta: { kind: "quote_budget_day", max: QUOTE_DAILY_MAX } },
    );
    return NextResponse.json(
      { error: "quote_daily_budget_exceeded", retryAfter: gd.retryAfter },
      { status: 503, headers: { "Retry-After": String(gd.retryAfter), "Cache-Control": "no-store" } },
    );
  }

  /**
   * ⚠️ KILL-SWITCH DO SWAP (Fase 7.3) — `disable_swap` e `maintenance_mode`
   * eram clicáveis no painel e lidos por ninguém.
   *
   * ⚠️ SÓ EM `mode=quote`, de propósito. É a cotação FIRME, o payload assinável
   * — sem ele não há transação para a carteira assinar, então este é o
   * estrangulamento real do swap. Barrar `mode=list` junto derrubaria a
   * comparação de preços, que é navegação, não movimento de dinheiro.
   *
   * ⚠️⚠️ A33 (auditoria externa): essa premissa era FALSA até 15/10 — com
   * carteira, a lista devolvia a calldata firme do 0x, o `transactionRequest`
   * do LiFi e a `quoteResponse` do Jupiter, sem passar por aqui. Agora a lista
   * sai por `paraListagem` (allowlist em `quote-types.ts`) e não carrega nada
   * executável; esta guarda continua sendo a ÚNICA porta para o payload.
   *
   * ⚠️ E FALHA ABERTA: o usuário ainda assina na carteira, revisando. Derrubar
   * o swap de todo mundo por um Postgres intermitente é o dano certo. A direção
   * oposta à de `/api/cex/order` — e a razão está em `kill-switches.ts`.
   *
   * Vem DEPOIS dos limites de taxa: esta rota é aberta, e uma consulta ao banco
   * antes do limitador seria um vetor de enchente barato.
   */
  if (mode === "quote") {
    const kill = await checarKillSwitches(["disable_swap", "maintenance_mode"], "usuario_confirma");
    if (kill.bloqueado) {
      return NextResponse.json(
        { error: "platform_disabled", detail: kill.motivo },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // ─── Common validation ─────────────────────────────────────────────
  const fromChain = params.get("fromChain") ?? params.get("chain"); // backwards compat
  const toChain   = params.get("toChain")   ?? fromChain;
  if (!isValidChain(fromChain)) {
    return NextResponse.json({ error: "invalid_from_chain" }, { status: 400 });
  }
  if (!isValidChain(toChain)) {
    return NextResponse.json({ error: "invalid_to_chain" }, { status: 400 });
  }

  const sellRaw   = params.get("sellToken");
  const buyRaw    = params.get("buyToken");
  const sellToken = sellRaw === "native" ? "native" : validateAddress(sellRaw);
  const buyToken  = buyRaw  === "native" ? "native" : validateAddress(buyRaw);
  if (!sellToken || !buyToken) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  if (fromChain === toChain && sellToken.toLowerCase() === buyToken.toLowerCase()) {
    return NextResponse.json({ error: "same_token" }, { status: 400 });
  }

  const sellAmount = validateAmount(params.get("sellAmount"));
  if (!sellAmount || !/^\d+$/.test(sellAmount)) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  let taker: string | undefined;
  const takerRaw = params.get("taker");
  if (takerRaw) {
    const t = validateAddress(takerRaw);
    if (!t || t === "native") {
      return NextResponse.json({ error: "invalid_taker" }, { status: 400 });
    }
    taker = t;
  }

  // Optional override for cross-chain delivery address. Defaults to taker.
  let recipient: string | undefined;
  const recipientRaw = params.get("recipient");
  if (recipientRaw) {
    /**
     * ⚠️⚠️ A CHECAGEM CONHECE A REDE DE DESTINO — e antes não conhecia.
     *
     * `validateAddress` aceita EVM e base58 sem distinguir, porque é o
     * validador genérico de toda a API. Aqui isso era um buraco de perda de
     * fundo: um endereço SOLANA passava como `toAddress` de uma ponte para
     * BASE, e o único lugar que reclamava era a cor do campo no navegador.
     *
     * O caminho real: o usuário escolhe destino Solana, cola um endereço
     * Solana, troca o destino para Base — `setToToken` não limpa o
     * destinatário — e a loja segue mandando o endereço antigo.
     *
     * ⚠️ ESTA É A SEGUNDA LINHA, NÃO A PRIMEIRA. A rota é pública: cliente em
     * cache, script, ou regressão no componente chegam aqui sem passar pelo
     * campo. O caminho do dinheiro não terceiriza a última palavra.
     */
    const v = conferirDestinatario(recipientRaw, familiaDaRede(toChain));
    if (!v.ok) {
      return NextResponse.json(
        { error: v.motivo === "queima" ? "burn_recipient" : "invalid_recipient", motivo: v.motivo },
        { status: 400 },
      );
    }
    recipient = v.endereco;
  }

  const slipRaw    = params.get("slippageBps");
  const slippageBps = slipRaw ? parseInt(slipRaw, 10) : 50;
  // Cap at 1000 bps (10%). The UI maxes out at 5%; anything beyond 10% is
  // almost always a fat-finger or a sandwich-bait setup, so we reject it
  // server-side even on direct API calls.
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 1000) {
    return NextResponse.json({ error: "invalid_slippage" }, { status: 400 });
  }

  const isCrossChain     = fromChain !== toChain;
  const fromIsSolana     = fromChain === "solana";
  const toIsSolana       = toChain   === "solana";
  const isSameChainSolana = fromIsSolana && toIsSolana;

  // ─── Helpers ────────────────────────────────────────────────────────
  // EVM aggregator args. Only meaningful when the chains in question are EVM
  // (the `!` is safe because we gate every use behind isZeroXSupported / isLiFiSupported).
  /**
   * ⚠️ A TAXA DA PLATAFORMA (Fase 9.2, 11/08) — resolvida por PLANO.
   *
   * Cadeia EVM usa a carteira do código; Solana fica em zero porque não há
   * conta de token. `bpsEfetivos` já devolve 0 sem destinatário, então a
   * ausência de configuração NÃO cobra do usuário.
   *
   * ⚠️ E A TAXA VAI PARA A RESPOSTA, sempre — inclusive quando é zero. A tela
   * precisa poder dizer "0%" com a mesma clareza com que diz "1%": um campo
   * ausente seria lido como "não há taxa", que é uma afirmação diferente de
   * "a taxa é zero neste caso".
   */
  const familiaCadeia = fromChain === "solana" ? "solana" : "evm";
  const planoDoCotante = await tierDoCotante();
  const taxa = {
    tier: planoDoCotante,
    bps: bpsEfetivos(planoDoCotante, familiaCadeia),
    pct: bpsEfetivos(planoDoCotante, familiaCadeia) / 100,
    destinatario: destinatarioDaTaxa(familiaCadeia),
  };

  const zxArgs = {
    chainId:     ZEROX_CHAIN_IDS[fromChain as ChainId]!,
    sellToken:   sellToken === "native" ? ZEROX_NATIVE : sellToken,
    buyToken:    buyToken  === "native" ? ZEROX_NATIVE : buyToken,
    sellAmount,
    taker,
    slippageBps,
    feeBps:      taxa.bps,
    feeRecipient: taxa.destinatario ?? undefined,
  };
  /**
   * ⚠️ LIFI-UPSTREAM-01: sem integrator cadastrado no portal do LiFi, NENHUMA taxa vai
   * nas cotações LiFi — e a taxa DIVULGADA dessas cotações é 0. A tela mostra a taxa
   * que veio na resposta; anunciar 1% numa rota que não cobra seria a mesma mentira
   * de contador que esta casa já pagou caro.
   */
  const integrador = integradorLiFi();
  // ⚠️ Variável preenchida e recusada pela regra do LI.FI: a taxa LI.FI fica desligada (o
  // cross-chain segue no ar) e o motivo é dito — sem o valor.
  const leituraIntegrador = lerIntegradorLiFi(process.env.LIFI_INTEGRATOR);
  if (leituraIntegrador.motivo) {
    console.warn(`[lifi] ${leituraIntegrador.motivo} — taxa LI.FI DESLIGADA`);
    notifyTelegram(`⚠️ ${leituraIntegrador.motivo}. A taxa LI.FI está DESLIGADA até corrigir o valor (deve ser só o nome do integrator, ex.: zswap).`,
      { dedupKey: "lifi:integrator-invalido", meta: { kind: "lifi_integrator_invalido" } });
  }
  const taxaLiFi = integrador ? taxa : { ...taxa, bps: 0, pct: 0 };
  const lfArgs = {
    fromChainId: LIFI_CHAIN_IDS[fromChain as ChainId]!,
    toChainId:   LIFI_CHAIN_IDS[toChain   as ChainId]!,
    fromToken:   sellToken === "native" ? LIFI_NATIVE : sellToken,
    toToken:     buyToken  === "native" ? LIFI_NATIVE : buyToken,
    fromAmount:  sellAmount,
    fromAddress: taker,
    toAddress:   recipient ?? taker,
    slippageBps,
    feeBps:      taxaLiFi.bps,
    feeRecipient: taxa.destinatario ?? undefined,
    integrator:  integrador ?? undefined,
  };
  /**
   * ⚠️⚠️ A JUPITER COBRA DESDE 16/10 (L-061; decisão do dono, revertendo a de 11/08).
   *
   * `platformFeeBps` na cotação e `feeAccount` no `/swap` andam JUNTOS, e o `feeAccount` é a conta
   * de token do dono para um dos mints do par (USDC, senão SOL) — conferida NA REDE antes. Par sem
   * USDC/SOL, conta ausente ou RPC fora → sem taxa, swap segue, taxa divulgada 0. A taxa divulgada
   * desta rota é `taxaJupiter`, nunca a da família.
   */
  const jupInput  = sellToken === "native" ? JUPITER_SOL_MINT : sellToken;
  const jupOutput = buyToken  === "native" ? JUPITER_SOL_MINT : buyToken;
  let contaJupiter: string | null = null;
  let taxaJupiter = { ...taxa, bps: 0, pct: 0 };
  if (isSameChainSolana && taxa.bps > 0) {
    const c = await contaDeTaxaParaPar(jupInput, jupOutput);
    if (c.conta) {
      contaJupiter = c.conta;
      taxaJupiter = taxa;
    } else if ("porque" in c && c.porque) {
      console.warn(`[taxa-solana] conta de taxa indisponível — swap segue SEM taxa: ${c.porque}`);
      notifyTelegram(`⚠️ TAXA SOLANA desligada neste par: ${c.porque}. Os swaps seguem sem taxa até corrigir (conta de token USDC/wSOL da carteira de taxa).`,
        { dedupKey: "taxa-solana:conta", meta: { kind: "taxa_solana_conta", porque: c.porque } });
    }
  }
  const jupArgs = {
    inputMint:   jupInput,
    outputMint:  jupOutput,
    amount:      sellAmount,
    slippageBps,
    ...(contaJupiter ? { platformFeeBps: taxaJupiter.bps, feeAccount: contaJupiter } : {}),
    ...(taker ? { taker } : {}),
  };
  /**
   * L-062B: o `/build` não devolve `platformFee` — a taxa só é tratada como cobrada quando o
   * `feeAccount` está nas contas da instrução de swap (`quote.platformFee`, ver `taxaNaInstrucao`).
   * Pedida e ausente → alerta "TAXA NÃO RETIDA" e a taxa divulgada vira 0: a tela não promete
   * o que a transação não cobra.
   */
  const taxaJupiterConfirmada = (quote: { platformFee?: unknown }) => {
    if (!contaJupiter) return taxaJupiter;
    alertarTaxaNaoRetida({ aceita: quote.platformFee ?? null, bps: taxaJupiter.bps, source: "jupiter",
      fromChain: "solana", sellToken, buyToken });
    return quote.platformFee ? taxaJupiter : { ...taxaJupiter, bps: 0, pct: 0 };
  };
  /**
   * Chave da Jupiter (L-062A). Sem chave a Jupiter segue pela `lite-api` (o swap não para), mas em
   * PRODUÇÃO isso é falha de configuração e o dono precisa saber — não fingir que é autenticada.
   * Chave recusada → a chamada é refeita sem ela (`jupFetch`) e o dono é avisado. Nunca a chave no texto.
   */
  const jupOpts = {
    aoRecusarChave: (status: number) => notifyTelegram(
      `⚠️ JUPITER_API_KEY recusada pela Jupiter (HTTP ${status}). Os swaps Solana seguem SEM a chave (lite-api, limite menor, 429 mais cedo). Corrija o valor na Vercel.`,
      { dedupKey: "jupiter:chave-recusada", meta: { kind: "jupiter_chave_recusada", status } }),
  };
  if (isSameChainSolana) {
    const cfgJup = configJupiter();
    if (cfgJup.incoerencia) {
      console.warn(`[jupiter] configuração incoerente: ${cfgJup.incoerencia}`);
      notifyTelegram(`⚠️ JUPITER config: ${cfgJup.incoerencia}.`, { dedupKey: "jupiter:config", meta: { kind: "jupiter_config_incoerente" } });
    }
    if (cfgJup.modo === "sem-chave" && process.env.VERCEL_ENV === "production") {
      console.warn("[jupiter] produção SEM JUPITER_API_KEY — usando lite-api (sem chave)");
      notifyTelegram("⚠️ Produção sem JUPITER_API_KEY: os swaps Solana estão na lite-api (sem chave, 0,5 req/s, 429 em pico). Configure a chave na Vercel.",
        { dedupKey: "jupiter:sem-chave", meta: { kind: "jupiter_sem_chave" } });
    }
  }

  // ─── Firm single-source path ────────────────────────────────────────
  if (mode === "quote") {
    const source = params.get("source");
    if (!taker) return NextResponse.json({ error: "taker_required_for_quote" }, { status: 400 });

    try {
      if (source === "0x") {
        if (isCrossChain) return NextResponse.json({ error: "0x_no_cross_chain" }, { status: 400 });
        if (!isZeroXSupported(fromChain as ChainId) || !zeroXKey) {
          return NextResponse.json({ error: "0x_unavailable" }, { status: 400 });
        }
        const q = await fetchZeroXQuote(zxArgs, zeroXKey);
        // Observe mode (pentest 28/07): record the ACTUAL router `to` + approval
        // spender 0x returns, so the admin allow-list panel can show verified
        // canonical addresses to pin (no hand-typing). Firm path only = exactly
        // what ExecuteSwap signs.
        /**
         * ⚠️ A TAXA VAI PARA O EVENTO — E O QUE VAI É A RESPOSTA DO 0x, NÃO O
         * NOSSO PEDIDO (11/08).
         *
         * O primeiro swap de verdade aconteceu às 03:51 UTC e não deu para
         * conferir NADA a partir daqui: o evento gravava rota, cadeia, tokens,
         * roteador e `spender`, e não gravava a taxa. Ficou impossível saber,
         * pelos nossos próprios registros, se o pedido de cobrança sequer saiu.
         *
         * `taxaPedidaBps` é o que MANDAMOS. `taxaAceita` é o `integratorFee`
         * que o 0x DEVOLVE — e são coisas diferentes de propósito: gravar só o
         * pedido responderia "nós pedimos", que é justamente a metade que já
         * estava provada por teste unitário. A metade que faltava é a outra.
         *
         * Com os dois no evento, "o 0x ignorou o parâmetro" para de ter a mesma
         * aparência de "a taxa foi cobrada". Sobra uma pergunta só para o
         * explorador de blocos: se o valor aceito chegou na carteira.
         */
        // ⚠️ AGUARDADO: é a trilha que responde "cobramos o que dissemos?" —
        // o achado da auditoria da ponte. A resposta já pagou uma ida ao
        // agregador (centenas de ms); um insert não é o que pesa.
        await recordEvent("swap_intent", { wallet: taker, meta: {
          source, fromChain, toChain, sellToken, buyToken,
          chainId: zxArgs.chainId, target: q.transaction?.to, spender: q.issues?.allowance?.spender,
          taxaPedidaBps: taxa.bps, taxaDestinatario: taxa.destinatario,
          /**
           * ⚠️ O TOKEN QUE PEDIMOS VAI PARA O EVENTO, E NÃO É REDUNDANTE (11/08).
           *
           * Eu já errei uma hipótese aqui hoje: culpei o token nativo, corrigi
           * `tokenDaTaxa` para cair na entrada, e os três swaps seguintes
           * continuaram com `taxaAceita: null`. E eu não tinha como saber se o
           * código corrigido estava mesmo escolhendo o token novo, ou se ele
           * escolhia certo e o 0x recusava assim mesmo.
           *
           * Duas causas diferentes com a mesma tela — de novo. Este campo
           * separa as duas: se vier o endereço do ERC-20, a escolha está certa
           * e o problema é do outro lado.
           */
          taxaTokenPedido: tokenDaTaxa(zxArgs.sellToken, zxArgs.buyToken),
          taxaAceita: q.fees?.integratorFee
            ? { amount: q.fees.integratorFee.amount, token: q.fees.integratorFee.token }
            : null,
          /**
           * ⚠️ E O BLOCO `fees` INTEIRO, cru. `integratorFee: null` sozinho não
           * diz se o 0x processou o pedido e recusou, ou se nem viu. Se vierem
           * `zeroExFee` e `gasFee` preenchidos ao lado do nosso nulo, a
           * resposta é a primeira — e aí o problema é o que pedimos, não se
           * pedimos.
           */
          taxaRespostaCrua: q.fees ?? null,
        } });
        alertarTaxaNaoRetida({
          aceita: q.fees?.integratorFee ?? null, bps: taxa.bps,
          source: "0x", fromChain, sellToken, buyToken,
        });
        return NextResponse.json(
          { ok: true, mode, source, taxa, result: q, normalized: normalizeZeroX(q, zxArgs.chainId, true) },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (source === "lifi") {
        if (!isLiFiSupported(fromChain as ChainId) || !isLiFiSupported(toChain as ChainId)) {
          return NextResponse.json({ error: "lifi_unsupported_chain" }, { status: 400 });
        }
        const q = await fetchLiFiQuote(lfArgs, lifiKey, { aoRecusarChave });
        /**
         * ⚠️⚠️ O DESTINO QUE VOLTOU TEM DE SER O QUE FOI PEDIDO.
         * (auditoria da ponte, 23/08)
         *
         * Toda a defesa desta rota estava do lado do PEDIDO: validar o
         * destinatario, conferir a rede, recusar endereco de queima. Nada
         * olhava a RESPOSTA. A ponte entrega numa cadeia onde nao temos
         * como desfazer, e o endereco de entrega e escolha do agregador a
         * partir do que mandamos — se ele ignorar, alterar, ou se a resposta
         * for envenenada em transito, o dinheiro sai para outro lugar e o
         * usuario assina achando que confirmou o dele.
         *
         * E o mesmo raciocinio do `assertTrusted`, que ja confere o `to` e o
         * `spender` que voltaram do agregador. O destinatario faltava.
         *
         * ⚠️ FALHA FECHADO SO NA DIVERGENCIA, nunca na ausencia: se a LiFi
         * nao ecoar o campo, seguimos — exigir o que talvez nao venha
         * quebraria toda ponte por uma mudanca de contrato deles.
         */
        const destinoPedido  = (recipient ?? taker ?? "").trim();
        const destinoVoltou  = (q.action?.toAddress ?? "").trim();
        if (destinoPedido && destinoVoltou
            && destinoVoltou.toLowerCase() !== destinoPedido.toLowerCase()) {
          logSecurity("lifi_destino_divergente", {
            pedido: destinoPedido, voltou: destinoVoltou, fromChain, toChain,
          }, "high");
          return NextResponse.json({ error: "destino_divergente" }, { status: 502 });
        }
        /**
         * ⚠️ MESMA GRAVAÇÃO NO CAMINHO DA LI.FI, e aqui ela vale ainda mais: a
         * LI.FI recebe a taxa em FRAÇÃO (0,01) e não em pontos-base (100), e um
         * erro de unidade nessa conversão cobraria 100× a mais ou a menos sem
         * mudar nada na tela. `taxaAceita` sai da resposta dela, então a ordem
         * de grandeza fica conferível sem depender de ninguém abrir explorador.
         */
        // ⚠️ LIFI-UPSTREAM-01: o LI.FI SOMA a nossa taxa à dele ("LIFI Fixed Fee"); a busca por
        // nome não achava nada e acusava "taxa não retida" com a taxa retida. Ver `lifi.ts`.
        const retida = taxaDoIntegradorNaCotacao(q, taxaLiFi.bps / 10_000);
        const taxaAceitaLiFi = retida
          ? [{ amount: retida.amount, token: retida.token, pct: String(retida.pct), pctTotalLiFi: String(retida.pctTotal) }]
          : [];
        // ⚠️ AGUARDADO pelo mesmo motivo do caminho 0x acima.
        await recordEvent("swap_intent", { wallet: taker, meta: {
          source, fromChain, toChain, sellToken, buyToken, crossChain: true,
          chainId: lfArgs.fromChainId, target: q.transactionRequest?.to, spender: q.estimate?.approvalAddress,
          taxaPedidaBps: taxaLiFi.bps, taxaDestinatario: taxa.destinatario,
          taxaAceita: taxaAceitaLiFi,
          /**
           * ⚠️⚠️ A LISTA CRUA, E POR QUE ELA FALTAVA (14/08).
           *
           * O caminho do 0x grava `taxaRespostaCrua: q.fees` — o bloco inteiro,
           * sem filtro. Este aqui gravava SÓ o resultado filtrado, e o filtro é
           * uma expressão regular sobre `name`/`description`.
           *
           * Consequência: se a LI.FI nomear a nossa taxa de qualquer coisa que
           * não case com `integrator|z-swap|referrer`, `taxaAceita` volta `[]` —
           * **exatamente igual** a "a LI.FI ignorou o pedido". Duas situações,
           * uma aparência. É o defeito que custou três swaps do dono de
           * madrugada em 11/08, e o que quebrou aquele ciclo foi justamente
           * gravar o cru ao lado do interpretado.
           *
           * ⚠️ E AQUI ELE É PIOR QUE NO 0x, porque a cobrança da LI.FI NUNCA foi
           * conferida na cadeia. O `referrer` que mandamos pode ser campo de
           * INDICAÇÃO e não destino da taxa de integrador — em várias APIs desse
           * tipo o destinatário vive na configuração da conta, não no pedido. Se
           * for o caso, toda troca ENTRE CADEIAS está saindo sem cobrar, e a
           * tela não tem como notar. Enquanto ninguém abrir um explorador, isto
           * é intenção, não receita (`docs/TESTE-DA-TAXA-EVM.md`).
           */
          taxaRespostaCrua: q.estimate?.feeCosts ?? null,
        } });
        alertarTaxaNaoRetida({
          aceita: taxaAceitaLiFi, bps: taxaLiFi.bps,
          source: "lifi", fromChain, sellToken, buyToken,
        });
        return NextResponse.json(
          { ok: true, mode, source, taxa: taxaLiFi, result: q, normalized: normalizeLiFi(q) },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (source === "jupiter") {
        if (!isSameChainSolana) {
          return NextResponse.json({ error: "jupiter_solana_only" }, { status: 400 });
        }
        const { quote, swap } = await fetchJupiterFirm({ ...jupArgs, taker }, jupOpts);
        // ⚠️ AGUARDADO pelo mesmo motivo dos dois caminhos acima.
        await recordEvent("swap_intent", { wallet: taker, meta: { source, fromChain: "solana", toChain: "solana", sellToken, buyToken } });
        return NextResponse.json(
          {
            ok: true, mode, source, taxa: taxaJupiterConfirmada(quote),
            result: { quote, swap },
            normalized: normalizeJupiter(quote),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json({ error: "invalid_source" }, { status: 400 });
    } catch (err) {
      console.warn("[quote/firm] upstream error:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { ok: false, error: "upstream_failed" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // ─── List path — query all applicable sources in parallel ───────────
  const tasks: Promise<NormalizedQuote | null>[] = [];

  // 0x: same-chain only.
  // When the user has a wallet connected (`taker` is set) we call the
  // /quote endpoint (firm — returns transaction calldata). Without a taker
  // we fall back to /price (indicative — price-only, no calldata). This
  // ensures the swap CTA is never stuck disabled with "pick a firm route".
  if (!isCrossChain && isZeroXSupported(fromChain as ChainId) && zeroXKey) {
    tasks.push(
      (taker
        ? fetchZeroXQuote(zxArgs, zeroXKey).then((q) => normalizeZeroX(q, zxArgs.chainId, true))
        : fetchZeroXPrice(zxArgs, zeroXKey).then((q) => normalizeZeroX(q, zxArgs.chainId, false))
      ).catch((e) => {
        console.warn("[quote/list] 0x failed:", e instanceof Error ? e.message : e);
        return null;
      }),
    );
  }

  // LiFi: CROSS-CHAIN only. Same-chain swaps are owned by 0x (EVM) and
  // Jupiter (Solana) — both have deeper same-chain liquidity, and LiFi's
  // /v1/quote is bridge-oriented, so firing it for a same-chain pair is pure
  // redundancy + error surface (it was the source of the production
  // "missing fromAddress" 400s on same-chain ETH→USDC).
  //
  // LiFi also HARD-REQUIRES `fromAddress` to build the signable route, so a
  // speculative quote with no wallet connected can't get a LiFi route at all.
  // We skip (info-level "skipped: no taker") instead of firing a request we
  // know will 400 — that keeps "failed" in the logs meaning a real failure.
  if (
    isCrossChain &&
    isLiFiSupported(fromChain as ChainId) &&
    isLiFiSupported(toChain   as ChainId)
  ) {
    if (!taker) {
      console.info("[quote/list] LiFi skipped: no taker (connect wallet for cross-chain quotes)");
    } else {
      tasks.push(
        fetchLiFiQuote(lfArgs, lifiKey, { aoRecusarChave })
          .then(normalizeLiFi)
          .catch((e) => {
            console.warn("[quote/list] LiFi failed:", e instanceof Error ? e.message : e);
            return null;
          }),
      );
    }
  }

  // Jupiter: same-chain Solana only
  let taxaJupiterLista = taxaJupiter;
  if (isSameChainSolana) {
    tasks.push(
      fetchJupiterQuote(jupArgs, jupOpts)
        .then((q) => { taxaJupiterLista = taxaJupiterConfirmada(q); return normalizeJupiter(q); })
        .catch((e) => {
          console.warn("[quote/list] Jupiter failed:", e instanceof Error ? e.message : e);
          return null;
        }),
    );
  }

  if (tasks.length === 0) {
    return NextResponse.json(
      { ok: true, mode, quotes: [], taxa, note: "No aggregator supports this chain pair" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const settled = await Promise.all(tasks);
  // ⚠️⚠️ A33: a resposta da LISTA passa pela allowlist `paraListagem` — nenhum
  // `raw`, calldata, transactionRequest, permit2, spender ou quoteResponse sai
  // daqui. Executar exige `mode=quote`, que é o caminho sob o kill-switch.
  const quotes  = rankQuotes(settled.filter((x): x is NormalizedQuote => !!x)).map(paraListagem);

  return NextResponse.json(
    // ⚠️ LIFI-UPSTREAM-01: cross-chain aqui é só LiFi — a taxa divulgada é a dele.
    { ok: true, mode, quotes, taxa: isCrossChain ? taxaLiFi : isSameChainSolana ? taxaJupiterLista : taxa, isCrossChain },
    {
      // When a taker is present the amounts come from the firm upstream quote
      // for THAT wallet (the response no longer carries calldata — A33): keep it
      // out of shared caches. Without a taker a short CDN cache is fine.
      headers: {
        "Cache-Control": taker
          ? "no-store"
          : "public, s-maxage=5, stale-while-revalidate=15",
      },
    },
  );
}
