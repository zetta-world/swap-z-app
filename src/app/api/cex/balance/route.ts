import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { fetchCexBalance } from "@/lib/cex/server";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { type CexId, type CexCredentials, type CexBalanceResponse, SUPPORTED_CEX_IDS, CEX_META } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pin CEX routes to non-US Vercel regions because Binance.com geo-blocks
// AWS US ranges (iad1 / sfo1 / cle1 all return HTTP 451 with payloads
// that LOOK like timestamp errors but aren't). gru1 = São Paulo first,
// fra1 = Frankfurt as fallback. Coinbase / Gate.io / OKX are reachable
// from both. Only the CEX surface needs this — other /api/* routes
// hit DEX / Anthropic / price feeds with no source-IP policy.
export const preferredRegion = ["gru1", "fra1"];

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);
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
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[cex/balance]", exchange, "failed:", msg);
    const code = classifyCexError(msg);
    const detail = sanitizeUpstreamMessage(msg, body.apiKey);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
