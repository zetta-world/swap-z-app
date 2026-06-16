import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { isEncryptionConfigured } from "@/lib/crypto/secretbox";
import {
  armSession, disarmSession, getSessionStatus, listRecentRuns,
} from "@/lib/autopilot/sessions";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { SUPPORTED_CEX_IDS, type CexId } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 20 };
const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);
const MAX_TTL_HOURS = 24; // hard ceiling — a session can't run longer unattended

interface ArmBody {
  exchangeId?:        string;
  riskMode?:          string;
  marketType?:        string;
  maxTradeUsd?:       number;
  dailyLossStopUsd?:  number;
  maxTradesPerDay?:   number;
  allowedSymbols?:    string[];
  lang?:              string;
  ttlHours?:          number;
  apiKey?:            string;
  apiSecret?:         string;
  passphrase?:        string;
}

function backendReady(): { ok: boolean; reason?: string } {
  if (!isSupabaseConfigured()) return { ok: false, reason: "supabase_not_configured" };
  if (!isEncryptionConfigured()) return { ok: false, reason: "encryption_key_not_configured" };
  return { ok: true };
}

/** POST — arm (or re-arm) a background autopilot session for the signed-in wallet. */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`autopilot_session:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited", retryAfter: rl.retryAfter }, { status: 429 });
  }

  const ready = backendReady();
  if (!ready.ok) {
    return NextResponse.json({ ok: false, error: ready.reason }, { status: 503 });
  }

  // Background mode REQUIRES a signed-in wallet — we need a stable identity to
  // key the session and to ensure only the wallet owner can arm/disarm it.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  let body: ArmBody;
  try { body = await req.json() as ArmBody; }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const exchangeId = body.exchangeId?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchangeId)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  const riskMode = body.riskMode === "moderado" || body.riskMode === "agressivo" ? body.riskMode : "conservador";
  const marketType = body.marketType === "futures" || body.marketType === "margin" ? body.marketType : "spot";

  const maxTradeUsd = clampNum(body.maxTradeUsd, 2, 10_000, 25);
  const dailyLossStopUsd = clampNum(body.dailyLossStopUsd, 1, 100_000, 20);
  const maxTradesPerDay = Math.round(clampNum(body.maxTradesPerDay, 1, 50, 3));
  const ttlHours = clampNum(body.ttlHours, 1, MAX_TTL_HOURS, MAX_TTL_HOURS);
  const lang = ["pt", "en", "es", "zh"].includes(body.lang ?? "") ? body.lang! : "pt";

  const allowedSymbols = Array.isArray(body.allowedSymbols)
    ? [...new Set(body.allowedSymbols.map((s) => String(s).toUpperCase().trim()).filter(Boolean))].slice(0, 30)
    : [];
  if (allowedSymbols.length === 0) {
    return NextResponse.json({ ok: false, error: "no_allowed_symbols" }, { status: 400 });
  }

  if (typeof body.apiKey !== "string" || body.apiKey.length < 8 || body.apiKey.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid_api_key" }, { status: 400 });
  }
  if (typeof body.apiSecret !== "string" || body.apiSecret.length < 8 || body.apiSecret.length > 600) {
    return NextResponse.json({ ok: false, error: "invalid_api_secret" }, { status: 400 });
  }

  try {
    const id = await armSession({
      walletAddress:    session.sub,
      exchangeId,
      riskMode,
      marketType,
      maxTradeUsd,
      dailyLossStopUsd,
      maxTradesPerDay,
      allowedSymbols,
      lang,
      ttlHours,
      credentials: {
        apiKey:     body.apiKey,
        apiSecret:  body.apiSecret,
        passphrase: body.passphrase,
      },
    });
    return NextResponse.json({
      ok: true, id, exchangeId, marketType, riskMode,
      expiresInHours: ttlHours,
      // Honesty surface for the client: only spot auto-fires in background.
      autoFires: marketType === "spot",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "arm_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** DELETE — disarm the session for ?exchangeId=… */
export async function DELETE(req: NextRequest) {
  const ready = backendReady();
  if (!ready.ok) return NextResponse.json({ ok: false, error: ready.reason }, { status: 503 });

  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  const exchangeId = (req.nextUrl.searchParams.get("exchangeId") || "").toLowerCase() as CexId;
  if (!VALID_EXCHANGES.has(exchangeId)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  await disarmSession(session.sub, exchangeId);
  return NextResponse.json({ ok: true });
}

/** GET — status for ?exchangeId=… plus recent background run log. */
export async function GET(req: NextRequest) {
  const ready = backendReady();
  if (!ready.ok) return NextResponse.json({ ok: false, error: ready.reason }, { status: 503 });

  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  const exchangeId = (req.nextUrl.searchParams.get("exchangeId") || "").toLowerCase() as CexId;
  if (!VALID_EXCHANGES.has(exchangeId)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }

  const [status, runs] = await Promise.all([
    getSessionStatus(session.sub, exchangeId),
    listRecentRuns(session.sub, 30),
  ]);
  return NextResponse.json({ ok: true, status, runs });
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.max(min, Math.min(max, n));
}
