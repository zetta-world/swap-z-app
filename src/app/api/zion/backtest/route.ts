import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getMarketIndicators } from "@/lib/api/market-indicators";
import { runAutopilotCexScan } from "@/lib/autopilot/scan";
import { logSuggestions, resolveOpenSuggestions, getBacktestStats } from "@/lib/zion/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Shadow Flywheel tick (Z5/Z6). Authenticated with CRON_SECRET.
 *
 * POST — run one ZION scan over the majors, LOG the resulting suggestions with
 *        the market price now, then RESOLVE any open suggestions whose target/
 *        stop was hit or whose horizon elapsed. Driven by a GitHub Actions
 *        schedule (see .github/workflows/zion-backtest-cron.yml).
 * GET  — return aggregate win-rate / expectancy (also CRON_SECRET-gated).
 */

const MAJORS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "UNI", "DOGE", "MATIC", "ADA", "XRP", "DOT"];

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let logged = 0;
  let scanError: string | undefined;
  try {
    const { indicators } = await getMarketIndicators(MAJORS);
    const scan = await runAutopilotCexScan({
      exchangeId:     "binance",
      riskMode:       "moderado",
      marketType:     "spot",
      maxTradeUsd:    100,
      allowedSymbols: MAJORS,
      balanceContext: "",
      lang:           "en",
    });
    if (scan.error) scanError = scan.error;
    else logged = await logSuggestions(scan.cards, indicators, "self_scan");
  } catch (e) {
    scanError = e instanceof Error ? e.message : String(e);
  }

  // Always resolve, even if the scan failed — outcomes are independent.
  let resolved = { checked: 0, resolved: 0 };
  try { resolved = await resolveOpenSuggestions(); } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, logged, resolved, scanError });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const stats = await getBacktestStats();
  return NextResponse.json({ ok: true, stats });
}
