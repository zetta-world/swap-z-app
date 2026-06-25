import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await requireAdmin();

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const now  = new Date();
  const ago24h = new Date(now.getTime() -      86_400_000).toISOString();
  const ago7d  = new Date(now.getTime() -  7 * 86_400_000).toISOString();
  const ago30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const [
    { data: rows24h },
    { data: rows7d },
    { data: rows30d },
    { data: recent },
    { data: topPaths },
  ] = await Promise.all([
    db.from("platform_events").select("event_type").gte("created_at", ago24h),
    db.from("platform_events").select("event_type").gte("created_at", ago7d),
    db.from("platform_events").select("event_type").gte("created_at", ago30d),
    db.from("platform_events")
      .select("event_type, wallet_address, path, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("platform_events")
      .select("path")
      .eq("event_type", "page_view")
      .gte("created_at", ago7d)
      .not("path", "is", null),
  ]);

  function countByType(rows: { event_type: string }[] | null): Record<string, number> {
    const map: Record<string, number> = {};
    for (const r of rows ?? []) map[r.event_type] = (map[r.event_type] ?? 0) + 1;
    return map;
  }

  function countPaths(rows: { path: string | null }[] | null): { path: string; count: number }[] {
    const map: Record<string, number> = {};
    for (const r of rows ?? []) {
      if (r.path) map[r.path] = (map[r.path] ?? 0) + 1;
    }
    return Object.entries(map)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  return NextResponse.json({
    counts: {
      "24h": countByType(rows24h),
      "7d":  countByType(rows7d),
      "30d": countByType(rows30d),
    },
    topPages: countPaths(topPaths),
    recent:   recent ?? [],
    fetchedAt: now.toISOString(),
  });
}
