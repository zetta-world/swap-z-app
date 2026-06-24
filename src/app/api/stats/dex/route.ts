import { NextResponse } from "next/server";
import { getDexMarketStats } from "@/lib/api/defillama";

export const runtime = "nodejs";
// Cached at the framework layer (DefiLlama helper sets revalidate: 600).
export const revalidate = 600;

// Exposes aggregate on-chain DEX market stats (24h volume + protocol count)
// from DefiLlama. Server-side to avoid CORS and to share one cached upstream
// call across all visitors. Degrades to { ok: false } — never to fake data.
export async function GET() {
  const stats = await getDexMarketStats();
  if (!stats) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ...stats });
}
