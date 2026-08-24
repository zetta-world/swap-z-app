/**
 * AUTO-RETRO — the reflection step of the learning loop
 * (docs/PLANO-ANALISTA-PROFUNDO.md, parte A).
 *
 * The flywheel MEASURES every trade; desk memory REMEMBERS the last 7 days;
 * this module makes each agent REFLECT: every RETRO_EVERY_N decided trades,
 * the SAME model that made the decisions reviews them (geometry, regime,
 * outcome, time-to-resolution) and distills up to 3 SPECIFIC operational
 * lessons. Lessons are stored in agent_lessons (full history, auditable)
 * and injected into the agent's next prompts as <your_lessons>.
 *
 * Guardrails: a lesson is CONTEXT, never permission — no lesson relaxes a
 * mechanical gate (clamps, stop floors, cooldowns, caps are code). Max 3
 * active lessons, ≤220 chars each; each retro REPLACES the previous set
 * (history stays). The flywheel keeps judging: if lessons hurt, expectancy
 * shows it and AGENT_RETRO=off turns the whole thing off.
 */
import { openaiCompatChat } from "@/lib/ai/provider";
import { configuredProviders, hybridBrain, roleProvider } from "@/lib/ai/registry";
import { isTripped } from "@/lib/ai/circuit";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { modelChain } from "@/lib/zion/model";
import { recordEvent, logError } from "@/lib/admin/track";

const RETRO_ON      = (process.env.AGENT_RETRO ?? "on") !== "off";
const RETRO_EVERY_N = Number(process.env.RETRO_EVERY_N ?? 10);
const MAX_LESSONS   = 3;
// 220 chopped the lessons mid-prescription — the first retro round produced
// "...until a higher-conviction filter is a", "...require a s". The diagnosis
// survived the cut, the ACTION didn't, which is the half that matters. 400
// fits a complete finding+prescription while still forbidding essays.
const MAX_LESSON_CHARS = Number(process.env.RETRO_LESSON_CHARS ?? 400);
const MAX_TRADES_REVIEWED = 20;

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * QUANTOS DECIDIDOS AINDA NÃO FORAM REFLETIDOS.
 *
 * ⚠️⚠️ POR QUE ISTO SUBSTITUIU UM CONTADOR (16/08) — e por que o volante
 * inteiro ficou 20 dias parado sem ninguém notar.
 *
 * O gatilho antigo era uma subtração de totais:
 *
 *     shouldRetro = decididosAgora − decididosNaÚltimaRetro >= everyN
 *
 * `decididosAgora` conta a RODADA VIVA (`archived_at is null`).
 * `decididosNaÚltimaRetro` é o `decided_count` gravado na última reflexão —
 * anotado quando a rodada anterior ainda estava viva.
 *
 * Arquivar a rodada zerou o numerador e deixou o marco lá em cima:
 *
 *     radar          marco 23   ·   vivos hoje 5   →   5−23 = −18 ≥ 10 ? não
 *     mistral_scan   marco 60   ·   vivos hoje 1   →   nunca
 *     kimi_scan      marco 54   ·   vivos hoje 3   →   nunca
 *     grok_scan      marco 51   ·   vivos hoje 1   →   nunca
 *
 * Isso não é "ainda não chegou a hora", é **nunca mais**: o radar precisaria de
 * 33 decididos na rodada viva para alcançar um marco que descreve trades já
 * arquivados. Um contador absoluto medido contra uma população que OUTRA parte
 * do sistema esvazia não tem como voltar a disparar — e falha em silêncio,
 * porque "não disparou" é indistinguível de "ainda não deu o número".
 *
 * ⚠️ A CORREÇÃO É NÃO CONTAR TOTAIS. Conta-se o que ainda não foi refletido:
 * trades resolvidos DEPOIS do instante da última reflexão. Isso é imune a
 * arquivamento, a re-escopo da consulta e a qualquer mudança no tamanho da
 * população, porque cada trade só é contado uma vez na vida — no intervalo em
 * que ele é novo.
 *
 * `null` = nunca refletiu; nesse caso todo decidido é novo, que é o correto.
 */
export function naoRefletidos(
  resolvidosEmMs: readonly number[],
  ultimaRetroMs: number | null,
): number {
  let n = 0;
  for (const t of resolvidosEmMs) {
    // ⚠️ Um `resolved_at` ilegível conta como NOVO. O erro para este lado
    // gasta uma reflexão a mais; para o outro, some com o trade para sempre —
    // e foi exatamente "sumir em silêncio" que custou 20 dias.
    if (!Number.isFinite(t)) { n++; continue; }
    if (ultimaRetroMs === null || t > ultimaRetroMs) n++;
  }
  return n;
}

/** Uma retro dispara quando ≥ everyN decididos ainda não foram refletidos. */
export function deveRefletir(naoRefletidosN: number, everyN = RETRO_EVERY_N): boolean {
  return naoRefletidosN >= everyN;
}

/** Tolerant lesson extraction: {"lessons":[...]} direct, then embedded JSON.
 *  Caps count and length — a reflection is a scalpel, not an essay. */
export function parseLessons(text: string, maxLessons = MAX_LESSONS, maxChars = MAX_LESSON_CHARS): string[] {
  const tryParse = (s: string): string[] | null => {
    try {
      const o = JSON.parse(s) as { lessons?: unknown };
      if (o && Array.isArray(o.lessons)) return o.lessons.filter((l): l is string => typeof l === "string" && l.trim().length > 0);
    } catch { /* fall through */ }
    return null;
  };
  const trimmed = text.trim();
  let lessons = tryParse(trimmed);
  if (!lessons) {
    const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) lessons = tryParse(trimmed.slice(start, end + 1));
  }
  return (lessons ?? []).slice(0, maxLessons).map((l) => l.trim().slice(0, maxChars));
}

/** Active lessons for a set of sources (newest agent_lessons row each).
 *  Best-effort: empty map on any failure — a prompt without lessons is
 *  yesterday's prompt, never an error. */
export async function getActiveLessons(sources: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const db = getSupabaseAdmin();
  if (!db || sources.length === 0) return out;
  try {
    const { data } = await db.from("agent_lessons")
      .select("source, lessons, created_at")
      .in("source", sources)
      .order("created_at", { ascending: false })
      .limit(sources.length * 4);
    for (const r of data ?? []) {
      if (out.has(r.source)) continue; // newest per source wins
      const lessons = Array.isArray(r.lessons) ? (r.lessons as unknown[]).filter((l): l is string => typeof l === "string") : [];
      if (lessons.length) out.set(r.source, lessons.slice(0, MAX_LESSONS));
    }
  } catch { /* best-effort */ }
  return out;
}

/** Render the prompt block. Explicitly frames lessons as context-not-permission. */
export function lessonsBlock(lessons: string[] | undefined): string {
  if (!lessons?.length) return "";
  return [
    "<your_lessons>",
    "Lessons YOU distilled from your own recent results. They are context to",
    "sharpen judgement — they never override the desk's hard rules.",
    ...lessons.map((l, i) => `${i + 1}. ${l}`),
    "</your_lessons>",
  ].join("\n");
}

// ── The reflection ──────────────────────────────────────────────────────────

interface TradeRow {
  symbol: string; side: string; status: string; outcome_pct: number | null;
  entry_price: number | null; target_price: number | null; stop_price: number | null;
  regime: string | null; created_at: string; resolved_at: string | null;
}

function retroPrompt(source: string, trades: TradeRow[]): string {
  const lines = trades.map((t) => {
    const tgt = t.entry_price && t.target_price ? `${((Math.abs(t.target_price - t.entry_price) / t.entry_price) * 100).toFixed(1)}%` : "—";
    const stp = t.entry_price && t.stop_price ? `${((Math.abs(t.entry_price - t.stop_price) / t.entry_price) * 100).toFixed(1)}%` : "—";
    const held = t.resolved_at ? `${((Date.parse(t.resolved_at) - Date.parse(t.created_at)) / 3_600_000).toFixed(0)}h` : "—";
    return `${t.created_at.slice(5, 10)} ${t.side.toUpperCase()} ${t.symbol} tgt ${tgt} stop ${stp} regime ${t.regime ?? "?"} → ${t.status} ${t.outcome_pct != null ? `${t.outcome_pct > 0 ? "+" : ""}${t.outcome_pct.toFixed(1)}%` : ""} in ${held}`;
  });
  return [
    `You are the trading agent "${source}" reviewing YOUR OWN recent record.`,
    "Below are your last decided trades: direction, bracket geometry, market",
    "regime at entry, outcome and time to resolution.",
    "",
    ...lines,
    "",
    "Distill up to 3 SPECIFIC, OPERATIONAL lessons from this record — patterns",
    "in what lost and what won that would change your NEXT decisions. Not",
    'generic wisdom ("manage risk better"), but concrete and testable',
    '("my counter-trend buys in RANGING regimes all stopped out — demand',
    'confirmed reversal structure before the next one").',
    "If the record is too mixed for an honest pattern, return fewer lessons",
    "or none — a false lesson is worse than no lesson.",
    "",
    'Respond with a SINGLE JSON object, nothing else: {"lessons": ["...", "..."]}',
  ].join("\n");
}

/** Sources that reflect, and which brain does the reflecting (the SAME brain
 *  that made the decisions — self-evaluation, not peer review). Covers the
 *  oracles, the event agents AND the scanners (relit 25/07 with lessons). */
function brainFor(source: string): { kind: "compat"; providerId: string } | null {
  /**
   * ⚠️ O RAMO `anthropic` SAIU EM 21/08, e ele já era código morto antes disso.
   * O comentário anterior dizia, com todas as letras: "no Anthropic seat remains
   * in the flywheel (27/07) ... it simply has no source routed to it today".
   * Um ramo que nenhum `source` alcança é caminho que ninguém testa e todo mundo
   * lê como se existisse — com a plataforma inteira migrada para Kimi, ele
   * passaria a ser uma chamada 401 esperando alguém rotear para lá.
   */
  // Agent B's CEO seat is DeepSeek since 27/07 — the seat that signs the cards
  // is the seat that reflects on them. (self_scan is retired: no new trades to
  // reflect on, so it simply never crosses the threshold again.)
  if (source === "hybrid_scan") {
    const ceo = roleProvider("ceo");
    return ceo ? { kind: "compat", providerId: ceo.id } : null;
  }
  if (source.startsWith("oracle_")) return { kind: "compat", providerId: source.slice("oracle_".length) };
  if (source.endsWith("_scan")) return { kind: "compat", providerId: source.slice(0, -"_scan".length) };
  /**
   * ⚠️ MÍMIR ENTROU EM 16/08 — e a ausência dele era invisível.
   *
   * `strat_ai` não termina em `_scan`, não começa com `oracle_` e não é sniper
   * nem radar: caía no `return null` e era filtrado fora da varredura na linha
   * do `bySource`. Resultado: a única mesa mecânica COM cérebro LLM
   * (`roleProviderChain("brain")`, prompt próprio em `strategist-ai.ts`) nunca
   * teve uma lição na vida, e nada na tela dizia isso.
   *
   * Reflete o assento `brain` — o mesmo que assina as escolhas. É a regra do
   * módulo inteiro: auto-avaliação, não revisão por terceiro.
   */
  if (source === "sniper" || source === "radar" || source === "strat_ai") {
    const brain = hybridBrain();
    return brain ? { kind: "compat", providerId: brain.id } : null;
  }
  /**
   * ⚠️ E AS MESAS MECÂNICAS CONTINUAM FORA, DE PROPÓSITO.
   *
   * VÖLUNDR, SKAÐI, URÐR, FREYJA, ULLR e os arbitradores decidem em
   * `selectPlaybook` / `candidateAttempts` — código determinístico, sem prompt.
   * Uma lição é texto injetado num prompt; sem prompt ela não tem onde pousar,
   * e gerá-la produziria texto que ninguém lê (invariante nº 25).
   *
   * O canal delas existe e é outro: URÐR lê `loadPlaybookRecord()` +
   * `loadHistory()`, e VÖLUNDR ignora tudo POR DECISÃO — é o grupo de controle
   * que dá sentido à comparação. Quem quiser ver isso olha o painel de
   * aprendizado (`lib/zion/aprendizado.ts`), onde o canal de cada mesa é
   * declarado em vez de deduzido deste `return null`.
   */
  return null;
}

export interface RetroResult { reviewed: string[]; }

/** One retro sweep (cron, after cull): find agents that crossed the
 *  RETRO_EVERY_N threshold since their last reflection and make each one
 *  review itself. Best-effort per agent. */
export async function runRetroSweep(): Promise<RetroResult> {
  const none: RetroResult = { reviewed: [] };
  if (!RETRO_ON) return none;
  const db = getSupabaseAdmin();
  if (!db) return none;

  // Decided counts per source (live round), for the LLM agents only.
  // leitura-limitada: o Auto-Retro reflete sobre as decisões RECENTES; a
  // ordenação por `resolved_at` desc garante que o recorte pega as últimas, e
  // uma lição tirada de trade de três meses atrás descreve outro mercado.
  const { data: decided } = await db.from("zion_suggestions")
    .select("source, status, outcome_pct, symbol, side, entry_price, target_price, stop_price, regime, created_at, resolved_at")
    .is("archived_at", null)
    .in("status", ["hit_target", "hit_stop"])
    .order("resolved_at", { ascending: false })
    .limit(2000);
  const bySource = new Map<string, TradeRow[]>();
  for (const r of decided ?? []) {
    if (!r.source || !brainFor(r.source)) continue;
    const arr = bySource.get(r.source) ?? [];
    arr.push(r as TradeRow);
    bySource.set(r.source, arr);
  }
  if (bySource.size === 0) return none;

  // INSTANTE da última reflexão por mesa — não mais a contagem dela. Ver a
  // nota em `naoRefletidos`: contagem contra contagem morre quando o
  // arquivamento esvazia a população, e foi o que aconteceu em 27/07.
  const { data: lastRetros } = await db.from("agent_lessons")
    .select("source, created_at")
    .in("source", [...bySource.keys()])
    .order("created_at", { ascending: false })
    .limit(bySource.size * 4);
  const ultimaRetroBy = new Map<string, number>();
  for (const r of lastRetros ?? []) {
    if (ultimaRetroBy.has(r.source)) continue;
    const t = Date.parse(r.created_at);
    if (Number.isFinite(t)) ultimaRetroBy.set(r.source, t);
  }

  const reviewed: string[] = [];
  for (const [source, trades] of bySource) {
    const novos = naoRefletidos(
      trades.map((t) => Date.parse(t.resolved_at ?? "")),
      ultimaRetroBy.get(source) ?? null,
    );
    if (!deveRefletir(novos)) continue;
    const brain = brainFor(source)!;
    const prompt = retroPrompt(source, trades.slice(0, MAX_TRADES_REVIEWED));
    try {
      let text = "";
      {
        const provider = configuredProviders().find((p) => p.id === brain.providerId) ?? hybridBrain();
        if (!provider?.apiKey || await isTripped(provider.id)) continue;
        const r = await openaiCompatChat(
          { model: provider.model, system: "You are a rigorous trading-desk reviewer.", user: prompt, maxTokens: 600, timeoutMs: provider.timeoutMs ?? 30_000, temperature: provider.temperature, extraBody: provider.extraBody },
          { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
        );
        text = r.text;
        recordEvent("zion_analysis", { meta: { op: "retro", model: r.model, source, ...r.usage } });
      }
      const lessons = parseLessons(text);
      // An empty reflection still checkpoints — "no honest pattern yet" is a
      // valid answer and must not re-fire every tick.
      // `decided_count` continua gravado para AUDITORIA — dá para reconstruir o
      // tamanho da rodada no instante da reflexão. Ele não é mais o gatilho: o
      // gatilho é `created_at` desta linha, lido pela próxima varredura.
      await db.from("agent_lessons").insert({ source, lessons, decided_count: trades.length });
      recordEvent("agent_retro", { meta: { source, decided: trades.length, nao_refletidos: novos, lessons: lessons.length } });
      reviewed.push(source);
    } catch (e) {
      logError(`retro:${source}`, e instanceof Error ? e.message : String(e), { source });
    }
  }
  return { reviewed };
}
