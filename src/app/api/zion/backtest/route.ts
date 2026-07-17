import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getMarketIndicators } from "@/lib/api/market-indicators";
import { logSuggestions, resolveOpenSuggestions, getBacktestStats, runBacktestScan, runBacktestScanForProvider, runHybridScan } from "@/lib/zion/backtest";
import { configuredProviders } from "@/lib/ai/registry";
import { setCronHeartbeat } from "@/lib/admin/health";
import { getFlywheelGates } from "@/lib/admin/gates";
import { getCulledSources, runTournamentCull } from "@/lib/zion/cull";
import { runPaperAgent } from "@/lib/paper/engine";
import { getSupabaseAdmin } from "@/lib/supabase/server";

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

// Tick idempotency lock (R1.3). cron-job.org reports a false "timeout" at 30s
// and can RETRY the call — without a lock the retry runs the whole scan again
// (double token spend, duplicate suggestions). Lock TTL 3min in admin_kv;
// pinger retries are sequential (~30s apart), so read-then-write is enough —
// this is duplicate suppression, not a distributed mutex. Fails OPEN (no DB =
// run anyway) so the lock can never take the flywheel down.
const TICK_LOCK_MS = 3 * 60_000;
async function acquireTickLock(): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return true;
  const key = "lock:backtest_tick";
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", key).maybeSingle();
    if (data?.value) {
      const last = Date.parse(data.value);
      if (Number.isFinite(last) && Date.now() - last < TICK_LOCK_MS) return false;
    }
    await db.from("admin_kv").upsert(
      { key, value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    return true;
  } catch { return true; }
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
  // Always stamp the heartbeat — even when paused. A deliberate operator pause
  // is NOT a stalled cron, so it must not trip the watchdog's "stalled" alert.
  await setCronHeartbeat("backtest");

  // Operator on/off gates (admin_kv). Read once, honored per-stage below.
  const gates = await getFlywheelGates();

  // Duplicate-tick suppression: a pinger retry within 3min is the SAME tick.
  if (!(await acquireTickLock())) {
    return NextResponse.json({ ok: true, queued: false, skipped: "duplicate_tick" });
  }

  // The heavy work (market indicators + LLM scan + path-replay resolve) takes
  // ~30-45s — longer than external cron pingers wait (cron-job.org caps at
  // 30s and reports a false "timeout"). Respond immediately and finish in the
  // background via waitUntil; the function stays alive up to maxDuration (60s).
  // Results are verified in the DB / Backtest panel, not in this response.
  waitUntil((async () => {
    // Master pause → skip ALL scans (no token spend). Resolution still runs
    // below to close out open trades — it's free and keeps the ledger honest.
    if (!gates.pause_backtest) {
      try {
        const marketData = await getMarketIndicators(scanSlice());
        // A/B: run Claude AND every configured direct provider (DeepSeek / Kimi /
        // Mistral / Llama) on the SAME market data, in parallel, each logged under
        // its own source so expectancy compares head-to-head. Providers with no
        // key are simply absent — stays single-model (Claude) until you add keys.
        // Each stage is individually gate-able from the admin panel.
        const providers = configuredProviders();
        // Tournament cull (alavanca 3): an agent judged on the live round's
        // minimum sample with negative net expectancy stops earning spend.
        const culled = await getCulledSources();
        const [claudeCards, hybridCards, ...providerCards] = await Promise.all([
          gates.pause_agent_a || culled.has("self_scan")   ? Promise.resolve([]) : runBacktestScan(marketData),   // Agent A — Sonnet (self_scan)
          gates.pause_agent_b || culled.has("hybrid_scan") ? Promise.resolve([]) : runHybridScan(marketData),      // Agent B — Ferrari (hybrid_scan)
          ...providers.map((p) => gates.pause_tournament || culled.has(`${p.id}_scan`) ? Promise.resolve([]) : runBacktestScanForProvider(marketData, p)),
        ]);
        if (claudeCards.length) await logSuggestions(claudeCards, marketData.indicators, "self_scan");
        if (hybridCards.length) await logSuggestions(hybridCards, marketData.indicators, "hybrid_scan");
        for (let i = 0; i < providers.length; i++) {
          if (providerCards[i]?.length) await logSuggestions(providerCards[i], marketData.indicators, `${providers[i].id}_scan`);
        }
      } catch { /* best-effort: next tick retries */ }
    }
    // Resolve runs regardless of the scan gates — outcomes are independent of
    // the scan, and closing open trades costs nothing.
    try { await resolveOpenSuggestions(); } catch { /* best-effort */ }

    // Cull verdicts AFTER resolution so they judge the freshest ledger. Free
    // (one paginated read), idempotent, and gated by TOURNAMENT_CULL.
    try { await runTournamentCull(); } catch { /* best-effort */ }

    // Paper-trading agent (Gate.io simulation): executes the flywheel's signals
    // as simulated trades vs the live Gate.io price. Isolated from the real
    // money path, spends no tokens. Gated independently; default OFF until the
    // operator enables `pause_paper=false` in admin_kv.
    if (!gates.pause_paper) { try { await runPaperAgent(); } catch { /* best-effort */ } }
  })());

  return NextResponse.json({ ok: true, queued: true, paused: gates.pause_backtest });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const stats = await getBacktestStats();
  return NextResponse.json({ ok: true, stats });
}
