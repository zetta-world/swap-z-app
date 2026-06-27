import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAID = new Set(["pro", "trader", "pilot"]);

/** GROWTH KPIs: active-user cohorts (DAU/WAU/MAU + stickiness) and the
 *  value-ladder funnel (signed up → traded → autopilot → paid). All derived
 *  from existing data — no synthetic metrics. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const now = Date.now();
  const ago1d  = new Date(now -      86_400_000).toISOString();
  const ago7d  = new Date(now -  7 * 86_400_000).toISOString();
  const ago30d = new Date(now - 30 * 86_400_000).toISOString();

  const [
    { count: total },
    { count: dau },
    { count: wau },
    { count: mau },
    { count: new1d },
    { count: new7d },
    { data: opsWallets },
    { data: apWallets },
    { data: tiers },
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago1d),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago7d),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago30d),
    db.from("users").select("*", { count: "exact", head: true }).gte("created_at", ago1d),
    db.from("users").select("*", { count: "exact", head: true }).gte("created_at", ago7d),
    db.from("operations").select("wallet_address").not("wallet_address", "is", null),
    db.from("autopilot_sessions").select("wallet_address"),
    db.from("tier_cache").select("tier"),
  ]);

  const traded    = new Set((opsWallets ?? []).map((r) => r.wallet_address as string)).size;
  const autopilot = new Set((apWallets  ?? []).map((r) => r.wallet_address as string)).size;
  const paid      = (tiers ?? []).filter((t) => PAID.has(t.tier)).length;

  const signedUp = total ?? 0;
  const pct = (n: number, base: number) => (base > 0 ? n / base : null);

  return NextResponse.json({
    active: {
      dau: dau ?? 0, wau: wau ?? 0, mau: mau ?? 0,
      stickiness: (mau ?? 0) > 0 ? (dau ?? 0) / (mau ?? 1) : null,
    },
    signups: { new1d: new1d ?? 0, new7d: new7d ?? 0 },
    funnel: [
      { step: "signed up", count: signedUp, conv: 1 },
      { step: "traded",    count: traded,    conv: pct(traded, signedUp) },
      { step: "autopilot", count: autopilot, conv: pct(autopilot, signedUp) },
      { step: "paid",      count: paid,      conv: pct(paid, signedUp) },
    ],
    fetchedAt: new Date().toISOString(),
  });
}
