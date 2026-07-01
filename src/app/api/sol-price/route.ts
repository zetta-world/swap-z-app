import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Public SOL/USD spot — feeds the USD-pegged pricing display (usdToSol). Cached
 * 5 min so the pricing page is snappy and we don't hammer CoinGecko. Returns
 * `{ solUsd: null }` (never throws) so the UI degrades to the USD price alone.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return NextResponse.json({ solUsd: null });
    const j = (await res.json()) as { solana?: { usd?: number } };
    const solUsd = j.solana?.usd;
    return NextResponse.json(
      { solUsd: typeof solUsd === "number" && solUsd > 0 ? solUsd : null },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch {
    return NextResponse.json({ solUsd: null });
  }
}
