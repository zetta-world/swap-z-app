import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lerBatimentos } from "@/lib/admin/health";
import { lerTodasPorChave } from "@/lib/supabase/paginar";
import { agregarUsoDeIa } from "@/lib/admin/ai-cost";
import { utcDayKey } from "@/lib/autopilot/sessions";

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
  // POR CHAVE (revisão adversarial): por offset com a mais nova primeiro, linha gravada
  // durante a leitura deslocava as páginas e a de fronteira era somada duas vezes.
  const paginado = async <T extends { id: string }>(nome: string, montar: (depois: string | null, n: number) => Pagina<T>): Promise<T[] | null> => {
    const l = await lerTodasPorChave<T & Record<string, unknown>>(
      montar as (depois: string | null, n: number) => Pagina<T & Record<string, unknown>>, "id", { teto: 100_000 },
    ).catch(() => null);
    if (!l || l.erro) { falhas.push(nome); return null; }
    if (l.truncado) falhas.push(`${nome}:truncado`);
    return l.linhas;
  };

  const [
    usersR, active24hR, ops, aiR, apActiveR, apSessR, positionsR, winsR, lossesR, securityR, batimentos,
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago24h),
    paginado<{ id: string; volume_usd: unknown; pnl_usd: unknown; created_at: string }>("operations", (depois, n) => {
      let q = db.from("operations").select("id, volume_usd, pnl_usd, created_at");
      if (depois != null) q = q.gt("id", depois);
      return q.order("id", { ascending: true }).limit(n) as unknown as Pagina<{ id: string; volume_usd: unknown; pnl_usd: unknown; created_at: string }>;
    }),
    // Custo de IA 24h PAGINADO (o recorte de 1.000 subestimava em silêncio) e
    // agregado pela MESMA conta do /finance (`agregarUsoDeIa`: cache fora, token
    // ilegível não vira NaN). Paginada por chave: `paginado` → lerTodasPorChave.
    paginado<{ id: string; metadata: unknown; created_at: string }>("zion_analysis_24h", (depois, n) => {
      let q = db.from("platform_events").select("id, metadata, created_at").eq("event_type", "zion_analysis").gte("created_at", ago24h);
      if (depois != null) q = q.gt("id", depois);
      return q.order("id", { ascending: true }).limit(n) as unknown as Pagina<{ id: string; metadata: unknown; created_at: string }>;
    }),
    db.from("autopilot_sessions").select("*", { count: "exact", head: true }).eq("is_active", true),
    // leitura-limitada: sessões do autopilot — dezenas, não milhares.
    db.from("autopilot_sessions").select("pnl_today, last_reset_day"),
    // leitura-limitada: posições abertas — dezenas, não milhares.
    db.from("autopilot_positions").select("cost_usd").neq("status", "closed"),
    /**
     * ⚠️ WIN-RATE CONTADO NO BANCO (revisão adversarial): a leitura de linhas sem
     * `range` cortava em 1.000 — e o ledger vivo já passou disso (o watchdog
     * pagina esta mesma consulta). "N decididas" travava em ≤1.000 com estado ok.
     */
    db.from("zion_suggestions").select("*", { count: "exact", head: true })
      .is("archived_at", null).in("status", ["win", "hit_target"]),
    db.from("zion_suggestions").select("*", { count: "exact", head: true })
      .is("archived_at", null).in("status", ["loss", "hit_stop"]),
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
  const winsC = conferir("zion_suggestions_wins", winsR);
  const lossesC = conferir("zion_suggestions_losses", lossesR);
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
  // ⚠️ Só sessões que JÁ viraram o dia (revisão adversarial): `pnl_today` só zera
  // quando o cron processa a sessão; uma desativada ontem com -$40 somava -$40 hoje.
  // Mesma regra da 0064 (`last_reset_day <> hoje` = base zero).
  const hoje = utcDayKey(new Date(now));
  if (apSess) {
    apPnlToday = 0;
    for (const x of (apSess.data ?? []) as Array<{ pnl_today: unknown; last_reset_day: string | null }>) {
      if (x.last_reset_day === hoje) apPnlToday += Number(x.pnl_today) || 0;
    }
  }
  let exposure: number | null = null;
  const posLinhas = positions ? (positions.data ?? []) as Array<{ cost_usd: unknown }> : null;
  if (posLinhas) { exposure = 0; for (const p of posLinhas) exposure += Number(p.cost_usd) || 0; }

  const wins = winsC?.count, losses = lossesC?.count;
  const decididas = typeof wins === "number" && typeof losses === "number" ? wins + losses : null;
  if ((winsC || lossesC) && decididas == null) falhas.push("zion_suggestions:sem_contagem");
  const winRate = decididas != null && decididas > 0 ? wins! / decididas : null;

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
    backtest: { winRate, decided: decididas },
    alerts: { highSecurity24h: highSec24h, staleCrons },
    fetchedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
