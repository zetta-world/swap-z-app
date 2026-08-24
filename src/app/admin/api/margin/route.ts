import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readInfraCosts, buildMargin, runwayMonths, INFRA_KEYS, type InfraKey } from "@/lib/admin/margin";
import { estimateCost } from "@/lib/admin/ai-cost";

export const dynamic = "force-dynamic";

/** Preço único do passe (SOL) — espelha a página de preços. Enquanto a receita
 *  for passe vitalício e não assinatura recorrente, MRR fica null de propósito:
 *  transformar venda única em "recorrente" seria inventar receita. */
const TIER_SOL: Record<string, number> = { pro: 1.5, trader: 4, pilot: 30, free: 0 };

/** GET — receita, custo e a subtração entre os dois. */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: aiRows }, { data: subRows }, infra, cashRow] = await Promise.all([
    db.from("platform_events").select("metadata, created_at").eq("event_type", "zion_analysis").gte("created_at", since).limit(100_000),
    db.from("tier_cache").select("tier"),
    readInfraCosts(),
    db.from("admin_kv").select("value").eq("key", "cash_reserve_usd").maybeSingle(),
  ]);
  const cashRaw = cashRow?.data?.value ?? null;

  // Custo de IA dos últimos 30 dias = projeção do mês. Direto: é o gasto real
  // observado numa janela de mês, não uma extrapolação de amostra curta.
  let aiMonthlyUsd = 0;
  for (const r of aiRows ?? []) {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    aiMonthlyUsd += estimateCost({
      model: typeof m.model === "string" ? m.model : undefined,
      inTokens: Number(m.inTokens) || 0,
      outTokens: Number(m.outTokens) || 0,
      cachedTokens: Number(m.cachedTokens) || 0,
      cacheWriteTokens: Number(m.cacheWriteTokens) || 0,
    });
  }
  aiMonthlyUsd = Math.round(aiMonthlyUsd * 100) / 100;

  // Passes vendidos são receita ÚNICA, não recorrente. MRR só existe quando
  // houver plano de assinatura — até lá, null, e a tela diz isso.
  const tierCounts: Record<string, number> = {};
  for (const r of subRows ?? []) tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;
  const mrrUsd: number | null = null;

  const report = buildMargin(mrrUsd, aiMonthlyUsd, infra);
  const cashUsd = cashRaw != null && Number.isFinite(Number(cashRaw)) ? Number(cashRaw) : null;

  return NextResponse.json({
    ...report,
    tierCounts,
    passPrices: TIER_SOL,
    cashUsd,
    runwayMonths: runwayMonths(cashUsd, report.marginUsd ?? -report.totalCostUsd),
    fetchedAt: new Date().toISOString(),
  });
}

/** POST — grava um custo mensal de infra (entrada manual). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null) as { key?: string; usd?: number } | null;
  const allowed: string[] = [...INFRA_KEYS, "cash_reserve_usd"];
  if (!body || !allowed.includes(body.key ?? "")) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }
  const usd = Number(body.usd);
  if (!Number.isFinite(usd) || usd < 0 || usd > 1_000_000) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }

  await db.from("admin_kv").upsert(
    { key: body.key as InfraKey, value: String(usd), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  await logAdminAction(wallet, `margin.set.${body.key}`, undefined, { usd });
  return NextResponse.json({ ok: true, key: body.key, usd });
}
