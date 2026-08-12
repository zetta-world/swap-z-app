import { NextRequest, NextResponse } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { fetchCexOrderbook } from "@/lib/cex/server";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { type CexId, type CexCredentials, type CexOrderbookSnapshot, SUPPORTED_CEX_IDS, CEX_META } from "@/lib/cex/types";

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
const RL_OPTS = { windowMs: 60_000, max: 60 };

interface OrderbookRequestBody {
  exchange:   string;
  symbol:     string;          // ccxt format e.g. "BTC/USDT" or "BTC-USD"
  apiKey:     string;
  apiSecret:  string;
  passphrase?: string;
  depth?:     number;          // 1-50 (default 10)
}

/**
 * POST /api/cex/orderbook
 * Returns a thin order-book snapshot from the selected CEX. Used by the
 * swap card / pair page to surface a "CEX route" as an alternative to
 * the DEX aggregator quotes.
 *
 * Credentials never persist (see /api/cex/balance for the threat model).
 * Read-only API permission is sufficient on every supported exchange.
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = await rateLimitDurable(`cex_ob:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: OrderbookRequestBody;
  try {
    body = await req.json() as OrderbookRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  if (typeof body.symbol !== "string" || !/^[A-Z0-9]{2,20}[\/\-][A-Z0-9]{2,20}$/i.test(body.symbol)) {
    return NextResponse.json({ ok: false, error: "invalid_symbol" }, { status: 400 });
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

  const depth = body.depth && Number.isInteger(body.depth)
    ? Math.max(1, Math.min(50, body.depth))
    : 10;

  const creds: CexCredentials = {
    apiKey:    body.apiKey,
    apiSecret: body.apiSecret,
    passphrase: body.passphrase,
  };

  try {
    const data = await fetchCexOrderbook(exchange, creds, body.symbol, depth);
    const resp: CexOrderbookSnapshot = {
      ok:        true,
      exchange,
      ...data,
      fetchedAt: Date.now(),
    };
    return NextResponse.json(resp, {
      headers: { "Cache-Control": "no-store, no-transform" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/orderbook]", exchange, body.symbol, "failed:", msg);
    const code = classifyCexError(msg);
    const detail = sanitizeUpstreamMessage(msg, body.apiKey);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
