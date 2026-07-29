import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getCronHeartbeats, pingAiProviders } from "@/lib/admin/health";
import { checkExternalDeps, summarizeDeps } from "@/lib/admin/deps";

export const dynamic = "force-dynamic";

// How stale a cron's heartbeat can get before we flag it (it runs more often;
// the threshold gives slack for GitHub Actions' scheduling jitter).
const STALE_MIN: Record<string, number> = { autopilot: 12, backtest: 75, radar: 5 };

type Ping = { name: string; ok: boolean; latencyMs: number | null; note?: string };

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  const [heartbeats, external, aiProviders] = await Promise.all([
    getCronHeartbeats(),
    // CAMINHO DO DINHEIRO (29/07). Antes aqui só havia pings genéricos — um
    // `/api/v3/ping` da Binance prova que o host responde, não que os candles
    // vêm. E Jupiter, 0x, LiFi e Gate.io não eram checados de forma nenhuma:
    // foi assim que a morte do endpoint da Jupiter passou dias invisível.
    // Agora cada dependência é exercitada com uma chamada REAL e declara o que
    // quebra quando cai (src/lib/admin/deps.ts).
    checkExternalDeps(),
    // Stack de modelos (DeepSeek / Kimi / Mistral / …) — só os com chave.
    pingAiProviders(),
  ]);

  const now = Date.now();
  const crons = Object.entries(STALE_MIN).map(([name, staleMin]) => {
    const last = heartbeats[name] ?? null;
    const ageMin = last ? Math.round((now - Date.parse(last)) / 60_000) : null;
    return { name, last, ageMin, stale: ageMin == null || ageMin > staleMin };
  });

  // Lista achatada — compatibilidade com quem já consumia `deps`.
  const deps: Ping[] = [
    ...external.map((d) => ({ name: d.name, ok: d.ok, latencyMs: d.latencyMs, note: d.note })),
    ...aiProviders,
    { name: "Supabase", ok: !!db, latencyMs: null },
  ];

  const { criticalDown, verdict } = summarizeDeps(external);
  // `ok` reflete o que DERRUBA a plataforma. Um modelo de IA fora ou o índice
  // de sentimento fora não é a mesma coisa que o agregador de swap fora — tratar
  // tudo igual foi o que fez o alarme virar ruído e ninguém olhar.
  const allOk = crons.every((c) => !c.stale) && criticalDown.length === 0;

  return NextResponse.json({
    ok: allOk, crons, deps,
    external,            // com purpose/breaks/impact — é o que o painel mostra
    verdict,
    criticalDown: criticalDown.map((d) => d.name),
    fetchedAt: new Date().toISOString(),
  });
}
