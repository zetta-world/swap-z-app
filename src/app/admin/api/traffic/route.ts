import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * MIDGARD traffic aggregation (T4, docs/PLANO-MIDGARD-TRAFEGO.md). Reads the
 * last 180 days of page_view events and aggregates in-process (volume is tiny
 * pre-launch; revisit with SQL group-bys when it isn't):
 *   • daily series (30d): views + unique visitors (cid)
 *   • weekly (12w) and monthly (6m) totals + uniques
 *   • byCountry / byCity(+lat/lon for the map dots) / byPath / byReferrer /
 *     byDevice — all over the last 30d
 * Geo exists only on events recorded after the beacon enrichment shipped;
 * older events count in totals but don't plot.
 */

interface Meta { cid?: string; country?: string; city?: string; lat?: number; lon?: number; device?: string; referrer?: string }

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const since180 = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const { data } = await db
    .from("platform_events")
    .select("created_at, path, metadata")
    .eq("event_type", "page_view")
    .gte("created_at", since180)
    .order("created_at", { ascending: false })
    .limit(50_000);
  const rows = data ?? [];

  const now = Date.now();
  const dayKey   = (t: number) => new Date(t).toISOString().slice(0, 10);
  const monthKey = (t: number) => new Date(t).toISOString().slice(0, 7);
  const weekKey  = (t: number) => {
    const d = new Date(t);
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
  };

  type Agg = { views: number; cids: Set<string> };
  const mk = (): Agg => ({ views: 0, cids: new Set() });
  const daily = new Map<string, Agg>(), weekly = new Map<string, Agg>(), monthly = new Map<string, Agg>();
  const byCountry = new Map<string, Agg>();
  const byCity = new Map<string, { views: number; lat: number; lon: number; country: string }>();
  const byPath = new Map<string, number>(), byRef = new Map<string, number>(), byDevice = new Map<string, Agg>();

  const since30 = now - 30 * 86_400_000;

  for (const r of rows) {
    const t = Date.parse(r.created_at);
    const m = (r.metadata ?? {}) as Meta;
    const cid = m.cid ?? "legacy";

    const bump = (map: Map<string, Agg>, key: string) => {
      const a = map.get(key) ?? mk(); a.views++; a.cids.add(cid); map.set(key, a);
    };
    bump(daily, dayKey(t)); bump(weekly, weekKey(t)); bump(monthly, monthKey(t));

    if (t >= since30) {
      if (m.country) bump(byCountry, m.country);
      if (m.city && typeof m.lat === "number" && typeof m.lon === "number") {
        const k = `${m.city}|${m.country ?? "?"}`;
        const c = byCity.get(k) ?? { views: 0, lat: m.lat, lon: m.lon, country: m.country ?? "?" };
        c.views++; byCity.set(k, c);
      }
      byPath.set(r.path ?? "?", (byPath.get(r.path ?? "?") ?? 0) + 1);
      if (m.referrer) byRef.set(m.referrer, (byRef.get(m.referrer) ?? 0) + 1);
      if (m.device) bump(byDevice, m.device);
    }
  }

  // Dense daily series for the chart (last 30 days incl. zero days).
  const days: Array<{ day: string; views: number; uniques: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const k = dayKey(now - i * 86_400_000);
    const a = daily.get(k);
    days.push({ day: k, views: a?.views ?? 0, uniques: a?.cids.size ?? 0 });
  }
  const ser = (map: Map<string, Agg>, n: number) =>
    [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, n)
      .map(([k, a]) => ({ period: k, views: a.views, uniques: a.cids.size }));

  const top = (map: Map<string, number>, n: number) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, views: v }));

  return NextResponse.json({
    days,
    weeks:  ser(weekly, 12),
    months: ser(monthly, 6),
    totals: {
      today: days[days.length - 1],
      last7:  { views: days.slice(-7).reduce((s, d) => s + d.views, 0) },
      last30: { views: days.reduce((s, d) => s + d.views, 0) },
    },
    byCountry: [...byCountry.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 20)
      .map(([k, a]) => ({ country: k, views: a.views, uniques: a.cids.size })),
    cities: [...byCity.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, 100)
      .map(([k, c]) => ({ city: k.split("|")[0], country: c.country, views: c.views, lat: c.lat, lon: c.lon })),
    byPath: top(byPath, 15),
    byReferrer: top(byRef, 10),
    byDevice: [...byDevice.entries()].map(([k, a]) => ({ device: k, views: a.views })),
    fetchedAt: new Date().toISOString(),
  });
}
