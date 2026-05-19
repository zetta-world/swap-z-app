import { NextRequest, NextResponse } from "next/server";
import { getOHLCV, type Timeframe, type PriceToken } from "@/lib/api/geckoterminal";
import { isValidChain, validateAddress } from "@/lib/validate";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";

const RL_OPTS = { windowMs: 60_000, max: 60 };
const VALID_TFS    = new Set<Timeframe>(["1m", "5m", "15m", "1h", "4h", "1d"]);
const VALID_TOKENS = new Set<PriceToken>(["base", "quote"]);

/**
 * /api/ohlcv?chain=ethereum&pool=0x...&tf=5m&token=base
 * Returns OHLCV candles from GeckoTerminal for the Pro chart.
 *
 * `token=base|quote` controls which side of the pool's price you get.
 * Use base for the most common case; quote when the asset you want to chart
 * is actually the pool's quote token (e.g. BNB on a USDT/BNB pool).
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`ohlcv:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { candles: [], error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const chain   = req.nextUrl.searchParams.get("chain");
  const pool    = req.nextUrl.searchParams.get("pool");
  const tfRaw   = (req.nextUrl.searchParams.get("tf") || "5m") as Timeframe;
  const tokRaw  = (req.nextUrl.searchParams.get("token") || "base") as PriceToken;

  if (!isValidChain(chain)) {
    return NextResponse.json({ candles: [], error: "invalid chain" }, { status: 400 });
  }
  const poolAddr = validateAddress(pool);
  if (!poolAddr) {
    return NextResponse.json({ candles: [], error: "invalid pool address" }, { status: 400 });
  }
  if (!VALID_TFS.has(tfRaw)) {
    return NextResponse.json({ candles: [], error: "invalid timeframe" }, { status: 400 });
  }
  if (!VALID_TOKENS.has(tokRaw)) {
    return NextResponse.json({ candles: [], error: "invalid token" }, { status: 400 });
  }

  const candles = await getOHLCV(chain, poolAddr, tfRaw, 250, tokRaw);
  return NextResponse.json(
    { candles, chain, pool: poolAddr, tf: tfRaw, token: tokRaw, ts: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
  );
}
