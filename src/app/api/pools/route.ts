import { NextRequest, NextResponse } from "next/server";
import { getTopPools, getTrendingPools } from "@/lib/api/geckoterminal";
import { isValidChain } from "@/lib/validate";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 30;

const RL_OPTS = { windowMs: 60_000, max: 60 };

export async function GET(req: NextRequest) {
  // Rate limit (read-only / cached upstream, generous limit)
  const rl = rateLimit(`pools:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { pools: [], error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const chainParam = req.nextUrl.searchParams.get("chain");
  const trending   = req.nextUrl.searchParams.get("trending") === "1";

  // Chain is optional; if provided, must whitelist.
  if (chainParam && !isValidChain(chainParam)) {
    return NextResponse.json({ pools: [], error: "invalid chain" }, { status: 400 });
  }

  try {
    const pools = trending
      ? await getTrendingPools(20)
      : chainParam
        ? await getTopPools(chainParam, 12)
        : await getTrendingPools(20);
    return NextResponse.json(
      { pools, ts: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (err) {
    return NextResponse.json(
      { pools: [], error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
