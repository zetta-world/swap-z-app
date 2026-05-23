import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { isValidChain } from "@/lib/validate";
import {
  getNewPoolsForChain, getNewPoolsAcrossChains, type PoolSummary,
} from "@/lib/api/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 40 };

interface NewPairsResponse {
  ok:        boolean;
  pools:     PoolSummary[];
  generatedAt: number;
}

/**
 * /api/new-pairs — feed of newly-created liquidity pools across the Nexus.
 *
 * Query params:
 *   chain     optional internal ChainId — limits to that chain. Omit to scan
 *             all supported chains in parallel.
 *   limit     max pools to return (1-60, default 30)
 *   maxAgeH   filter to pools younger than this many hours (default unlimited)
 *
 * Sorted reverse-chronologically. Live feed in /explorer polls this on a
 * short interval. Edge-cached 15 s with SWR so two adjacent users in the
 * same region don't double-hit GeckoTerminal.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`newp:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const params = req.nextUrl.searchParams;
  const chainParam = params.get("chain");
  if (chainParam && !isValidChain(chainParam)) {
    return NextResponse.json({ ok: false, error: "invalid_chain" }, { status: 400 });
  }
  const limitRaw = params.get("limit");
  const limit = limitRaw && /^\d+$/.test(limitRaw)
    ? Math.max(1, Math.min(60, parseInt(limitRaw, 10)))
    : 30;

  const maxAgeRaw = params.get("maxAgeH");
  const maxAgeMs = maxAgeRaw && /^\d+(\.\d+)?$/.test(maxAgeRaw)
    ? parseFloat(maxAgeRaw) * 3_600_000
    : Infinity;

  // Fetch
  const pools: PoolSummary[] = chainParam
    ? await getNewPoolsForChain(chainParam, Math.min(limit * 2, 50))
    : await getNewPoolsAcrossChains(Math.ceil(limit / 5));

  // Sort by createdAt desc; pools without timestamps drop to the back
  const sorted = [...pools].sort((a, b) => {
    const aT = a.createdAtMs ?? 0;
    const bT = b.createdAtMs ?? 0;
    return bT - aT;
  });

  // Apply age filter
  const now = Date.now();
  const filtered = Number.isFinite(maxAgeMs)
    ? sorted.filter((p) => p.createdAtMs !== undefined && now - p.createdAtMs <= maxAgeMs)
    : sorted;

  const trimmed = filtered.slice(0, limit);

  const body: NewPairsResponse = {
    ok: true,
    pools: trimmed,
    generatedAt: now,
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=45",
    },
  });
}
