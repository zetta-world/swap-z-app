import { NextRequest, NextResponse } from "next/server";
import { getTrending } from "@/lib/api/dexscreener";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 60;

// CDN cache already absorbs nearly all traffic (no query params, single
// canonical URL), but adding the limiter is a cheap defense-in-depth
// guard so we never serve the underlying DexScreener call more than this
// per single IP — same posture as every other public route.
const RL_OPTS = { windowMs: 60_000, max: 60 };

export async function GET(req: NextRequest) {
  const rl = rateLimit(`trending:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { pairs: [], error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  try {
    const pairs = await getTrending(12);
    return NextResponse.json(
      { pairs, ts: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
    );
  } catch (err) {
    return NextResponse.json(
      { pairs: [], error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
