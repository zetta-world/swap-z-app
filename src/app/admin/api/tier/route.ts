import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Tier } from "@/lib/tier/types";

export const dynamic = "force-dynamic";

const VALID_TIERS: Tier[] = ["free", "pro", "trader", "pilot"];

/** GET /admin/api/tier?wallet=0x... — inspect tier for a wallet */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const target = req.nextUrl.searchParams.get("wallet");
  if (!target) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  const { data } = await db
    .from("tier_cache")
    .select("tier, source, checked_at, expires_at")
    .eq("wallet_address", target)
    .maybeSingle();

  const { data: user } = await db
    .from("users")
    .select("wallet_chain, created_at, last_seen_at")
    .eq("wallet_address", target)
    .maybeSingle();

  return NextResponse.json({ wallet: target, tierCache: data, user });
}

/** POST /admin/api/tier — grant or revoke a tier */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const { wallet: target, tier, action } = body as {
    wallet: string;
    tier:   Tier;
    action: "grant" | "revoke";
  };

  if (!target || typeof target !== "string")
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  if (!VALID_TIERS.includes(tier))
    return NextResponse.json({ error: "invalid tier" }, { status: 400 });
  if (action !== "grant" && action !== "revoke")
    return NextResponse.json({ error: "action must be grant or revoke" }, { status: 400 });

  if (action === "grant") {
    const farFuture = new Date(Date.now() + 100 * 365 * 86_400_000).toISOString();
    await db.from("tier_cache").upsert(
      {
        wallet_address: target,
        tier,
        source:     "admin",
        checked_at: new Date().toISOString(),
        expires_at: farFuture,
      },
      { onConflict: "wallet_address" },
    );
  } else {
    await db.from("tier_cache").delete().eq("wallet_address", target);
  }

  await logAdminAction(actor, `tier.${action}`, target, { tier });

  return NextResponse.json({ ok: true, action, target, tier });
}
