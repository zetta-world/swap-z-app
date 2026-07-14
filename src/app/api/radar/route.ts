import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getMarketIndicators } from "@/lib/api/market-indicators";
import { detectTriggers } from "@/lib/zion/radar";
import { runBacktestScanForProvider, logSuggestions } from "@/lib/zion/backtest";
import { hybridBrain } from "@/lib/ai/registry";
import { recordEvent } from "@/lib/admin/track";
import { setCronHeartbeat } from "@/lib/admin/health";
import { getFlywheelGates } from "@/lib/admin/gates";
import { runSniperScan } from "@/lib/zion/sniper";
import { runArbiterScan } from "@/lib/zion/arbiter";

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

  const gates = await getFlywheelGates();

  // ARBITER desk — zero-LLM cross-CEX spread detector, every tick (spreads
  // don't wait for a single-venue price trigger). Public data only.
  if (!gates.pause_arbiter) {
    waitUntil(runArbiterScan().then(() => undefined).catch(() => undefined));
  }

  if (triggers.length > 0) {
    recordEvent("radar_trigger", { meta: {
      count:   triggers.length,
      symbols: triggers.map((t) => `${t.symbol} ${t.movePct > 0 ? "+" : ""}${t.movePct}%`),
    } });

    // Wake the trigger-driven policies ONLY on the triggered symbols — in the
    // background so the cron pinger gets an instant reply. Two independent
    // policies ride the SAME trigger (a natural A/B):
    //   · radar   — the original "analyze and log" wake (control group)
    //   · sniper  — budgeted + objectively gated (docs/PLANO-AGENTE-SNIPER.md)
    // Each has its own pause gate; detection + heartbeat above always run, so
    // the watchdog stays quiet when both are paused.
    const radarBrain = gates.pause_radar ? null : hybridBrain();
    const sniperOn = !gates.pause_sniper;
    if (radarBrain || sniperOn) {
      const symbols = triggers.map((t) => t.symbol);
      waitUntil((async () => {
        let marketData;
        try { marketData = await getMarketIndicators(symbols); } catch { return; }
        if (radarBrain) {
          try {
            const cards = await runBacktestScanForProvider(marketData, radarBrain);
            if (cards.length) await logSuggestions(cards, marketData.indicators, "radar");
          } catch { /* best-effort: next trigger retries */ }
        }
        if (sniperOn) {
          try { await runSniperScan(marketData, triggers); } catch { /* best-effort */ }
        }
      })());
    }
  }

  return NextResponse.json({ ok: true, triggers: triggers.length });
}
