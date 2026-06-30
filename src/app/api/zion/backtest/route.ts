import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getMarketIndicators } from "@/lib/api/market-indicators";
import { logSuggestions, resolveOpenSuggestions, getBacktestStats, runBacktestScan, runBacktestScanKimi } from "@/lib/zion/backtest";
import { setCronHeartbeat } from "@/lib/admin/health";

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
// Scanning all 14 in one LLM call generates too much output to finish inside
// the 60s function budget (it was timing out → 0 cards). Scan a rotating
// window of 6 per tick instead; coverage cycles through every major over a
// few ticks while each run completes in ~15-20s.
const SCAN_WINDOW = 6;
function scanSlice(): string[] {
  const slot  = Math.floor(Date.now() / (30 * 60_000)); // 30-min rotation slots
  const start = (slot * SCAN_WINDOW) % MAJORS.length;
  return Array.from({ length: SCAN_WINDOW }, (_, i) => MAJORS[(start + i) % MAJORS.length]);
}

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
  await setCronHeartbeat("backtest");

  // The heavy work (market indicators + LLM scan + path-replay resolve) takes
  // ~30-45s — longer than external cron pingers wait (cron-job.org caps at
  // 30s and reports a false "timeout"). Respond immediately and finish in the
  // background via waitUntil; the function stays alive up to maxDuration (60s).
  // Results are verified in the DB / Backtest panel, not in this response.
  waitUntil((async () => {
    try {
      const marketData = await getMarketIndicators(scanSlice());
      // A/B: run Claude and (if KIMI_API_KEY is set) Kimi on the SAME market
      // data, in parallel, logged under separate sources so their expectancy
      // can be compared head-to-head. runBacktestScanKimi is a no-op without
      // the key, so this stays single-model until you opt in.
      const [claudeCards, kimiCards] = await Promise.all([
        runBacktestScan(marketData),
        runBacktestScanKimi(marketData),
      ]);
      await logSuggestions(claudeCards, marketData.indicators, "self_scan");
      if (kimiCards.length) await logSuggestions(kimiCards, marketData.indicators, "kimi_scan");
    } catch { /* best-effort: next tick retries */ }
    // Resolve runs regardless — outcomes are independent of the scan.
    try { await resolveOpenSuggestions(); } catch { /* best-effort */ }
  })());

  return NextResponse.json({ ok: true, queued: true });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const stats = await getBacktestStats();
  return NextResponse.json({ ok: true, stats });
}
