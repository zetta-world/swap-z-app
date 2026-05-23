import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { fetchCexBalance } from "@/lib/cex/server";
import type { CexId, CexCredentials, CexBalanceResponse } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(["binance", "coinbase", "okx"]);
const RL_OPTS = { windowMs: 60_000, max: 15 };

interface BalanceRequestBody {
  exchange:   string;
  apiKey:     string;
  apiSecret:  string;
  passphrase?: string;
  withUsd?:   boolean;
}

/**
 * POST /api/cex/balance
 * Body (JSON): { exchange, apiKey, apiSecret, passphrase?, withUsd? }
 *
 * Pulls the user's balances on the requested CEX via ccxt. The credentials
 * arrive in the request body, are used for ONE call, and are dropped.
 * They never persist server-side, never appear in logs, and the response
 * does not echo them back.
 */
export async function POST(req: NextRequest) {
  // Method enforcement: GET would put credentials in URLs / access logs.
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = rateLimit(`cex_balance:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: BalanceRequestBody;
  try {
    body = await req.json() as BalanceRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }
  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
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
    const { balances, totalUsd } = await fetchCexBalance(exchange, creds, body.withUsd !== false);
    const resp: CexBalanceResponse = {
      ok:        true,
      exchange,
      balances,
      totalUsd,
      fetchedAt: Date.now(),
    };
    return NextResponse.json(resp, {
      headers: { "Cache-Control": "no-store, no-transform" },
    });
  } catch (err) {
    // Never echo the raw ccxt error — it can leak schema details and even
    // sometimes the key itself in retry-after URLs. Log server-side, return
    // a coarse code.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/balance]", exchange, "failed:", msg);
    const code = classifyCexError(msg);
    return NextResponse.json(
      { ok: false, error: code },
      { status: code === "auth_failed" ? 401 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function classifyCexError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid api") || m.includes("signature") || m.includes("unauthorized")
      || m.includes("apikey") || m.includes("invalid key")) {
    return "auth_failed";
  }
  if (m.includes("ip") && m.includes("not")) return "ip_not_whitelisted";
  if (m.includes("permission") || m.includes("scope")) return "permission_denied";
  if (m.includes("timeout") || m.includes("etimeout")) return "timeout";
  return "upstream_failed";
}
