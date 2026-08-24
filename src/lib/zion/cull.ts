/**
 * Tournament cull — alavanca 3 of docs/PLANO-LUCRATIVIDADE.md.
 *
 * The tournament is a cut factory, not a museum: once an agent closes the
 * minimum sample IN THE LIVE ROUND with NEGATIVE net expectancy, it stops
 * earning token spend — the cron skips its scan from the next tick on. The
 * best net-positive agent (same sample bar) is marked champion, and the paper
 * engine concentrates capital on it (PAPER_CHAMPION_MULT sizing).
 *
 * Honest-flywheel rules apply: NET of cost, decided = target/stop only
 * (expired is neither), minimum sample before any verdict, and the whole
 * check reads ONLY the live round (archived_at IS NULL) — an archived round
 * can never cull a reformed agent.
 *
 * A cull is a standing admin_kv flag (`culled:<source>`), so the operator can
 * lift it from the panel / SQL by deleting the key or setting "false" — and a
 * round archive (which resets the measurement) is the natural amnesty point.
 * TOURNAMENT_CULL=off disables the automatic verdicts entirely.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { recordEvent } from "@/lib/admin/track";
import { CUSTO_IDA_E_VOLTA_PCT } from "@/lib/zion/custo";

const CULL_ON    = (process.env.TOURNAMENT_CULL ?? "on") !== "off";
const MIN_SAMPLE = Number(process.env.BACKTEST_MIN_SAMPLE ?? 100);
// ⚠️ IDA E VOLTA: o veredito de corte fala de trades que abriram E fecharam.
// Cobrando meia taxa, mesa perdedora passava por empatada e escapava do
// machado — o corte errava para o lado de manter quem custa dinheiro.
const COST_PCT   = CUSTO_IDA_E_VOLTA_PCT;

/** Scan agents subject to the cull. Radar and sniper stay out: they are the
 *  event-driven control group / scarcity-budgeted desk, not 30-min spenders. */
// self_scan (Agent A) retired 27/07 — no longer runs, so it can't be culled.
export const CULL_SOURCES = ["hybrid_scan", "mistral_scan", "grok_scan", "deepseek_scan", "kimi_scan"] as const;

/**
 * ⚠️⚠️ MESAS EM PROVA — isentas do corte automático, e por quê (16/08).
 *
 * O `decideCull` corta por NÍVEL: 100+ decididos e líquido negativo, desliga.
 * Foi exatamente esse critério que mandou a GERI para Valhalla em 27/07 — e
 * mediu certo o número errado. Naquela mesma janela, os cards por tick dela
 * caíam de 4,00 para 1,29 e a confiança declarada subia de 59,7 para 64,3. O
 * NÍVEL ainda era ruim; a DERIVADA não era. Ela foi desligada no meio de estar
 * aprendendo, e foi a única mesa deste laboratório que já mostrou aprender.
 *
 * Ela voltou em 16/08 com um `retireWhen` próprio, declarado em `desks.ts`:
 *
 *     "a seletividade PARAR de melhorar (…) NÃO aposentar por continuar
 *      negativa enquanto a curva ainda anda — foi esse critério que a matou
 *      em 27/07, no meio do aprendizado"
 *
 * ⚠️ SEM ESTA LISTA, AQUELE CAMPO SERIA MENTIRA. A ficha diria uma coisa e o
 * cron faria outra, automaticamente, ao centésimo trade — a invariante nº 25
 * na forma mais cara: uma declaração que o produto não lê. Ou o código respeita
 * a ficha, ou a ficha não devia existir.
 *
 * ⚠️ E ISTO NÃO É PERDÃO, É TROCA DE JUIZ. A GERI continua com critério de
 * saída; ele só não é automático, porque "a curva parou de andar" não tem
 * definição medida ainda. Quem julga é o dono, olhando a série semanal de
 * cards/tick e confiança. No dia em que esse critério virar número testado, ele
 * entra no `decideCull` e esta lista some — ela é andaime, não arquitetura.
 *
 * ⚠️ ISENÇÃO CUSTA CARO E POR ISSO É UMA SÓ. MUNINN, SLEIPNIR, HUGINN e ODIN
 * continuam sob o corte normal. Uma lista que cresce vira "nenhuma mesa é
 * cortada", e aí o cull não existe mais.
 */
export const EM_PROVA = ["mistral_scan"] as const;

export interface SourceStat { source: string; decided: number; resolved: number; expectancyNet: number | null }

/** Pure verdict: who gets culled, who is champion. Sub-sample agents are
 *  untouchable either way — a lucky/unlucky streak is not a verdict.
 *
 *  ⚠️ Mesa EM PROVA não é cortada (ver `EM_PROVA`), mas continua concorrendo a
 *  campeã: a isenção é do machado, não do placar. Escondê-la do ranking seria
 *  proteger a mesa do resultado dela, e não é isso que se está comprando. */
export function decideCull(
  stats: SourceStat[],
  minSample = MIN_SAMPLE,
  emProva: readonly string[] = EM_PROVA,
): { cull: string[]; champion: string | null; poupadas: string[] } {
  const judged = stats.filter((s) => s.decided >= minSample && s.expectancyNet != null);
  const isenta = new Set(emProva);
  const reprovadas = judged.filter((s) => s.expectancyNet! < 0);
  /**
   * ⚠️ QUEM FOI POUPADO SAI DAQUI COM NOME. Uma isenção que age em silêncio é o
   * mesmo defeito do gatilho de retro que morreu 20 dias sem avisar: o sistema
   * toma uma decisão e ninguém fica sabendo. A mesa poupada tem de aparecer no
   * ledger a cada rodada em que o machado teria caído — é assim que o dono
   * lembra de julgar a curva dela na mão, já que o cron não vai julgar.
   */
  return {
    cull: reprovadas.filter((s) => !isenta.has(s.source)).map((s) => s.source),
    poupadas: reprovadas.filter((s) => isenta.has(s.source)).map((s) => s.source),
    champion: judged
      .filter((s) => s.expectancyNet! > 0)
      .sort((a, b) => b.expectancyNet! - a.expectancyNet!)[0]?.source ?? null,
  };
}

/** admin_kv `culled:<source>` flags currently standing. */
export async function getCulledSources(): Promise<Set<string>> {
  const out = new Set<string>();
  const db = getSupabaseAdmin();
  if (!db) return out;
  try {
    const { data } = await db.from("admin_kv").select("key, value").like("key", "culled:%");
    for (const r of data ?? []) if (r.value === "true") out.add(r.key.slice("culled:".length));
  } catch { /* best-effort — nobody culled on a KV hiccup */ }
  return out;
}

/** One cull tick (cron, after resolution): live-round stats per agent →
 *  standing verdicts. Idempotent — flags flip once, events fire once. */
export async function runTournamentCull(): Promise<{ culled: string[]; champion: string | null }> {
  const none = { culled: [] as string[], champion: null };
  if (!CULL_ON) return none;
  const db = getSupabaseAdmin();
  if (!db) return none;

  const rows = await selectAllRows<{ source: string | null; status: string; outcome_pct: number | null }>((from, to) =>
    db.from("zion_suggestions").select("source, status, outcome_pct")
      .in("source", CULL_SOURCES as unknown as string[])
      .is("archived_at", null) // live round only — the archive is history, not evidence
      .order("created_at", { ascending: true }).range(from, to),
  );

  const agg = new Map<string, { decided: number; resolved: number; sum: number }>();
  for (const r of rows) {
    if (!r.source || r.status === "open") continue;
    const a = agg.get(r.source) ?? { decided: 0, resolved: 0, sum: 0 };
    a.resolved++; a.sum += Number(r.outcome_pct) || 0;
    if (r.status === "hit_target" || r.status === "win" || r.status === "hit_stop" || r.status === "loss") a.decided++;
    agg.set(r.source, a);
  }
  const stats: SourceStat[] = [...agg.entries()].map(([source, a]) => ({
    source, decided: a.decided, resolved: a.resolved,
    expectancyNet: a.resolved > 0 ? a.sum / a.resolved - COST_PCT : null,
  }));

  const verdict = decideCull(stats);
  const already = await getCulledSources();
  const now = new Date().toISOString();

  for (const source of verdict.cull) {
    if (already.has(source)) continue; // standing verdict — don't re-announce
    try {
      await db.from("admin_kv").upsert({ key: `culled:${source}`, value: "true", updated_at: now }, { onConflict: "key" });
      const s = stats.find((x) => x.source === source);
      recordEvent("tournament_cull", { meta: {
        source, decided: s?.decided ?? 0,
        expectancyNet: s?.expectancyNet != null ? Math.round(s.expectancyNet * 100) / 100 : null,
      } });
    } catch { /* best-effort — next tick retries */ }
  }

  /**
   * ⚠️ O MACHADO QUE NÃO CAIU TAMBÉM É NOTÍCIA. Sem esta linha, a GERI passaria
   * a existir num estado que nenhuma tela mostra: reprovada pelo critério
   * automático e viva mesmo assim. Quem olhasse o painel veria uma mesa
   * negativa que "por algum motivo" não foi cortada — e o motivo é uma decisão
   * nossa, que precisa reaparecer toda vez que ela é aplicada.
   */
  for (const source of verdict.poupadas) {
    const s = stats.find((x) => x.source === source);
    recordEvent("tournament_cull_isento", { meta: {
      source, decided: s?.decided ?? 0,
      expectancyNet: s?.expectancyNet != null ? Math.round(s.expectancyNet * 100) / 100 : null,
      porque: "mesa EM PROVA: julgada pela tendência da seletividade, não pelo nível "
        + "do líquido — ver `retireWhen` em desks.ts. Julgamento é do operador.",
    } });
  }

  try {
    const { data: cur } = await db.from("admin_kv").select("value").eq("key", "tournament_champion").maybeSingle();
    const prev = cur?.value ?? null;
    const next = verdict.champion ?? "";
    if (verdict.champion && prev !== next) {
      await db.from("admin_kv").upsert({ key: "tournament_champion", value: next, updated_at: now }, { onConflict: "key" });
      const s = stats.find((x) => x.source === verdict.champion);
      recordEvent("tournament_champion", { meta: {
        source: verdict.champion, previous: prev,
        expectancyNet: s?.expectancyNet != null ? Math.round(s.expectancyNet * 100) / 100 : null,
      } });
    }
  } catch { /* best-effort */ }

  return { culled: verdict.cull, champion: verdict.champion };
}
