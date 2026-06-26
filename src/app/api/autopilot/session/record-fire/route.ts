import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { bumpSessionTrades } from "@/lib/autopilot/sessions";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { SUPPORTED_CEX_IDS, type CexId } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 30 };
const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);

/**
 * POST /api/autopilot/session/record-fire — the in-browser pilot publishes a
 * fire to its background session so the server's trades_today reflects BOTH
 * channels (A1). No-op if the signed-in wallet has no session on that
 * exchange. This does NOT place any order — it only increments the counter.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`autopilot_record_fire:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited", retryAfter: rl.retryAfter }, { status: 429 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  let body: { exchangeId?: string; count?: number };
  try { body = await req.json() as { exchangeId?: string; count?: number }; }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const exchangeId = (body.exchangeId || "").toLowerCase() as CexId;
  if (!VALID_EXCHANGES.has(exchangeId)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  // Clamp the count hard — a single browser fire is 1-3 legs.
  const count = Math.max(1, Math.min(3, Math.round(Number(body.count) || 1)));

  try {
    await bumpSessionTrades(session.sub, exchangeId, count);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "bump_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
