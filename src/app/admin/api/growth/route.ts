import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lerTodasPorChave } from "@/lib/supabase/paginar";
import { montarGrowth } from "@/lib/admin/growth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("analytics.growth.read");
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const now = Date.now();
  const ago1d  = new Date(now -      86_400_000).toISOString();
  const ago7d  = new Date(now -  7 * 86_400_000).toISOString();
  const ago30d = new Date(now - 30 * 86_400_000).toISOString();

  const [total, dau, wau, mau, new1d, new7d, operacoes, autopilot, tiers] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago1d),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago7d),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago30d),
    db.from("users").select("*", { count: "exact", head: true }).gte("created_at", ago1d),
    db.from("users").select("*", { count: "exact", head: true }).gte("created_at", ago7d),
    // ⚠️ PAGINADO (CE-14): eram as primeiras 1.000 linhas (`db-max-rows`). RM-12: por CHAVE, não offset.
    lerTodasPorChave<{ id: string; wallet_address: string }>((depois, n) => {
      let q = db.from("operations").select("id, wallet_address").not("wallet_address", "is", null);
      if (depois) q = q.gt("id", depois);
      return q.order("id", { ascending: true }).limit(n);
    }, "id"),
    lerTodasPorChave<{ id: string; wallet_address: string }>((depois, n) => {
      let q = db.from("autopilot_sessions").select("id, wallet_address");
      if (depois) q = q.gt("id", depois);
      return q.order("id", { ascending: true }).limit(n);
    }, "id"),
    lerTodasPorChave<{ wallet_address: string; tier: string }>((depois, n) => {
      let q = db.from("tier_cache").select("wallet_address, tier");
      if (depois) q = q.gt("wallet_address", depois);
      return q.order("wallet_address", { ascending: true }).limit(n);
    }, "wallet_address"),
  ]);

  /**
   * ⚠️⚠️ RM-07: ERRO OU CORTE NÃO VIRA ZERO. Antes: `count ?? 0` e só `.linhas`
   * (vazio quando a leitura falha) — uma queda do banco aparecia como
   * "traded 0 · paid 0". `montarGrowth` devolve `null` + `estado` + o motivo.
   */
  const g = montarGrowth({ total, dau, wau, mau, new1d, new7d, operacoes, autopilot, tiers });
  // Nenhuma métrica medida: não há painel a mostrar — 503 com o motivo, não um quadro de zeros.
  const status = g.estado === "indisponivel" ? 503 : 200;

  return NextResponse.json({
    ...g,
    ...(g.estado === "indisponivel" ? { error: "growth_indisponivel" } : {}),
    fetchedAt: new Date().toISOString(),
  }, { status });
}
