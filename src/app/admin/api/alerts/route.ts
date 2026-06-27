import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { alertConfigured } from "@/lib/admin/track";

export const dynamic = "force-dynamic";

/** Alert config status + recent alert history (logged regardless of whether
 *  Telegram is wired up). */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  const recent = db
    ? (await db.from("platform_events").select("metadata, created_at").eq("event_type", "alert").order("created_at", { ascending: false }).limit(40)).data ?? []
    : [];
  return NextResponse.json({ configured: alertConfigured(), recent, fetchedAt: new Date().toISOString() });
}
