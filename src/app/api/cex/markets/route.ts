import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { fetchCexMarkets } from "@/lib/cex/server";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { type CexId, SUPPORTED_CEX_IDS } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);
const RL_OPTS = { windowMs: 60_000, max: 20 };

/**
 * POST /api/cex/markets
 * Returns the full list of active spot markets for the selected exchange.
 * The response carries a 5-minute Cache-Control so repeat opens of the
 * pair selector are instant (Vercel edge cache).
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`cex_markets:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429 },
    );
  }

  let body: Record<string, string>;
  try { body = await req.json() as Record<string, string>; }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const { exchange, apiKey, apiSecret, passphrase } = body;
  if (!exchange || !VALID_EXCHANGES.has(exchange as CexId)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  if (!apiKey || !apiSecret) {
    return NextResponse.json({ ok: false, error: "missing_credentials" }, { status: 400 });
  }

  try {
    const markets = await fetchCexMarkets(exchange as CexId, { apiKey, apiSecret, passphrase });
    return NextResponse.json({ ok: true, markets }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (e) {
    const raw  = e instanceof Error ? e.message : String(e);
    const code = classifyCexError(raw);
    const msg  = sanitizeUpstreamMessage(raw, apiKey);
    return NextResponse.json({ ok: false, error: code, detail: msg }, { status: statusForError(code) });
  }
}
