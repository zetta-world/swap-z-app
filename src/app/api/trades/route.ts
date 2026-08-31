import { NextRequest, NextResponse } from "next/server";
import { getRecentTrades } from "@/lib/api/geckoterminal";
import { isValidChain, validateAddress } from "@/lib/validate";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";

const RL_OPTS = { windowMs: 60_000, max: 60 };

/**
 * /api/trades?chain=ethereum&pool=0x...&token=base|quote
 * Returns recent swap trades on a pool (GeckoTerminal).
 *
 * ⚠️ `token` DIZ QUAL PONTA DO PAR COTAR, e sem ele o preço de cada linha vinha
 * da ponta que por acaso estava saindo do swap — trocando de token conforme a
 * direção. Ver `getRecentTrades`. É o MESMO parâmetro que `/api/ohlcv` já usa
 * para não desenhar $1 no lugar de $700.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`trades:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { trades: [], error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const chain = req.nextUrl.searchParams.get("chain");
  const pool  = req.nextUrl.searchParams.get("pool");

  if (!isValidChain(chain)) {
    return NextResponse.json({ trades: [], error: "invalid chain" }, { status: 400 });
  }
  const poolAddr = validateAddress(pool);
  if (!poolAddr) {
    return NextResponse.json({ trades: [], error: "invalid pool address" }, { status: 400 });
  }

  const tokenParam = req.nextUrl.searchParams.get("token");
  const lado = tokenParam === "quote" ? "quote" as const : tokenParam === "base" ? "base" as const : undefined;

  const trades = await getRecentTrades(chain, poolAddr, 30, lado);
  return NextResponse.json(
    { trades, chain, pool: poolAddr, ts: Date.now() },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=20" } },
  );
}
