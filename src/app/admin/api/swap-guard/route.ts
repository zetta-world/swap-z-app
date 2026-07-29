import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { JUPITER_ALLOWED_PROGRAMS } from "@/lib/swap/solana-guard";

export const dynamic = "force-dynamic";

/**
 * Leitura do guard de Solana. Existe pra responder UMA pergunta em segundos:
 * "o guard está recusando swap que devia passar?".
 *
 * O número que importa é a TAXA de recusa, não a contagem. 12 recusas pode ser
 * um ataque isolado (12 de 50.000) ou o guard quebrado (12 de 12) — sem o
 * denominador, o número não diz nada. Por isso o cliente reporta os dois lados.
 */
type Row = {
  metadata: { ok?: boolean; mode?: string; blocked?: boolean; unknownPrograms?: string[]; symbol?: string } | null;
  created_at: string;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const rawHours = Number(req.nextUrl.searchParams.get("hours") ?? "");
  const hours = Number.isFinite(rawHours) && rawHours > 0 && rawHours <= 720 ? rawHours : 24;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const { data } = await db.from("platform_events")
    .select("metadata, created_at")
    .eq("event_type", "swap_guard")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as Row[];
  let passed = 0, refused = 0, blocked = 0;
  const byProgram = new Map<string, { count: number; lastSeen: string; symbols: Set<string> }>();
  let mode = "shadow";

  for (const r of rows) {
    const m = r.metadata;
    if (!m) continue;
    if (typeof m.mode === "string") mode = m.mode; // o mais recente vence
    if (m.ok) { passed++; continue; }
    refused++;
    if (m.blocked) blocked++;
    for (const p of m.unknownPrograms ?? []) {
      const cur = byProgram.get(p) ?? { count: 0, lastSeen: r.created_at, symbols: new Set<string>() };
      cur.count++;
      if (r.created_at > cur.lastSeen) cur.lastSeen = r.created_at;
      if (m.symbol) cur.symbols.add(m.symbol);
      byProgram.set(p, cur);
    }
  }

  const total = passed + refused;
  const refusalRate = total > 0 ? refused / total : null;

  // Um programa desconhecido que aparece MUITO e de forma consistente quase
  // certamente é a Jupiter tendo mudado algo — não um atacante. Atacante não
  // consegue disparar em toda a base de usuários ao mesmo tempo.
  const unknown = [...byProgram.entries()]
    .map(([program, v]) => ({
      program, count: v.count, lastSeen: v.lastSeen,
      symbols: [...v.symbols].slice(0, 6),
      likelyJupiterChange: total > 0 && v.count / total > 0.3,
    }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    mode, hours,
    passed, refused, blocked, total, refusalRate,
    unknown,
    allowedPrograms: JUPITER_ALLOWED_PROGRAMS,
    // Veredito pronto: o painel não deve exigir que alguém faça a conta na hora
    // de um incidente.
    verdict:
      total === 0 ? "sem tráfego Solana nesta janela"
      : refusalRate! > 0.5 ? "⚠ MAIORIA RECUSADA — provável mudança da Jupiter, NÃO ataque. Verifique o programa abaixo e adicione à lista."
      : refusalRate! > 0.05 ? "recusas acima do esperado — investigar"
      : "saudável",
    fetchedAt: new Date().toISOString(),
  });
}
