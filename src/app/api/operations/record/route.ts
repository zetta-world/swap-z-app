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
  /** Real trade timestamp (unix ms) from the client tx-history entry. Drives
   *  created_at so 24h/7d aggregations reflect when the trade actually
   *  happened — NOT when the browser first synced its backlog. */
  ts?:         number;
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

  // Real trade time → created_at. Only trust a sane unix-ms value in the past
  // (no future dates, nothing before 2020); otherwise fall back to the DB
  // default now(). This is what keeps the admin's 24h volume honest.
  const MIN_TS = 1_577_836_800_000; // 2020-01-01
  const tsMs = num(body.ts);
  const createdAt =
    tsMs !== null && tsMs >= MIN_TS && tsMs <= Date.now() + 60_000
      ? new Date(tsMs).toISOString()
      : null;

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
      // Only set when we have a trustworthy trade time; otherwise omit so the
      // DB default now() applies.
      ...(createdAt ? { created_at: createdAt } : {}),
    }, { onConflict: "ref", ignoreDuplicates: true });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "insert_failed" }, { status: 500 });
  }
}
