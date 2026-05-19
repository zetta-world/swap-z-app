import { NextRequest, NextResponse } from "next/server";
import { getPoolMeta } from "@/lib/api/geckoterminal";
import { isValidChain, validateAddress } from "@/lib/validate";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";

const RL_OPTS = { windowMs: 60_000, max: 60 };

/**
 * /api/pool-meta?chain=ethereum&pool=0x...
 * Returns pool metadata (base/quote symbols, dex, TVL) — used by ProChart
 * to determine which side of the pool's price to display on the chart.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`pmeta:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { meta: null, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const chain = req.nextUrl.searchParams.get("chain");
  const pool  = req.nextUrl.searchParams.get("pool");

  if (!isValidChain(chain)) {
    return NextResponse.json({ meta: null, error: "invalid chain" }, { status: 400 });
  }
  const poolAddr = validateAddress(pool);
  if (!poolAddr) {
    return NextResponse.json({ meta: null, error: "invalid pool address" }, { status: 400 });
  }

  const meta = await getPoolMeta(chain, poolAddr);
  return NextResponse.json(
    { meta, ts: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
  );
}
