import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { agregarUsoDeIa, type AgregadoIa, type LinhaDeUsoIa } from "@/lib/admin/ai-cost";
import { lerTodasAsPaginas, type LeituraPaginada } from "@/lib/supabase/paginar";
import { comTeto, deLeitura, estadoGeral, indisponivel, type OperationalMetric } from "@/lib/admin/metrica";

export const dynamic = "force-dynamic";

// One-time NFT pass prices (SOL). Mirrors the pricing page.
const TIER_SOL: Record<string, number> = { pro: 1.5, trader: 4, pilot: 30, free: 0 };

/** Teto por fonte: freio de sanidade, e o corte é DECLARADO (`partial`), nunca total. */
const TETO_LINHAS = 100_000;
/** Orçamento de cada fonte. Banco pendurado não pendura a tela inteira. */
const TETO_MS = 8_000;

async function solUsd(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const j = await res.json() as { solana?: { usd?: number } };
    return j.solana?.usd ?? null;
  } catch { return null; }
}

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Leitura paginada com orçamento; estouro/exceção viram `erro`, nunca `[]`. */
async function lerFonte<T>(montar: (de: number, ate: number) => Pagina<T>): Promise<LeituraPaginada<T>> {
  const r = await comTeto(() => lerTodasAsPaginas<T>(montar, { teto: TETO_LINHAS }), TETO_MS);
  return r.ok ? r.valor : { linhas: [], erro: r.errorCode, truncado: false, paginas: 0 };
}

/**
 * Custo de IA, volume e receita atribuída.
 *
 * ⚠️⚠️ ADM-006/007 (Admin CC 2.0, R0-verdade). Esta rota:
 *   · descartava o `{ error }` das três leituras — banco fora = "$0 · 0 ops";
 *   · lia `operations` e `tier_cache` SEM paginar: o `db-max-rows` (1.000) cortava
 *     a soma em silêncio e a tela chamava o pedaço de "all-time";
 *   · somava `NaN` de token ilegível e chamava modelo desconhecido de Sonnet.
 * Agora cada fonte vem com `fontes.<x>` no contrato `OperationalMetric`
 * (`metrica.ts`): `unavailable` sem número, `partial` com cobertura, e a
 * qualidade (`estimated` para IA — tarifa × tokens, NÃO fatura). O bloco
 * correspondente (`ai`/`volume`/`revenue`) vai `null` quando a fonte caiu.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ state: "unavailable", estado: "indisponivel", errorCode: "db_indisponivel", error: "db_unavailable" }, { status: 503 });
  }

  const now = Date.now();
  const asOf = new Date(now).toISOString();
  const ago24h = new Date(now - 86_400_000).toISOString();
  const ago7d  = new Date(now - 7 * 86_400_000).toISOString();

  const [aiL, opsL, tierL, sol] = await Promise.all([
    // leitura-limitada: uso do ZION para a tela de custo. O teto de gasto real
    // é aplicado em `tier/enforce.ts` contra o banco, não a partir daqui.
    lerFonte<LinhaDeUsoIa>((de, ate) => db.from("platform_events").select("metadata, created_at")
      .eq("event_type", "zion_analysis").order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(de, ate) as unknown as Pagina<LinhaDeUsoIa>),
    lerFonte<{ volume_usd: unknown; created_at: string }>((de, ate) => db.from("operations").select("volume_usd, created_at")
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(de, ate) as unknown as Pagina<{ volume_usd: unknown; created_at: string }>),
    lerFonte<{ tier: string }>((de, ate) => db.from("tier_cache").select("tier")
      .order("wallet_address", { ascending: true })
      .range(de, ate) as unknown as Pagina<{ tier: string }>),
    solUsd(),
  ]);

  // ── IA ──
  const aiM: OperationalMetric<AgregadoIa> = deLeitura(aiL, "platform_events/zion_analysis",
    (linhas) => agregarUsoDeIa(linhas, now), { quality: "estimated", asOf });

  // ── Volume ──
  const volM = deLeitura(opsL, "operations", (linhas) => {
    const v = { v24h: 0, v7d: 0, vAll: 0, count: linhas.length, ilegiveis: 0 };
    for (const r of linhas) {
      const n = Number(r.volume_usd);
      if (r.volume_usd != null && !Number.isFinite(n)) { v.ilegiveis++; continue; }
      const x = Number.isFinite(n) ? n : 0;
      v.vAll += x;
      if (r.created_at >= ago7d)  v.v7d  += x;
      if (r.created_at >= ago24h) v.v24h += x;
    }
    return v;
  }, { quality: "measured", asOf });

  // ── Receita atribuída (passes pagos + grants de admin) — DECLARADA pela tabela de tier ──
  const recM = deLeitura(tierL, "tier_cache", (linhas) => {
    const tierCounts: Record<string, number> = {};
    let revenueSol = 0;
    for (const r of linhas) {
      tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;
      revenueSol += TIER_SOL[r.tier] ?? 0;
    }
    return { sol: revenueSol, usd: sol ? revenueSol * sol : null, solUsd: sol, tierCounts };
  }, { quality: "declared", asOf });
  const solM: OperationalMetric<number> = sol == null
    ? indisponivel("coingecko", "measured", "upstream", asOf)
    : { state: "ok", value: sol, quality: "measured", source: "coingecko", asOf };

  const usar = <T,>(m: OperationalMetric<T>): T | null =>
    m.state === "unavailable" || m.state === "error" ? null : m.value;
  const estado = estadoGeral([aiM, volM, recM]);
  const semValor = <T,>(m: OperationalMetric<T>) => ({ ...m, value: undefined });

  return NextResponse.json({
    state: estado === "completo" ? "ok" : estado === "parcial" ? "partial" : "unavailable",
    estado,
    ai: usar(aiM),
    volume: usar(volM),
    revenue: usar(recM),
    // O contrato de cada bloco, sem repetir o valor (que já está acima).
    fontes: { ai: semValor(aiM), volume: semValor(volM), revenue: semValor(recM), solUsd: solM },
    fetchedAt: asOf,
  }, { status: estado === "indisponivel" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
