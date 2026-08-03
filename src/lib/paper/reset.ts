/**
 * ZERAR UM LEDGER DE PAPEL — quando o resultado medido não é resultado.
 *
 * POR QUE ISTO EXISTE (03/08):
 *
 * A auditoria da coorte provou que as quatro mesas de arbitragem vinham
 * contabilizando ruído de feed como lucro: 2.010 ciclos somados, ZERO perdas,
 * spread médio de 0.72% entre CEXes onde o spread real vive em 0.01–0.05%, e
 * uma venue aparecendo nos DOIS lados de 90% das pernas.
 *
 *   arbiter      1.341 ciclos · +$190.27
 *   arbiter2       617 ciclos · +$103.23
 *   arbiter2_3x     34 ciclos ·   +$6.99
 *   arbiter2_5x     18 ciclos ·   +$3.67
 *
 * Enquanto esses $304 estiverem no ledger, TODA soma do laboratório está
 * inflada — e as comparações entre mesas, que são a única coisa que este
 * laboratório produz, ficam medidas contra um número falso.
 *
 * AS TRÊS REGRAS QUE ESTE MÓDULO SEGUE, e por quê:
 *
 *  1. ARQUIVA, NUNCA APAGA. As posições recebem `archived_at` e somem das
 *     leituras (todas já filtram por ele), mas continuam no banco. A evidência
 *     do defeito é o próprio registro; apagá-la deixaria só a minha palavra de
 *     que ele existiu.
 *  2. EXIGE MOTIVO ESCRITO. Zerar sem motivo produz, meses depois, um ledger
 *     que ninguém sabe explicar — e a dúvida recai sobre o dado bom. O motivo
 *     fica gravado junto do que foi zerado.
 *  3. NUNCA É AUTOMÁTICO. Nenhum cron, nenhuma verificação chama isto. Um
 *     sistema capaz de zerar o próprio resultado sozinho não tem resultado.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { recordEvent } from "@/lib/admin/track";

export interface ResetPlan {
  source: string;
  label: string;
  /** O que será arquivado. */
  positions: number;
  /** O lucro que sai da conta — o número que estava mentindo. */
  realizedUsd: number;
  cashUsd: number;
  startingUsd: number;
}

export interface ResetOutcome extends ResetPlan {
  archived: number;
  ok: boolean;
}

/**
 * O que um reset vai fazer, sem fazer.
 *
 * Existe porque zerar é irreversível na prática (dá para desarquivar, mas
 * ninguém vai), e um botão dessa natureza que só existe na forma "clica e
 * confia" é a coisa errada. Dá para ver a conta antes.
 */
export async function planReset(sources: string[]): Promise<ResetPlan[]> {
  const db = getSupabaseAdmin();
  if (!db || sources.length === 0) return [];
  const { data: accounts } = await db.from("paper_accounts")
    .select("id, source, label, starting_usd, cash_usd, realized_pnl_usd").in("source", sources);
  if (!accounts?.length) return [];

  const out: ResetPlan[] = [];
  for (const a of accounts) {
    const row = a as { id: string; source: string; label: string | null; starting_usd: number; cash_usd: number; realized_pnl_usd: number };
    // `head: true` — só a contagem interessa, e algumas mesas têm milhares de
    // linhas que não precisam trafegar para virar um número.
    const { count } = await db.from("paper_positions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", row.id).is("archived_at", null);
    out.push({
      source: row.source, label: row.label ?? row.source,
      positions: count ?? 0,
      realizedUsd: Number(row.realized_pnl_usd),
      cashUsd: Number(row.cash_usd),
      startingUsd: Number(row.starting_usd),
    });
  }
  return out.sort((x, y) => Math.abs(y.realizedUsd) - Math.abs(x.realizedUsd));
}

/**
 * Executa o reset e deixa o registro.
 *
 * O motivo é OBRIGATÓRIO e vai para `platform_events` e para `admin_kv`. Sem
 * ele, a mesa reaparece amanhã com saldo redondo e ninguém consegue dizer se
 * foi zerada de propósito ou se algo a quebrou — e essa dúvida contamina o
 * dado bom junto com o ruim.
 */
export async function resetLedgers(sources: string[], reason: string): Promise<ResetOutcome[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  if (!reason.trim()) throw new Error("reset sem motivo escrito não é permitido");

  const plans = await planReset(sources);
  const at = new Date().toISOString();
  const out: ResetOutcome[] = [];

  for (const p of plans) {
    const { data: acc } = await db.from("paper_accounts").select("id").eq("source", p.source).maybeSingle();
    if (!acc) { out.push({ ...p, archived: 0, ok: false }); continue; }
    const id = (acc as { id: string }).id;

    // ARQUIVA — não apaga. A evidência do defeito é o próprio registro.
    const { error: arqErr } = await db.from("paper_positions")
      .update({ archived_at: at }).eq("account_id", id).is("archived_at", null);
    // O erro é LIDO: o cliente do Supabase resolve com `{ error }` em vez de
    // lançar, e foi exatamente assim que o vazamento de caixa passou calado.
    if (arqErr) { out.push({ ...p, archived: 0, ok: false }); continue; }

    const { error: accErr } = await db.from("paper_accounts").update({
      cash_usd: p.startingUsd, realized_pnl_usd: 0, wins: 0, losses: 0, updated_at: at,
    }).eq("id", id);
    out.push({ ...p, archived: p.positions, ok: !accErr });
  }

  const feitos = out.filter((o) => o.ok);
  if (feitos.length > 0) {
    await db.from("admin_kv").upsert({
      key: "paper_reset:last", updated_at: at,
      value: JSON.stringify({
        at, reason,
        sources: feitos.map((o) => ({ source: o.source, realizedRemoved: Math.round(o.realizedUsd * 100) / 100, archived: o.archived })),
        totalRemovedUsd: Math.round(feitos.reduce((s, o) => s + o.realizedUsd, 0) * 100) / 100,
      }),
    }, { onConflict: "key" });
    recordEvent("paper_ledger_reset", { meta: {
      reason,
      sources: feitos.map((o) => o.source).join(","),
      total_removed_usd: Math.round(feitos.reduce((s, o) => s + o.realizedUsd, 0) * 100) / 100,
      archived: feitos.reduce((s, o) => s + o.archived, 0),
    } });
  }
  return out;
}

/** O último reset, para as telas distinguirem "mesa nova" de "mesa zerada". */
export async function lastReset(): Promise<{ at: string; reason: string; totalRemovedUsd: number } | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("admin_kv").select("value").eq("key", "paper_reset:last").maybeSingle();
  if (!data) return null;
  try {
    const p = JSON.parse(String((data as { value: string }).value)) as { at: string; reason: string; totalRemovedUsd: number };
    return p.at ? { at: p.at, reason: p.reason ?? "", totalRemovedUsd: Number(p.totalRemovedUsd) || 0 } : null;
  } catch { return null; }
}
