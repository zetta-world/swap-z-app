import { NextRequest, NextResponse } from "next/server";
import { getOHLCV, type Timeframe } from "@/lib/api/geckoterminal";
import { isValidChain, validateAddress } from "@/lib/validate";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";

const RL_OPTS = { windowMs: 60_000, max: 60 };
const VALID_TFS = new Set<Timeframe>(["1m", "5m", "15m", "1h", "4h", "1d"]);

/**
 * /api/ohlcv?chain=ethereum&pool=0x...&tf=5m
 * Returns OHLCV candles from GeckoTerminal for the Pro chart.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`ohlcv:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { candles: [], error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const chain = req.nextUrl.searchParams.get("chain");
  const pool  = req.nextUrl.searchParams.get("pool");
  const tfRaw = (req.nextUrl.searchParams.get("tf") || "5m") as Timeframe;

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

  const candles = await getOHLCV(chain, poolAddr, tfRaw, 250);
  return NextResponse.json(
    { candles, chain, pool: poolAddr, tf: tfRaw, ts: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
  );
}
