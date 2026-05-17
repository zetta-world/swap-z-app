import { NextResponse } from "next/server";
import { getTrending } from "@/lib/api/dexscreener";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET() {
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
