import { NextRequest, NextResponse } from "next/server";
import { getTopPools, getTrendingPools } from "@/lib/api/geckoterminal";

export const runtime = "nodejs";
export const revalidate = 30;

export async function GET(req: NextRequest) {
  const chain = req.nextUrl.searchParams.get("chain");
  const trending = req.nextUrl.searchParams.get("trending") === "1";
  try {
    const pools = trending
      ? await getTrendingPools(20)
      : chain
        ? await getTopPools(chain, 12)
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
