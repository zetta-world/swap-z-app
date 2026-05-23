import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { isValidChain } from "@/lib/validate";
import {
  getPoolsPage, searchPools, type PoolSummary,
} from "@/lib/api/geckoterminal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 40 };

interface CatalogResponse {
  ok:          boolean;
  pools:       PoolSummary[];
  page:        number;
  /** True when the upstream returned a full page; client can keep going. */
  hasMore:     boolean;
  generatedAt: number;
}

/**
 * /api/pools-catalog — paginated/searchable catalog of every pool on a
 * given chain. Either:
 *
 *   ?chain=<id>&page=<N>       paginate (20 pools per page) within one chain
 *   ?q=<query>                 cross-chain search by symbol or address
 *
 * Search wins when both are present. Edge-cached 30s with SWR — repeat
 * queries on the same page+chain don't re-hit GeckoTerminal.
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(`pools-catalog:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const params = req.nextUrl.searchParams;
  const queryRaw = (params.get("q") ?? "").trim().slice(0, 80);
  // Only allow alnum + a few token separators to avoid SSRF / injection
  const query = /^[A-Za-z0-9_\-./]*$/.test(queryRaw) ? queryRaw : "";

  if (query) {
    const pools = await searchPools(query, 40);
    const body: CatalogResponse = {
      ok:          true,
      pools,
      page:        1,
      hasMore:     false,
      generatedAt: Date.now(),
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=90" },
    });
  }

  const chainParam = params.get("chain");
  if (chainParam && !isValidChain(chainParam)) {
    return NextResponse.json({ ok: false, error: "invalid_chain" }, { status: 400 });
  }
  const chain = chainParam ?? "ethereum";

  const pageRaw = params.get("page");
  const page = pageRaw && /^\d+$/.test(pageRaw)
    ? Math.max(1, Math.min(100, parseInt(pageRaw, 10)))
    : 1;

  const pools = await getPoolsPage(chain, page);

  const body: CatalogResponse = {
    ok:          true,
    pools,
    page,
    hasMore:     pools.length >= 20,
    generatedAt: Date.now(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=90" },
  });
}
