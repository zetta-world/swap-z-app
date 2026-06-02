import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { fetchCexDepositAddress } from "@/lib/cex/server";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { type CexId, type CexCredentials, SUPPORTED_CEX_IDS, CEX_META } from "@/lib/cex/types";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";
// Pin to non-US regions to bypass Binance.com geo-block on AWS US IPs.
// See balance/route.ts for the full rationale.
export const preferredRegion = ["gru1", "fra1"];

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);
// Tighter than balance/orderbook — the deposit-address path hits a more
// rate-sensitive upstream endpoint on every exchange and we only need to
// read it once per (currency, network) the user is interested in.
const RL_OPTS = { windowMs: 60_000, max: 10 };

interface BodyShape {
  exchange:   string;
  currency:   string;
  network?:   string;
  apiKey:     string;
  apiSecret:  string;
  passphrase?: string;
}

/**
 * POST /api/cex/deposit-address
 *
 * Returns the user's deposit address (and memo + network) for one
 * (currency, network) on one connected exchange. Pure read — does NOT
 * move funds, does NOT require 2FA. The UI uses this to surface a
 * copy-able address the user pastes into MetaMask (or whatever wallet)
 * to fund their CEX account.
 *
 * SECURITY: even though this endpoint doesn't move money, the response
 * IS the destination address. A spoofed response = funds sent to an
 * attacker. We do not cache, do not log the address, and never echo the
 * credentials back.
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = rateLimit(`cex_deposit_addr:${getClientId(req.headers)}`, RL_OPTS);
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
  if (typeof body.currency !== "string" || !/^[A-Za-z0-9_-]{2,20}$/.test(body.currency)) {
    return NextResponse.json({ ok: false, error: "invalid_currency" }, { status: 400 });
  }
  if (body.network !== undefined && (typeof body.network !== "string" || !/^[A-Za-z0-9_-]{2,32}$/.test(body.network))) {
    return NextResponse.json({ ok: false, error: "invalid_network" }, { status: 400 });
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
    const addr = await fetchCexDepositAddress(
      exchange, creds, body.currency.toUpperCase(), body.network,
    );
    return NextResponse.json(
      { ok: true, exchange, currency: body.currency.toUpperCase(), ...addr },
      { headers: { "Cache-Control": "no-store, no-transform" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Address material — extra paranoid about server logs. We only emit
    // the exchange + currency, never the address even if the upstream
    // included it in the error.
    console.warn("[cex/deposit-address]", exchange, body.currency, "failed:", msg.slice(0, 120));
    const code = classifyCexError(msg);
    const detail = sanitizeUpstreamMessage(msg, body.apiKey);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
