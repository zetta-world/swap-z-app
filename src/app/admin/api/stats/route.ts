import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lerTodasPorChave, type LeituraPaginada } from "@/lib/supabase/paginar";
import {
  comTeto, contagemSegura, deContagem, deLeitura, estadoGeral,
  type Contagem, type OperationalMetric,
} from "@/lib/admin/metrica";

export const dynamic = "force-dynamic";

/** Orçamento por fonte. As tabelas são pequenas, mas a leitura por chave pode dar várias páginas. */
const TETO_MS = 5_000;

/**
 * ⚠️⚠️ R3/P1-15/16 + P2 (Admin CC 2.0): ESTA ROTA ALIMENTA QUATRO PAINÉIS (carteiras, planos,
 * autopilot, sessões CEX) e transformava toda falha em ZERO: `{ count } ?? 0` sem ler `error`, e
 * leituras de linhas SEM paginação — o PostgREST corta em 1.000 (`db-max-rows`), então PNL,
 * volume e a divisão por corretora eram somas de um recorte, rotuladas "all-time".
 *
 * Agora cada número é uma `OperationalMetric`: contagem exata no banco (`count: exact`, sem
 * recorte) ou soma sobre TODAS as linhas (`lerTodasPorChave`). Fonte que falha = `unavailable`
 * com `value: null` — o painel mostra "—" e INDISPONÍVEL, nunca 0. Todas as fontes fora = 503.
 */
export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("analytics.stats.read");

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable", estado: "indisponivel" }, { status: 503 });

  const now = new Date();
  const asOf = now.toISOString();
  const ago7d  = new Date(now.getTime() - 7  * 86_400_000).toISOString();
  const ago30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const contar = async (p: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<Contagem> => {
    const r = await comTeto(() => contagemSegura(p), TETO_MS);
    return r.ok ? r.valor : { count: null, error: { message: r.errorCode } };
  };
  async function ler<T extends Record<string, unknown>>(
    montar: (depoisDe: string | null, limite: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    chave: keyof T & string,
  ): Promise<LeituraPaginada<T>> {
    const r = await comTeto(() => lerTodasPorChave<T>(montar, chave), TETO_MS);
    return r.ok ? r.valor : { linhas: [], erro: r.errorCode, truncado: false, paginas: 0 };
  }

  const [cTotal, c7d, c30d, cSessoes, cAtivas, cRuns, lUsers, lTiers, lSessoes, lRuns] = await Promise.all([
    contar(db.from("users").select("*", { count: "exact", head: true })),
    contar(db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago7d)),
    contar(db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago30d)),
    contar(db.from("autopilot_sessions").select("*", { count: "exact", head: true })),
    contar(db.from("autopilot_sessions").select("*", { count: "exact", head: true }).eq("is_active", true)),
    contar(db.from("autopilot_runs").select("*", { count: "exact", head: true })),
    ler<{ id: string; wallet_chain: string }>((d, n) => {
      let q = db.from("users").select("id, wallet_chain");
      if (d) q = q.gt("id", d);
      return q.order("id", { ascending: true }).limit(n);
    }, "id"),
    ler<{ wallet_address: string; tier: string }>((d, n) => {
      let q = db.from("tier_cache").select("wallet_address, tier");
      if (d) q = q.gt("wallet_address", d);
      return q.order("wallet_address", { ascending: true }).limit(n);
    }, "wallet_address"),
    ler<{ id: string; pnl_today: number | null; exchange_id: string; is_active: boolean }>((d, n) => {
      let q = db.from("autopilot_sessions").select("id, pnl_today, exchange_id, is_active");
      if (d) q = q.gt("id", d);
      return q.order("id", { ascending: true }).limit(n);
    }, "id"),
    ler<{ id: string; notional_usd: number | null }>((d, n) => {
      let q = db.from("autopilot_runs").select("id, notional_usd");
      if (d) q = q.gt("id", d);
      return q.order("id", { ascending: true }).limit(n);
    }, "id"),
  ]);

  const total     = deContagem(cTotal, "users", { asOf });
  const active7d  = deContagem(c7d, "users.last_seen_at≥7d", { asOf });
  const active30d = deContagem(c30d, "users.last_seen_at≥30d", { asOf });
  const chainSplit = deLeitura(lUsers, "users.wallet_chain", (ls) => {
    const m: Record<string, number> = {};
    for (const r of ls) m[r.wallet_chain] = (m[r.wallet_chain] ?? 0) + 1;
    return m;
  }, { asOf });
  // ⚠️ `tier_cache` é declaração de plano (e sem filtro de validade aqui) — qualidade `declared`.
  const distribution = deLeitura(lTiers, "tier_cache", (ls) => {
    const m: Record<string, number> = {};
    for (const r of ls) m[r.tier] = (m[r.tier] ?? 0) + 1;
    return m;
  }, { asOf, quality: "declared" });
  const sessions       = deContagem(cSessoes, "autopilot_sessions", { asOf });
  const sessionsActive = deContagem(cAtivas, "autopilot_sessions.is_active", { asOf });
  const totalRuns      = deContagem(cRuns, "autopilot_runs", { asOf });
  // ⚠️ `|| 0` aqui é SÓ por linha (sessão sem P&L gravado não soma) — a falha da leitura inteira é `unavailable`.
  const pnlToday = deLeitura(lSessoes, "autopilot_sessions.pnl_today",
    (ls) => ls.reduce((s, r) => s + (Number(r.pnl_today) || 0), 0), { asOf });
  const volumeTotal = deLeitura(lRuns, "autopilot_runs.notional_usd",
    (ls) => ls.reduce((s, r) => s + (Number(r.notional_usd) || 0), 0), { asOf });
  const byExchange = deLeitura(lSessoes, "autopilot_sessions.exchange_id", (ls) => {
    const m: Record<string, { total: number; active: number }> = {};
    for (const r of ls) {
      const e = (m[r.exchange_id] ??= { total: 0, active: 0 });
      e.total++;
      if (r.is_active) e.active++;
    }
    return m;
  }, { asOf });

  const todas: OperationalMetric<unknown>[] = [
    total, active7d, active30d, chainSplit, distribution, sessions, sessionsActive, totalRuns, pnlToday, volumeTotal, byExchange,
  ];
  const estado = estadoGeral(todas);
  return NextResponse.json({
    estado,
    wallets:   { total, active7d, active30d, chainSplit },
    tiers:     { distribution },
    autopilot: { sessions, sessionsActive, totalRuns, pnlToday, volumeTotal },
    cex:       { byExchange },
    fetchedAt: asOf,
  }, { status: estado === "indisponivel" ? 503 : 200 });
}
