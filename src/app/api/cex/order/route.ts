import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { placeCexOrder } from "@/lib/cex/server";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import {
  type CexId, type CexCredentials, type CexOrderResponse, type CexOrderSide, type CexOrderType,
  SUPPORTED_CEX_IDS, CEX_META,
} from "@/lib/cex/types";

export const runtime = "nodejs";
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

  const rl = rateLimit(`cex_order:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
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
    return NextResponse.json(resp, {
      headers: { "Cache-Control": "no-store, no-transform" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/order]", exchange, body.symbol, side, type, "failed:", msg);
    const code = classifyCexError(msg);
    const detail = sanitizeUpstreamMessage(msg, body.apiKey);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
