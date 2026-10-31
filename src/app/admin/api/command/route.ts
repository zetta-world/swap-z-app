import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lerBatimentos } from "@/lib/admin/health";
import { lerTodasAsPaginas } from "@/lib/supabase/paginar";
import { agregarUsoDeIa, type LinhaDeUsoIa } from "@/lib/admin/ai-cost";

export const dynamic = "force-dynamic";

const CRON_STALE_MIN: Record<string, number> = { autopilot: 12, backtest: 75 };

/** Consolidated top-line KPIs for the COMMAND overview — one screen pulling
 *  from every workspace. */
export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("exec.summary.read");
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ state: "unavailable", errorCode: "db_indisponivel", error: "db_unavailable" }, { status: 503 });

  const now = Date.now();
  const ago24h = new Date(now - 86_400_000).toISOString();

  /**
   * ⚠️⚠️ "ALL CLEAR" COM O BANCO FORA (Admin CC 2.0, R0-verdade). Cada uma das
   * dez leituras descartava o `{ error }` e virava `?? 0`/`[]`: banco caído =
   * "0 users · $0 · 0 high-sev · ALL CLEAR". Agora toda fonte que falha entra
   * em `falhas`, o KPI dela vai `null` (tela: "—"), e o painel não declara
   * nada limpo enquanto `falhas` não estiver vazio.
   */
  const falhas: string[] = [];
  type R<T> = { data?: T | null; count?: number | null; error: { message: string } | null };
  const conferir = <T,>(nome: string, r: R<T>): R<T> | null => {
    if (r.error) { falhas.push(nome); return null; }
    return r;
  };
  type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  const paginado = async <T,>(nome: string, montar: (de: number, ate: number) => Pagina<T>): Promise<T[] | null> => {
    const l = await lerTodasAsPaginas<T>(montar, { teto: 100_000 }).catch(() => null);
    if (!l || l.erro) { falhas.push(nome); return null; }
    if (l.truncado) falhas.push(`${nome}:truncado`);
    return l.linhas;
  };

  const [
    usersR, active24hR, ops, aiR, apActiveR, apSessR, positionsR, suggestionsR, securityR, batimentos,
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago24h),
    paginado<{ volume_usd: unknown; pnl_usd: unknown; created_at: string }>("operations", (de, ate) =>
      db.from("operations").select("volume_usd, pnl_usd, created_at")
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(de, ate) as unknown as Pagina<{ volume_usd: unknown; pnl_usd: unknown; created_at: string }>),
    // Custo de IA 24h PAGINADO (o recorte de 1.000 subestimava em silêncio) e
    // agregado pela MESMA conta do /finance (`agregarUsoDeIa`: cache fora, token
    // ilegível não vira NaN).
    paginado<LinhaDeUsoIa>("zion_analysis_24h", (de, ate) =>
      db.from("platform_events").select("metadata, created_at").eq("event_type", "zion_analysis").gte("created_at", ago24h)
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(de, ate) as unknown as Pagina<LinhaDeUsoIa>),
    db.from("autopilot_sessions").select("*", { count: "exact", head: true }).eq("is_active", true),
    // leitura-limitada: sessões do autopilot — dezenas, não milhares.
    db.from("autopilot_sessions").select("pnl_today"),
    // leitura-limitada: posições abertas — dezenas, não milhares.
    db.from("autopilot_positions").select("cost_usd").neq("status", "closed"),
    // leitura-limitada: contadores do painel de comando. São indicadores de
    // pulso, não a base de nenhuma decisão automática.
    db.from("zion_suggestions").select("status").is("archived_at", null),
    /**
     * ⚠️ CONTAGEM NO BANCO, NÃO NA AMOSTRA (revisão adversarial). A leitura antiga
     * trazia 1.000 eventos ARBITRÁRIOS: um flood de eventos `low` (ex.: spam no
     * early access) empurrava os `high` para fora da amostra → "0 high-sev · ALL
     * CLEAR". `count: exact` com o filtro de severidade não tem recorte.
     */
    db.from("platform_events").select("*", { count: "exact", head: true })
      .eq("event_type", "security").eq("metadata->>severity", "high").gte("created_at", ago24h),
    lerBatimentos(),
  ]);

  const users = conferir("users", usersR);
  const active24h = conferir("users_24h", active24hR);
  const ai = aiR;
  const apActive = conferir("autopilot_sessions_ativas", apActiveR);
  const apSess = conferir("autopilot_sessions", apSessR);
  const positions = conferir("autopilot_positions", positionsR);
  const suggestions = conferir("zion_suggestions", suggestionsR);
  const security = conferir("security_24h", securityR);
  if (!batimentos.lido) falhas.push("cron_heartbeats");

  let vol24h: number | null = null, pnlAll: number | null = null;
  if (ops) {
    vol24h = 0; pnlAll = 0;
    for (const o of ops) { pnlAll += Number(o.pnl_usd) || 0; if (o.created_at >= ago24h) vol24h += Number(o.volume_usd) || 0; }
  }

  // Todas as linhas já são das últimas 24h: o total (`all`) do agregado É o custo de 24h.
  const aiCost24h: number | null = ai ? agregarUsoDeIa(ai, now).all : null;

  let apPnlToday: number | null = null;
  if (apSess) { apPnlToday = 0; for (const x of (apSess.data ?? []) as Array<{ pnl_today: unknown }>) apPnlToday += Number(x.pnl_today) || 0; }
  let exposure: number | null = null;
  const posLinhas = positions ? (positions.data ?? []) as Array<{ cost_usd: unknown }> : null;
  if (posLinhas) { exposure = 0; for (const p of posLinhas) exposure += Number(p.cost_usd) || 0; }

  let wins = 0, losses = 0;
  for (const x of (suggestions?.data ?? []) as Array<{ status: string }>) {
    if (x.status === "win" || x.status === "hit_target") wins++;
    else if (x.status === "loss" || x.status === "hit_stop") losses++;
  }
  const winRate = suggestions && wins + losses > 0 ? wins / (wins + losses) : null;

  const highSec24h: number | null = security ? (security.count ?? null) : null;
  if (security && security.count == null) falhas.push("security_24h:sem_contagem");

  // Batimento ilegível: NÃO declaro cron nenhum "parado" (seria inventar) — vai em `falhas`.
  const staleCrons = !batimentos.lido ? [] : Object.entries(CRON_STALE_MIN).filter(([name, mins]) => {
    const last = batimentos.batimentos[name];
    if (!last) return true;
    const t = Date.parse(last);
    // Batimento ilegível NÃO é "fresco" (`NaN > mins` dava false): conta como parado.
    return !Number.isFinite(t) || (now - t) / 60_000 > mins;
  }).map(([name]) => name);

  return NextResponse.json({
    state: falhas.length === 0 ? "ok" : "partial",
    falhas,
    users: users?.count ?? null,
    active24h: active24h?.count ?? null,
    volume24h: vol24h,
    pnlAll,
    aiCost24h,
    autopilot: { activeSessions: apActive?.count ?? null, pnlToday: apPnlToday, openPositions: posLinhas ? posLinhas.length : null, exposure },
    backtest: { winRate, decided: suggestions ? wins + losses : null },
    alerts: { highSecurity24h: highSec24h, staleCrons },
    fetchedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
