import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { fetchCexOrderStatus } from "@/lib/cex/server";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { type CexId, type CexCredentials, SUPPORTED_CEX_IDS, CEX_META } from "@/lib/cex/types";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);
// The autopilot polls one order every 5-10 s until it closes. Generous
// burst limit so two cross-CEX legs polling in parallel never trip 429.
const RL_OPTS = { windowMs: 60_000, max: 60 };

interface BodyShape {
  exchange:   string;
  orderId:    string;
  symbol:     string;
  apiKey:     string;
  apiSecret:  string;
  passphrase?: string;
}

/**
 * POST /api/cex/order/status
 *
 * Look up one specific order by id + symbol. Used primarily by the
 * autopilot's loss-stop poller: after firing a limit order it polls
 * this endpoint until status flips to "closed"/"filled", then reads
 * the average fill price to compute realized PnL.
 *
 * No money moves here. Pure read.
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = rateLimit(`cex_order_status:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: BodyShape;
  try {
    body = await req.json() as BodyShape;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  if (typeof body.orderId !== "string" || body.orderId.length < 1 || body.orderId.length > 120) {
    return NextResponse.json({ ok: false, error: "invalid_order_id" }, { status: 400 });
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
    return NextResponse.json({ ok: false, error: `passphrase_required_for_${exchange}` }, { status: 400 });
  }

  const creds: CexCredentials = {
    apiKey:    body.apiKey,
    apiSecret: body.apiSecret,
    passphrase: body.passphrase,
  };

  try {
    const order = await fetchCexOrderStatus(exchange, creds, body.orderId, body.symbol);
    return NextResponse.json(
      { ok: true, exchange, order, fetchedAt: Date.now() },
      { headers: { "Cache-Control": "no-store, no-transform" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/order/status]", exchange, body.symbol, body.orderId, "failed:", msg.slice(0, 120));
    const code = classifyCexError(msg);
    const detail = sanitizeUpstreamMessage(msg, body.apiKey);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
