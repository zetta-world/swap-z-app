import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = { event_type: string; metadata: Record<string, unknown> | null; created_at: string };

/** Errors + security events for the admin Logs & Security panel — so bugs and
 *  intrusion/abuse attempts are visible without reading server logs. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const ago24h = new Date(Date.now() - 86_400_000).toISOString();

  const [{ data: recent }, { data: rows24h }] = await Promise.all([
    db.from("platform_events")
      .select("event_type, metadata, created_at")
      .in("event_type", ["error", "security"])
      .order("created_at", { ascending: false })
      .limit(60),
    db.from("platform_events")
      .select("event_type, metadata, created_at")
      .in("event_type", ["error", "security"])
      .gte("created_at", ago24h),
  ]);

  let errors24h = 0, security24h = 0, high24h = 0;
  const byKind: Record<string, number> = {};
  for (const r of (rows24h ?? []) as Row[]) {
    if (r.event_type === "error") errors24h++;
    else security24h++;
    const m = r.metadata ?? {};
    if (m.severity === "high") high24h++;
    const kind = String(m.kind ?? m.where ?? r.event_type);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  const topKinds = Object.entries(byKind).map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count).slice(0, 8);

  return NextResponse.json({
    errors24h, security24h, high24h, topKinds,
    recent: (recent ?? []) as Row[],
    fetchedAt: new Date().toISOString(),
  });
}
