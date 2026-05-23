import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { cancelCexOrder } from "@/lib/cex/server";
import type { CexId, CexCredentials } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(["binance", "coinbase", "okx"]);
const RL_OPTS = { windowMs: 60_000, max: 20 };

interface CancelRequestBody {
  exchange:    string;
  orderId:     string;
  symbol:      string;
  apiKey:      string;
  apiSecret:   string;
  passphrase?: string;
}

/**
 * POST /api/cex/order/cancel — cancel one open order on the exchange.
 *
 * Credentials never persist (same threat model as the other CEX routes).
 * Cancellation requires the same API scope as placing — read+trade.
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = rateLimit(`cex_cancel:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: CancelRequestBody;
  try {
    body = await req.json() as CancelRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  if (typeof body.orderId !== "string" || body.orderId.length < 1 || body.orderId.length > 100) {
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
  if (exchange === "okx" && (!body.passphrase || typeof body.passphrase !== "string")) {
    return NextResponse.json({ ok: false, error: "passphrase_required_for_okx" }, { status: 400 });
  }

  const creds: CexCredentials = {
    apiKey:    body.apiKey,
    apiSecret: body.apiSecret,
    passphrase: body.passphrase,
  };

  try {
    const order = await cancelCexOrder(exchange, creds, body.orderId, body.symbol);
    return NextResponse.json(
      { ok: true, exchange, order, fetchedAt: Date.now() },
      { headers: { "Cache-Control": "no-store, no-transform" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/order/cancel]", exchange, body.symbol, body.orderId, "failed:", msg);
    const code = classifyCexError(msg);
    return NextResponse.json(
      { ok: false, error: code },
      { status: code === "auth_failed" ? 401 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function classifyCexError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid api") || m.includes("signature") || m.includes("unauthorized") || m.includes("apikey")) {
    return "auth_failed";
  }
  if (m.includes("order") && (m.includes("not found") || m.includes("does not exist") || m.includes("unknown"))) {
    return "order_not_found";
  }
  if (m.includes("already") && (m.includes("filled") || m.includes("closed") || m.includes("cancel"))) {
    return "order_already_closed";
  }
  if (m.includes("timeout") || m.includes("etimeout")) return "timeout";
  return "upstream_failed";
}
