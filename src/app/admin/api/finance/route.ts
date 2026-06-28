import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { estimateCost } from "@/lib/admin/ai-cost";

export const dynamic = "force-dynamic";

// One-time NFT pass prices (SOL). Mirrors the pricing page.
const TIER_SOL: Record<string, number> = { pro: 1.5, trader: 4, pilot: 30, free: 0 };

async function solUsd(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const j = await res.json() as { solana?: { usd?: number } };
    return j.solana?.usd ?? null;
  } catch { return null; }
}

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const now = Date.now();
  const ago24h = new Date(now - 86_400_000).toISOString();
  const ago7d  = new Date(now - 7 * 86_400_000).toISOString();

  const [{ data: aiRows }, { data: opsRows }, { data: tierRows }, sol] = await Promise.all([
    db.from("platform_events").select("metadata, created_at").eq("event_type", "zion_analysis").gte("created_at", ago7d),
    db.from("operations").select("volume_usd, created_at"),
    db.from("tier_cache").select("tier"),
    solUsd(),
  ]);

  // ── AI cost ──
  const ai = { cost24h: 0, cost7d: 0, calls24h: 0, calls7d: 0, bySource: {} as Record<string, number> };
  for (const r of aiRows ?? []) {
    const m = (r.metadata ?? {}) as Parameters<typeof estimateCost>[0] & { source?: string };
    const c = estimateCost(m);
    const within24h = r.created_at >= ago24h;
    ai.cost7d += c; ai.calls7d++;
    if (within24h) { ai.cost24h += c; ai.calls24h++; }
    const src = m.source ?? "user";
    ai.bySource[src] = (ai.bySource[src] ?? 0) + c;
  }

  // ── Volume ──
  const vol = { v24h: 0, v7d: 0, vAll: 0, count: (opsRows ?? []).length };
  for (const r of opsRows ?? []) {
    const v = Number(r.volume_usd) || 0;
    vol.vAll += v;
    if (r.created_at >= ago7d)  vol.v7d  += v;
    if (r.created_at >= ago24h) vol.v24h += v;
  }

  // ── Tier revenue (attributed estimate — paid passes + admin grants) ──
  const tierCounts: Record<string, number> = {};
  let revenueSol = 0;
  for (const r of tierRows ?? []) {
    tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;
    revenueSol += TIER_SOL[r.tier] ?? 0;
  }

  return NextResponse.json({
    ai,
    volume: vol,
    revenue: { sol: revenueSol, usd: sol ? revenueSol * sol : null, solUsd: sol, tierCounts },
    fetchedAt: new Date().toISOString(),
  });
}
