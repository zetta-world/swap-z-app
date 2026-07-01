import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getMarketIndicators } from "@/lib/api/market-indicators";
import { detectTriggers } from "@/lib/zion/radar";
import { runBacktestScanForProvider, logSuggestions } from "@/lib/zion/backtest";
import { hybridBrain } from "@/lib/ai/registry";
import { recordEvent } from "@/lib/admin/track";
import { setCronHeartbeat } from "@/lib/admin/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Price Radar (T3) tick — the cheap, event-driven trigger. Meant to run every
 * ~1 min (cron-job.org). Detects price triggers with ZERO LLM cost, and only
 * when a symbol crosses the threshold does it "wake" the cheap brain to analyze
 * whether to enter — logging the suggestion under source `radar` so its
 * expectancy can be compared to the blind-timer scans (`self_scan` etc.).
 * CRON_SECRET-gated.
 */
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
  await setCronHeartbeat("radar");

  // Detection is cheap (one price fetch + KV) — await it and answer fast.
  let triggers: Awaited<ReturnType<typeof detectTriggers>> = [];
  try { triggers = await detectTriggers(); } catch { /* best-effort */ }

  if (triggers.length > 0) {
    recordEvent("radar_trigger", { meta: {
      count:   triggers.length,
      symbols: triggers.map((t) => `${t.symbol} ${t.movePct > 0 ? "+" : ""}${t.movePct}%`),
    } });

    // Wake the cheap brain ONLY on the triggered symbols — in the background so
    // the cron pinger gets an instant reply. Dormant if no cheap key is set.
    const brain = hybridBrain();
    if (brain) {
      const symbols = triggers.map((t) => t.symbol);
      waitUntil((async () => {
        try {
          const marketData = await getMarketIndicators(symbols);
          const cards = await runBacktestScanForProvider(marketData, brain);
          if (cards.length) await logSuggestions(cards, marketData.indicators, "radar");
        } catch { /* best-effort: next trigger retries */ }
      })());
    }
  }

  return NextResponse.json({ ok: true, triggers: triggers.length });
}
