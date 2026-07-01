import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getCronHeartbeats, pingAnthropic, pingAiProviders } from "@/lib/admin/health";

export const dynamic = "force-dynamic";

// How stale a cron's heartbeat can get before we flag it (it runs more often;
// the threshold gives slack for GitHub Actions' scheduling jitter).
const STALE_MIN: Record<string, number> = { autopilot: 12, backtest: 75, radar: 5 };

type Ping = { name: string; ok: boolean; latencyMs: number | null; note?: string };

async function ping(name: string, url: string): Promise<Ping> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return { name, ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { name, ok: false, latencyMs: null };
  } finally {
    clearTimeout(t);
  }
}

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  const [heartbeats, pings, anthropic, aiProviders] = await Promise.all([
    getCronHeartbeats(),
    Promise.all([
      // data-api.binance.vision is Binance's public market-data mirror; unlike
      // api.binance.com it is NOT geo-blocked from US serverless IPs (Vercel
      // iad1/sfo1), so this reflects real Binance reachability instead of a
      // permanent 451 false-positive.
      ping("Binance",       "https://data-api.binance.vision/api/v3/ping"),
      ping("CoinGecko",     "https://api.coingecko.com/api/v3/ping"),
      ping("GeckoTerminal", "https://api.geckoterminal.com/api/v2/networks?page=1"),
    ]),
    // Real /v1/models check (zero inference cost) — replaces the old
    // "had an analysis in 2h" proxy that went falsely DOWN between cron runs.
    pingAnthropic(),
    // The Ferrari's whole model stack (DeepSeek / Kimi / Mistral / Grok / …) —
    // only the providers with a key configured are pinged.
    pingAiProviders(),
  ]);

  const now = Date.now();
  const crons = Object.entries(STALE_MIN).map(([name, staleMin]) => {
    const last = heartbeats[name] ?? null;
    const ageMin = last ? Math.round((now - Date.parse(last)) / 60_000) : null;
    return { name, last, ageMin, stale: ageMin == null || ageMin > staleMin };
  });

  const deps: Ping[] = [
    ...pings,
    ...aiProviders,
    { name: "Supabase",  ok: !!db,            latencyMs: null },
    { name: "Anthropic", ok: anthropic.ok,    latencyMs: anthropic.latencyMs, note: anthropic.note },
  ];

  const allOk = crons.every((c) => !c.stale) && deps.every((d) => d.ok);
  return NextResponse.json({ ok: allOk, crons, deps, fetchedAt: new Date().toISOString() });
}
