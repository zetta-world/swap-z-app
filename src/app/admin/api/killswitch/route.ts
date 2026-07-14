import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";

export const dynamic = "force-dynamic";

type SwitchKey =
  | "disable_swap" | "disable_cex" | "maintenance_mode"
  // AI flywheel on/off gates (read by the backtest cron + watchdog via
  // getFlywheelGates). Same admin_kv "true"/"false" convention as the platform
  // kill-switches, so this one route serves both panels.
  | "pause_backtest" | "pause_agent_a" | "pause_agent_b" | "pause_tournament"
  | "pause_paper" | "pause_radar";
const VALID_KEYS: SwitchKey[] = [
  "disable_swap", "disable_cex", "maintenance_mode",
  "pause_backtest", "pause_agent_a", "pause_agent_b", "pause_tournament",
  "pause_paper", "pause_radar",
];

/**
 * Kill-switches stored in a simple key-value table. The app checks these at
 * the route-handler level. If admin_kv doesn't exist yet, the route returns
 * a graceful empty state (all switches OFF) — the migration can be applied
 * separately once feature flags are wired into the main app.
 */

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const { data, error } = await db
    .from("admin_kv")
    .select("key, value")
    .in("key", VALID_KEYS);

  if (error) {
    // Table doesn't exist yet (pre-migration) — return all OFF gracefully
    return NextResponse.json({ switches: {}, note: "admin_kv not yet migrated" });
  }

  const switches: Record<string, boolean> = {};
  for (const k of VALID_KEYS) switches[k] = false;
  for (const row of data ?? []) {
    switches[row.key] = row.value === "true";
  }

  return NextResponse.json({ switches });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const { key, enabled } = body as { key: SwitchKey; enabled: boolean };
  if (!VALID_KEYS.includes(key))
    return NextResponse.json({ error: "invalid key" }, { status: 400 });

  await db.from("admin_kv").upsert(
    { key, value: String(enabled), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  await logAdminAction(actor, `killswitch.${key}`, undefined, { enabled });
  broadcastAdminRefresh("killswitch");
  broadcastAdminRefresh("audit");

  return NextResponse.json({ ok: true, key, enabled });
}
