import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { listOpenCexOrders } from "@/lib/cex/server";
import { type CexId, type CexCredentials, type CexOpenOrdersResponse, SUPPORTED_CEX_IDS, CEX_META } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);
const RL_OPTS = { windowMs: 60_000, max: 30 };

interface OpenOrdersRequestBody {
  exchange:    string;
  symbol?:     string;
  apiKey:      string;
  apiSecret:   string;
  passphrase?: string;
}

/**
 * POST /api/cex/orders/open — list the user's currently open orders.
 *
 * Optional `symbol` narrows the query (some exchanges require it; ccxt
 * abstracts that). Credentials don't persist server-side.
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = rateLimit(`cex_open:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: OpenOrdersRequestBody;
  try {
    body = await req.json() as OpenOrdersRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  if (body.symbol && (typeof body.symbol !== "string" || !/^[A-Z0-9]{2,20}[\/\-][A-Z0-9]{2,20}$/i.test(body.symbol))) {
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

  const creds: CexCredentials = {
    apiKey:    body.apiKey,
    apiSecret: body.apiSecret,
    passphrase: body.passphrase,
  };

  try {
    const orders = await listOpenCexOrders(exchange, creds, body.symbol);
    const resp: CexOpenOrdersResponse = {
      ok:        true,
      exchange,
      orders,
      fetchedAt: Date.now(),
    };
    return NextResponse.json(resp, {
      headers: { "Cache-Control": "no-store, no-transform" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/orders/open]", exchange, "failed:", msg);
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
  if (m.includes("permission") || m.includes("scope")) return "permission_denied";
  if (m.includes("timeout") || m.includes("etimeout")) return "timeout";
  return "upstream_failed";
}
