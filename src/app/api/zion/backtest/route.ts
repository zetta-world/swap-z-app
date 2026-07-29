import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getMarketIndicators } from "@/lib/api/market-indicators";
import { logSuggestions, resolveOpenSuggestions, getBacktestStats, runBacktestScanForProvider, runHybridScan } from "@/lib/zion/backtest";
import { configuredProviders } from "@/lib/ai/registry";
import { setCronHeartbeat } from "@/lib/admin/health";
import { getFlywheelGates } from "@/lib/admin/gates";
import { getCulledSources, runTournamentCull } from "@/lib/zion/cull";
import { runOracleScan } from "@/lib/zion/oracle";
import { runStrategistScan, runStrategistAiScan, runDayScan } from "@/lib/zion/ragnarok";
import { runDexScan } from "@/lib/zion/ragnarok-dex";
import { runUllrScan } from "@/lib/zion/ullr";
import { runRetroSweep } from "@/lib/zion/retro";
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

        // RAGNARÖK (docs/PLANO-RAGNAROK.md): a mesa mecânica long-only escolhe
        // o playbook do momento (range / pullback / reversão) sobre a MESMA
        // fatia de mercado que os scanners veem. Zero token: código puro e
        // determinístico — o controle honesto contra o qual a camada de IA vai
        // ser medida. Roda ANTES dos scanners e com try próprio de propósito:
        // é grátis e não pode ficar refém de uma falha de LLM lá embaixo.
        if (!gates.pause_ragnarok) {
          try { await runStrategistScan(marketData.indicators); } catch { /* best-effort */ }
          // SKAÐI — o MESMO plano com relógio de 8h em vez de 48h. Rodar as
          // duas isola a variável HORIZONTE: se render diferente, o achado é
          // sobre o tempo de exposição, não sobre a estratégia.
          try { await runDayScan(marketData.indicators); } catch { /* best-effort */ }
        }
        // A MESA DE IA (MÍMIR) — mesmo mercado, mesmo tick, ledger separado.
        // Gate próprio porque esta gasta token e a mecânica não: cortar custo
        // não pode calar o controle junto. É desta comparação que sai a resposta
        // à tese do dono — a IA escolhe a estratégia do momento melhor que um
        // bot determinístico?
        if (!gates.pause_ragnarok_ai) {
          try { await runStrategistAiScan(marketData.indicators); } catch { /* best-effort */ }
        }
        // FREYJA — a mesa DEX (S3). Mesmo seletor, praça diferente: agora que
        // o resolver e a carteira sabem precificar por pool (migration 0019),
        // uma sugestão on-chain finalmente preenche e resolve.
        if (!gates.pause_ragnarok_dex) {
          try { await runDexScan(); } catch { /* best-effort */ }
        }
        // ULLR — o arqueiro dos lançamentos. Sem LLM: num pool com horas de
        // vida não existe estrutura pra ler (RSI de 14 períodos, EMA50, suporte
        // testado três vezes — nada disso existe). O que existe é idade,
        // liquidez e fluxo, e isso se lê com regra, não com modelo.
        if (!gates.pause_ullr) {
          try { await runUllrScan(); } catch { /* best-effort */ }
        }

        // A/B: run Claude AND every configured direct provider (DeepSeek / Kimi /
        // Mistral / Llama) on the SAME market data, in parallel, each logged under
        // its own source so expectancy compares head-to-head. Providers with no
        // key are simply absent — stays single-model (Claude) until you add keys.
        // Each stage is individually gate-able from the admin panel.
        const providers = configuredProviders();
        // Tournament cull (alavanca 3): an agent judged on the live round's
        // minimum sample with negative net expectancy stops earning spend.
        const culled = await getCulledSources();
        // Agent A (Claude self_scan) RETIRED 27/07 — measured inside ~1pt of
        // the free brains while being the biggest Anthropic line. Its stage is
        // gone; `pause_agent_a` stays only to keep old runbooks truthful.
        const [hybridCards, ...providerCards] = await Promise.all([
          gates.pause_agent_b || culled.has("hybrid_scan") ? Promise.resolve([]) : runHybridScan(marketData),      // Agent B — Ferrari (hybrid_scan)
          ...providers.map((p) => gates.pause_tournament || culled.has(`${p.id}_scan`) ? Promise.resolve([]) : runBacktestScanForProvider(marketData, p)),
        ]);
        if (hybridCards.length) await logSuggestions(hybridCards, marketData.indicators, "hybrid_scan");
        for (let i = 0; i < providers.length; i++) {
          if (providerCards[i]?.length) await logSuggestions(providerCards[i], marketData.indicators, `${providers[i].id}_scan`);
        }

        // ORÁCULO thesis desk (daily, not per-tick — PLANO-ORACULO-ANALISTA).
        // The admin_kv day-claim makes the 30-min cron behave as a 1×/day
        // trigger and shields against cron-retry double-runs: claim first,
        // then spend.
        if (!gates.pause_oracle) {
          const today = new Date().toISOString().slice(0, 10);
          const db = getSupabaseAdmin();
          if (db) {
            const { data: last } = await db.from("admin_kv").select("value").eq("key", "oracle:last_day").maybeSingle();
            if (last?.value !== today) {
              await db.from("admin_kv").upsert({ key: "oracle:last_day", value: today, updated_at: new Date().toISOString() }, { onConflict: "key" });
              try { await runOracleScan(marketData); } catch { /* best-effort: tomorrow retries */ }
            }
          }
        }
      } catch { /* best-effort: next tick retries */ }
    }
    // Resolve runs regardless of the scan gates — outcomes are independent of
    // the scan, and closing open trades costs nothing.
    try { await resolveOpenSuggestions(); } catch { /* best-effort */ }

    // Cull verdicts AFTER resolution so they judge the freshest ledger. Free
    // (one paginated read), idempotent, and gated by TOURNAMENT_CULL.
    try { await runTournamentCull(); } catch { /* best-effort */ }

    // Auto-Retro AFTER cull: agents that crossed RETRO_EVERY_N decided since
    // their last reflection review their own record (PLANO-ANALISTA-PROFUNDO).
    try { await runRetroSweep(); } catch { /* best-effort */ }

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
