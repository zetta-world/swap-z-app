import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { FLYWHEEL_GATE_KEYS } from "@/lib/admin/gates";

export const dynamic = "force-dynamic";

const PLATFORM_KEYS = ["disable_swap", "disable_cex", "maintenance_mode"] as const;

/**
 * Chaves aceitas = kill-switches da plataforma + TODOS os gates do flywheel,
 * derivados de `FLYWHEEL_GATE_KEYS`.
 *
 * Antes esta lista era digitada à mão e já tinha ficado para trás: `pause_oracle`
 * e `pause_arbiter2` existiam no cron mas NÃO eram desligáveis pelo painel — uma
 * mesa que só se apaga por deploy não tem kill-switch de verdade. Derivar da
 * fonte única faz uma mesa nova nascer controlável, sem ninguém lembrar de
 * atualizar dois arquivos.
 */
const VALID_KEYS: string[] = [...PLATFORM_KEYS, ...FLYWHEEL_GATE_KEYS];
type SwitchKey = string;

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
