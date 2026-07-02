import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { allProviders } from "@/lib/ai/registry";

export const dynamic = "force-dynamic";

/**
 * Circuit-breaker visibility (M4). The breaker (src/lib/ai/circuit.ts) trips
 * silently and only pages Telegram once — this route lets the AI Controls
 * panel SHOW each provider's breaker state and reset one manually after the
 * operator fixes the key / tops up credits (instead of waiting out the
 * cooldown).
 *
 * GET  — every provider (configured or not) with { fails, trippedUntil }.
 * POST — { id } resets that provider's breaker (deletes cb:<id>).
 */

interface CBState { fails: number; trippedUntil: number | null }

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const providers = Object.values(allProviders());
  const keys = providers.map((p) => `cb:${p.id}`);
  const { data } = await db.from("admin_kv").select("key, value").in("key", keys);
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));

  const now = Date.now();
  const breakers = providers.map((p) => {
    let state: CBState = { fails: 0, trippedUntil: null };
    const raw = byKey.get(`cb:${p.id}`);
    if (raw) { try { state = { fails: 0, trippedUntil: null, ...JSON.parse(raw) }; } catch { /* keep default */ } }
    const tripped = state.trippedUntil != null && now < state.trippedUntil;
    return {
      id: p.id, label: p.label, configured: !!p.apiKey,
      fails: state.fails, tripped,
      cooldownEndsAt: tripped ? new Date(state.trippedUntil!).toISOString() : null,
    };
  });

  return NextResponse.json({ breakers, fetchedAt: new Date().toISOString() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null) as { id?: string } | null;
  const id = body?.id;
  if (!id || !allProviders()[id]) return NextResponse.json({ error: "invalid provider id" }, { status: 400 });

  await db.from("admin_kv").delete().eq("key", `cb:${id}`);
  await logAdminAction(actor, "ai_circuit.reset", id);
  return NextResponse.json({ ok: true, id });
}
