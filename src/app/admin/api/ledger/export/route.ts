import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLS = ["created_at", "wallet_address", "kind", "chain", "pair", "side", "volume_usd", "pnl_usd", "status", "route"] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download the operations ledger as CSV for accounting. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const { data } = await db.from("operations")
    .select(COLS.join(","))
    .order("created_at", { ascending: false })
    .limit(10_000);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const lines = [COLS.join(",")];
  for (const r of rows) lines.push(COLS.map((c) => csvCell(r[c])).join(","));

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="operations-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
