import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generous — the browser may sync a backlog of operations on first load.
const RL_OPTS = { windowMs: 60_000, max: 120 };

interface Body {
  ref?:        string;
  wallet?:     string;
  kind?:       string;
  chain?:      string;
  pair?:       string;
  side?:       string;
  volumeUsd?:  number;
  pnlUsd?:     number;
  status?:     string;
  route?:      string;
}

/**
 * POST /api/operations/record — the browser syncs each completed operation
 * here (idempotent on `ref`). Analytics-grade capture for ZION learning, NOT
 * an execution path: it places nothing, moves nothing. Best-effort.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`ops_record:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let body: Body;
  try { body = await req.json() as Body; }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  if (!body.kind || !body.status) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });

  // Light sanitation — this is analytics, not auth, but keep it bounded.
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  try {
    await db.from("operations").upsert({
      ref:            str(body.ref, 120),
      wallet_address: str(body.wallet, 80),
      kind:           str(body.kind, 40)!,
      chain:          str(body.chain, 40),
      pair:           str(body.pair, 40),
      side:           str(body.side, 8),
      volume_usd:     num(body.volumeUsd),
      pnl_usd:        num(body.pnlUsd),
      status:         str(body.status, 24)!,
      route:          str(body.route, 24),
    }, { onConflict: "ref", ignoreDuplicates: true });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "insert_failed" }, { status: 500 });
  }
}
