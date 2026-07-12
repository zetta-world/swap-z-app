import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction, envAdminWallets } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { logSecurity } from "@/lib/admin/track";

export const dynamic = "force-dynamic";

/**
 * ADMIN ACCESS control. GET → who currently has admin (env / panel / legacy).
 * POST → grant or revoke panel-managed admin access, decoupled from tiers.
 * Guards: never revoke yourself, never revoke an env admin (edit ADMIN_WALLETS),
 * never leave the platform with zero admins. Every change is audited.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const [{ data: panel }, { data: legacy }] = await Promise.all([
    db.from("platform_admins").select("wallet_address, granted_by, note, granted_at").order("granted_at", { ascending: true }),
    db.from("tier_cache").select("wallet_address, tier").eq("source", "admin"),
  ]);

  const byWallet = new Map<string, { wallet: string; source: "env" | "panel" | "legacy"; revocable: boolean; grantedBy?: string | null; grantedAt?: string | null; note?: string | null }>();
  for (const w of envAdminWallets()) byWallet.set(w, { wallet: w, source: "env", revocable: false });
  for (const r of legacy ?? []) if (!byWallet.has(r.wallet_address)) byWallet.set(r.wallet_address, { wallet: r.wallet_address, source: "legacy", revocable: true });
  for (const r of panel ?? []) byWallet.set(r.wallet_address, { wallet: r.wallet_address, source: "panel", revocable: true, grantedBy: r.granted_by, grantedAt: r.granted_at, note: r.note });

  return NextResponse.json({ admins: [...byWallet.values()], fetchedAt: new Date().toISOString() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const target = typeof body?.wallet === "string" ? body.wallet.trim() : "";
  const action = body?.action;
  const note   = typeof body?.note === "string" ? body.note.slice(0, 120) : null;

  if (!target || target.length < 20 || target.length > 80)
    return NextResponse.json({ error: "wallet inválida" }, { status: 400 });
  if (action !== "grant" && action !== "revoke")
    return NextResponse.json({ error: "action deve ser grant ou revoke" }, { status: 400 });

  if (action === "grant") {
    await db.from("platform_admins").upsert(
      { wallet_address: target, granted_by: actor, note, granted_at: new Date().toISOString() },
      { onConflict: "wallet_address" },
    );
    await logAdminAction(actor, "admin.grant", target, { note });
    logSecurity("admin_granted", { by: `${actor.slice(0, 10)}…`, to: `${target.slice(0, 10)}…` }, "high");
  } else {
    // ── revoke guards ──
    if (target === actor)
      return NextResponse.json({ error: "você não pode revogar a si mesmo" }, { status: 400 });
    if (envAdminWallets().includes(target.toLowerCase()))
      return NextResponse.json({ error: "admin de ambiente — edite ADMIN_WALLETS no Vercel" }, { status: 400 });

    // Never leave zero admins: count what remains AFTER this revoke.
    const [{ data: panel }, { data: legacy }] = await Promise.all([
      db.from("platform_admins").select("wallet_address"),
      db.from("tier_cache").select("wallet_address").eq("source", "admin"),
    ]);
    const remaining = new Set<string>([
      ...envAdminWallets(),
      ...(panel ?? []).map((r) => r.wallet_address),
      ...(legacy ?? []).map((r) => r.wallet_address),
    ]);
    remaining.delete(target);
    if (remaining.size === 0)
      return NextResponse.json({ error: "esse é o último admin — não dá pra revogar" }, { status: 400 });

    // Kill both mechanisms so access is actually gone.
    await db.from("platform_admins").delete().eq("wallet_address", target);
    await db.from("tier_cache").delete().eq("wallet_address", target).eq("source", "admin");
    await logAdminAction(actor, "admin.revoke", target);
    logSecurity("admin_revoked", { by: `${actor.slice(0, 10)}…`, to: `${target.slice(0, 10)}…` }, "high");
  }

  broadcastAdminRefresh("audit");
  return NextResponse.json({ ok: true, action, target });
}
