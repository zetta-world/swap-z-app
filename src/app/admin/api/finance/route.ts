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
    // All AI events — we bucket day/week/month/year/all in JS so the panel can
    // map spend over time. Tiny payload (metadata + ts) at current volume.
    db.from("platform_events").select("metadata, created_at").eq("event_type", "zion_analysis").limit(100_000),
    db.from("operations").select("volume_usd, created_at"),
    db.from("tier_cache").select("tier"),
    solUsd(),
  ]);

  // ── AI spend, mapped over time (UTC calendar boundaries) ──
  const d0 = new Date(now);
  const Y = d0.getUTCFullYear(), Mo = d0.getUTCMonth(), Da = d0.getUTCDate();
  const startOfDay   = Date.UTC(Y, Mo, Da);
  const startOfMonth = Date.UTC(Y, Mo, 1);
  const startOfYear  = Date.UTC(Y, 0, 1);
  const weekAgo      = now - 7 * 86_400_000;
  const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD UTC

  // 14-day trend, pre-seeded to 0 so gaps render as empty bars.
  const dailyMap = new Map<string, number>();
  for (let i = 13; i >= 0; i--) dailyMap.set(dayKey(now - i * 86_400_000), 0);

  // Per-model spend across the same time windows — the unified cost view so
  // you never have to open each provider's dashboard. One row per model.
  type ModelAgg = { model: string; today: number; week: number; month: number; all: number; calls: number };
  const modelAgg = new Map<string, ModelAgg>();
  const bumpModel = (model: string, c: number, ts: number) => {
    const a = modelAgg.get(model) ?? { model, today: 0, week: 0, month: 0, all: 0, calls: 0 };
    a.all += c; a.calls++;
    if (ts >= startOfMonth) a.month += c;
    if (ts >= weekAgo)      a.week  += c;
    if (ts >= startOfDay)   a.today += c;
    modelAgg.set(model, a);
  };

  const ai = {
    today: 0, week: 0, month: 0, year: 0, all: 0,
    calls: { today: 0, week: 0, month: 0, year: 0, all: 0 },
    byModel:  {} as Record<string, number>,
    bySource: {} as Record<string, number>,
    models:   [] as ModelAgg[],
    tokens:   { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    daily:    [] as Array<{ date: string; cost: number }>,
    monthProjection: 0,
  };

  for (const r of aiRows ?? []) {
    const m = (r.metadata ?? {}) as Parameters<typeof estimateCost>[0] & { source?: string };
    const c = estimateCost(m);
    const ts = Date.parse(r.created_at);
    ai.all += c; ai.calls.all++;
    if (ts >= startOfYear)  { ai.year  += c; ai.calls.year++; }
    if (ts >= startOfMonth) { ai.month += c; ai.calls.month++; }
    if (ts >= weekAgo)      { ai.week  += c; ai.calls.week++; }
    if (ts >= startOfDay)   { ai.today += c; ai.calls.today++; }
    bumpModel(m.model ?? "unknown", c, ts);
    ai.byModel[m.model ?? "unknown"] = (ai.byModel[m.model ?? "unknown"] ?? 0) + c;
    ai.bySource[m.source ?? "user"]  = (ai.bySource[m.source ?? "user"] ?? 0) + c;
    ai.tokens.input     += m.inTokens ?? 0;
    ai.tokens.output    += m.outTokens ?? 0;
    ai.tokens.cacheRead += m.cachedTokens ?? 0;
    ai.tokens.cacheWrite+= m.cacheWriteTokens ?? 0;
    const k = dayKey(ts);
    if (dailyMap.has(k)) dailyMap.set(k, (dailyMap.get(k) ?? 0) + c);
  }
  ai.daily = [...dailyMap.entries()].map(([date, cost]) => ({ date, cost }));
  ai.models = [...modelAgg.values()].sort((a, b) => b.all - a.all);
  // Run-rate projection for the current calendar month.
  const daysInMonth = new Date(Date.UTC(Y, Mo + 1, 0)).getUTCDate();
  ai.monthProjection = (ai.month / Da) * daysInMonth;

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
