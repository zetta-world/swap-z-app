import { NextRequest, NextResponse } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { placeCexOrder } from "@/lib/cex/server";
import { getReferencePriceUsd, checkRealNotional } from "@/lib/autopilot/price-guard";
import { podeAutomatizar } from "@/lib/autopilot/liberacao";
import { checarKillSwitches } from "@/lib/admin/kill-switches";
import { getSession } from "@/lib/auth/session";
import { logSecurity, logError } from "@/lib/admin/track";
import { recordEvent } from "@/lib/admin/track";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { checkFeatureTier, denialResponse } from "@/lib/tier/enforce";
import {
  type CexId, type CexCredentials, type CexOrderResponse, type CexOrderSide, type CexOrderType,
  SUPPORTED_CEX_IDS, CEX_META,
} from "@/lib/cex/types";

export const runtime = "nodejs";
/**
 * ⚠️ SÃO PAULO, NÃO VIRGÍNIA — e é conformidade, não desempenho (12/08).
 *
 * A Binance devolve 451 (bloqueio geográfico) para chamadas vindas de
 * infraestrutura nos EUA quando a conta é Binance Brasil. Esta rota fala com
 * a corretora, então ela sai do Brasil — que é como servir cliente brasileiro
 * a partir de infraestrutura brasileira, e não contornar restrição nenhuma.
 *
 * ⚠️ E É POR ROTA, NÃO NO `vercel.json`. Mover TODAS as funções para `gru1`
 * foi a proposta inicial e teria quebrado o painel: o Supabase está em
 * `us-east-1`, então cada consulta ao banco passaria a atravessar São Paulo ↔
 * Virgínia (~5ms viram ~120ms). A rota `/admin/api/lab` faz ~85 idas ao banco
 * e passaria de meio segundo para mais de dez. As 52 rotas administrativas que
 * só falam com o banco ficam em `iad1`, coladas nele.
 *
 * Esta aqui faz 1 a 2 consultas e já espera 300-800ms pela própria Binance —
 * o custo da distância é ruído dentro do tempo que a corretora leva.
 */
export const preferredRegion = "gru1";
export const dynamic = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);

// Tight rate limit — placing real orders is intentionally slow. The user
// must wait between submissions; bursts trigger a 429 we let through.
const RL_OPTS = { windowMs: 60_000, max: 8 };

interface OrderRequestBody {
  exchange:    string;
  symbol:      string;
  side:        string;
  type:        string;
  amount:      number;
  price?:      number;
  /** Magic string the client must send. Defense in depth against accidental
   *  calls — the UI sets this only after the user passed the confirmation
   *  modal + 3-second cooldown. */
  confirm:     string;
  apiKey:      string;
  apiSecret:   string;
  passphrase?: string;
  /** Set true by the autopilot bridge. Triggers the real-price notional
   *  guard below — the amount/price came from LLM text and must be checked
   *  against a fresh reference price, not trusted as-is. */
  autopilot?:  boolean;
  /** The user's per-trade USD cap, forwarded so the server can reject an
   *  order whose REAL notional (baseAmount × reference price) blows past it.
   *  Defense in depth: a buggy client cannot place a catastrophic order. */
  maxNotionalUsd?: number;
}

/**
 * POST /api/cex/order — place a market or limit order on the user's CEX.
 *
 * REAL FUNDS MOVE WHEN THIS SUCCEEDS. The credentials arrive in the body,
 * are used exactly once, and discarded. The server does not log the body,
 * does not echo the credentials in any error path, and does not persist
 * the order anywhere except as the response back to the client (the user's
 * own browser carries any order-history retention).
 *
 * Body: {
 *   exchange,         // 'binance' | 'coinbase' | 'okx'
 *   symbol,           // ccxt format e.g. "BTC/USDT"
 *   side,             // 'buy' | 'sell'
 *   type,             // 'market' | 'limit'
 *   amount,           // base-asset quantity (BTC for BTC/USDT)
 *   price?,           // required for limit
 *   confirm,          // must equal "I-CONFIRM-REAL-ORDER"
 *   apiKey, apiSecret, passphrase?
 * }
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = await rateLimitDurable(`cex_order:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    logSecurity("rate_limited", { route: "cex/order" }, "low");
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // GATE DE PLANO (auditoria 01/08). `FEATURE_TIER.cexAutopilot = "pro"` estava
  // declarado desde sempre e NUNCA era verificado no servidor: o controle vivia
  // só no `TierGate`, componente de cliente que ESCONDE a interface. Esconder
  // botão não é controle de acesso — um `curl` nesta rota entregava igual, e a
  // rota nem precisava ser descoberta, porque o código dela vai no bundle.
  // Dormente com TIER_GATES_ENABLED=false, igual à UI.
  const gate = await checkFeatureTier("cexAutopilot");
  if (gate) return denialResponse(gate);

  /**
   * ⚠️ OS KILL-SWITCHES, agora lidos (Fase 7.3). Vale para ordem MANUAL também:
   * `disable_cex` e `maintenance_mode` existem para parar o dinheiro, não para
   * parar só o robô. Esta rota é dinheiro que SAI da conta do cliente, então
   * falha de leitura BLOQUEIA — ver a nota em `kill-switches.ts`.
   */
  const kill = await checarKillSwitches(["disable_cex", "maintenance_mode"], "dinheiro_sai");
  if (kill.bloqueado) {
    return NextResponse.json(
      { ok: false, error: "platform_disabled", detail: kill.motivo },
      { status: 503 },
    );
  }

  let body: OrderRequestBody;
  try {
    body = await req.json() as OrderRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // ─── Validation ─────────────────────────────────────────────────────

  // Confirmation guard — the client must pass this exact string. Default
  // catch for accidental scripted submissions.
  if (body.confirm !== "I-CONFIRM-REAL-ORDER") {
    // Calling the live-order endpoint without the exact token is a strong
    // abuse/probing signal — surface it loudly.
    logSecurity("invalid_confirmation", { route: "cex/order" }, "high");
    return NextResponse.json({ ok: false, error: "missing_confirmation" }, { status: 400 });
  }

  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }

  if (typeof body.symbol !== "string" || !/^[A-Z0-9]{2,20}[\/\-][A-Z0-9]{2,20}$/i.test(body.symbol)) {
    return NextResponse.json({ ok: false, error: "invalid_symbol" }, { status: 400 });
  }

  const side = (body.side || "").toLowerCase() as CexOrderSide;
  if (side !== "buy" && side !== "sell") {
    return NextResponse.json({ ok: false, error: "invalid_side" }, { status: 400 });
  }

  const type = (body.type || "").toLowerCase() as CexOrderType;
  if (type !== "market" && type !== "limit") {
    return NextResponse.json({ ok: false, error: "invalid_type" }, { status: 400 });
  }

  if (typeof body.amount !== "number" || body.amount <= 0 || !Number.isFinite(body.amount)) {
    return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400 });
  }

  if (type === "limit") {
    if (typeof body.price !== "number" || body.price <= 0 || !Number.isFinite(body.price)) {
      return NextResponse.json({ ok: false, error: "invalid_price" }, { status: 400 });
    }
  }

  // Server-side notional ceiling — defense in depth. The client enforces
  // per-trade caps, but a buggy client, a replayed request, or a direct
  // call must NOT be able to place a catastrophic order. When the notional
  // is computable (a price is present), hard-cap it well above any sane
  // single trade. Market orders carry no price so this can't bind them;
  // those still pass through the client cap + the confirm guard.
  const HARD_NOTIONAL_CEILING_USD = 100_000;
  if (typeof body.price === "number" && Number.isFinite(body.price) && body.price > 0) {
    const notional = body.amount * body.price;
    if (Number.isFinite(notional) && notional > HARD_NOTIONAL_CEILING_USD) {
      return NextResponse.json({ ok: false, error: "notional_too_large" }, { status: 400 });
    }
  }

  // Autopilot real-price notional guard (C1/C4). For autopilot orders the
  // amount came from LLM text; a market BUY carries no price so the ceiling
  // above can't bind it. Recompute the TRUE notional from a fresh reference
  // price and reject oversized buys (and any order over the hard ceiling).
  // Manual orders skip this — the user is present and accepted the trade.
  if (body.autopilot === true) {
    /**
     * ⚠️ TRAVA DE LIBERAÇÃO (Fase 7.2), no canal do NAVEGADOR.
     *
     * Gatear só o cron deixaria a metade errada aberta: o piloto do navegador
     * (`AutopilotPilot`) dispara sozinho por esta rota quando a contagem
     * regressiva zera. "Fechado" com um dos dois canais operando seria meia
     * verdade — o defeito que a Fase 6 chamou de "mesmo defeito com outro nome".
     *
     * ⚠️ E ISTO NÃO É CONTROLE DE SEGURANÇA, é controle de PRODUTO: a flag
     * `autopilot` vem do cliente, então quem quiser pode chamar esta rota sem
     * ela. Não tem problema, e a distinção é deliberada — ordem MANUAL segue
     * aberta de propósito. O que a trava fecha é a automação, não o negociar.
     */
    /**
     * ⚠️ AQUI PRECISA DA CARTEIRA, e esta rota não tinha identidade nenhuma:
     * ela recebe a credencial da corretora no corpo e nunca leu sessão. Sem
     * ler a sessão, não há como distinguir o piloto autorizado do público — a
     * trava viraria tudo-ou-nada justamente no canal do navegador.
     *
     * Ler a sessão AQUI, dentro do ramo de autopilot, mantém a ordem MANUAL
     * exatamente como estava: sem exigir login, aberta de propósito.
     */
    const sessao = await getSession();
    const automacao = await podeAutomatizar(sessao?.sub ?? "");
    if (!automacao.permitido) {
      return NextResponse.json(
        { ok: false, error: "automation_closed", causa: automacao.causa },
        { status: 403 },
      );
    }
    const base = body.symbol.split(/[\/\-]/)[0];
    const refPrice = await getReferencePriceUsd(base);
    const cap = typeof body.maxNotionalUsd === "number" && body.maxNotionalUsd > 0
      ? body.maxNotionalUsd
      : HARD_NOTIONAL_CEILING_USD;
    const guard = checkRealNotional({ side, baseAmount: body.amount, refPrice, maxTradeUsd: cap });
    if (!guard.ok) {
      logSecurity("notional_guard_block", { route: "cex/order", symbol: body.symbol, reason: guard.reason }, "high");
      return NextResponse.json(
        { ok: false, error: "notional_guard", detail: guard.reason },
        { status: 400 },
      );
    }
  }

  if (typeof body.apiKey !== "string" || body.apiKey.length < 8 || body.apiKey.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid_api_key" }, { status: 400 });
  }
  if (typeof body.apiSecret !== "string" || body.apiSecret.length < 8 || body.apiSecret.length > 600) {
    return NextResponse.json({ ok: false, error: "invalid_api_secret" }, { status: 400 });
  }
  if (CEX_META[exchange].needsPassphrase && (!body.passphrase || typeof body.passphrase !== "string")) {
    return NextResponse.json(
      { ok: false, error: `passphrase_required_for_${exchange}` },
      { status: 400 },
    );
  }

  const creds: CexCredentials = {
    apiKey:    body.apiKey,
    apiSecret: body.apiSecret,
    passphrase: body.passphrase,
  };

  try {
    const { order, filledImmediately } = await placeCexOrder(exchange, creds, {
      symbol: body.symbol,
      side,
      type,
      amount: body.amount,
      price:  type === "limit" ? body.price : undefined,
    });
    const resp: CexOrderResponse = {
      ok:        true,
      exchange,
      order,
      filledImmediately,
      fetchedAt: Date.now(),
    };
    recordEvent("cex_order", {
      meta: {
        exchange,
        symbol: body.symbol,
        side,
        type,
        filledImmediately,
        notional: typeof body.price === "number" ? body.amount * body.price : null,
      },
    });
    return NextResponse.json(resp, {
      headers: { "Cache-Control": "no-store, no-transform" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/order]", exchange, body.symbol, side, type, "failed:", msg);
    const code = classifyCexError(msg);
    logError("cex/order", code, { exchange, symbol: body.symbol, side, type });
    const detail = sanitizeUpstreamMessage(msg, body.apiKey);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
