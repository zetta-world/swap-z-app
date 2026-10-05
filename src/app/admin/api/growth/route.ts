import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lerTodasAsPaginas } from "@/lib/supabase/paginar";

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
    opsWallets,
    apWallets,
    tiers,
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago1d),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago7d),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago30d),
    db.from("users").select("*", { count: "exact", head: true }).gte("created_at", ago1d),
    db.from("users").select("*", { count: "exact", head: true }).gte("created_at", ago7d),
    // ⚠️ PAGINADO (CE-14): eram as primeiras 1.000 linhas (`db-max-rows`).
    lerTodasAsPaginas<{ wallet_address: string }>((de, ate) => db.from("operations").select("id, wallet_address")
      .not("wallet_address", "is", null).order("id", { ascending: true }).range(de, ate)),
    lerTodasAsPaginas<{ wallet_address: string }>((de, ate) => db.from("autopilot_sessions").select("id, wallet_address")
      .order("id", { ascending: true }).range(de, ate)),
    lerTodasAsPaginas<{ tier: string }>((de, ate) => db.from("tier_cache").select("wallet_address, tier")
      .order("wallet_address", { ascending: true }).range(de, ate)),
  ]);

  const traded    = new Set(opsWallets.linhas.map((r) => r.wallet_address)).size;
  const autopilot = new Set(apWallets.linhas.map((r) => r.wallet_address)).size;
  const paid      = tiers.linhas.filter((t) => PAID.has(t.tier)).length;

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
