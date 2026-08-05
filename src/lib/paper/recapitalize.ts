/**
 * RECAPITALIZAÇÃO — dar a cada mesa o capital que a ESTRATÉGIA dela pede.
 *
 * ⚠️ O DEFEITO QUE ISTO CONSERTA (auditoria de 05/08).
 *
 * As 23 carteiras receberam $1.000 (ou $300 nas alavancadas) independentemente
 * do que a estratégia exige. Isso não é neutro — é medir errado por construção:
 *
 *   · funding precisa de $2.000 para as quatro pernas a 0,45% não dominarem;
 *   · uma direcional de 10 posições precisa de $5.000 para cada uma ser ~$500;
 *   · com $1.000, duas posições JÁ SÃO a carteira inteira.
 *
 * Mesa sub-capitalizada não "rende menos": ela rende NEGATIVO por causa do
 * custo fixo, e o resultado é lido como "a estratégia não presta". Provavelmente
 * já matamos ideias boas assim.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ POR QUE ISTO É UM RESET, E NÃO UM AJUSTE DE COLUNA.
 *
 * A tentação é somar a diferença em `starting_usd` e `cash_usd` e seguir. Seria
 * errado, e o erro é do tipo que só aparece semanas depois:
 *
 *  · `returnPct` é `(equity / starting) − 1`. Mudar o denominador com trades
 *    antigos dentro REESCREVE o retorno histórico da mesa. Uma perda de 2% em
 *    $1.000 viraria 0,4% em $5.000 — sem nenhum trade novo ter acontecido.
 *  · a curva de patrimônio passaria a misturar dois regimes de capital no mesmo
 *    gráfico, sem marca nenhuma dizendo onde a régua mudou.
 *  · e a comparação entre mesas ficaria envenenada, que é exatamente o erro das
 *    janelas de 260 e 174 dias: atribuir a uma variável uma diferença que veio
 *    de outra.
 *
 * Então a recapitalização ARQUIVA a rodada anterior (nunca apaga) e recomeça a
 * medição com o capital certo. O histórico continua consultável; o que não
 * acontece é o número velho ser recalculado com a régua nova.
 *
 * As três regras herdadas de `reset.ts`, pelos mesmos motivos:
 *   1. ARQUIVA, nunca apaga.
 *   2. Exige MOTIVO escrito.
 *   3. Nunca é automática.
 *
 * E uma quarta, própria: **não mexe em mesa aposentada**. O capital delas é
 * histórico, e recapitalizá-las apagaria a cicatriz do vazamento de julho.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { DESKS, deskFor } from "@/lib/zion/desks";

export interface RecapPlan {
  source: string;
  label: string;
  /** O que a carteira tem hoje. */
  fromUsd: number;
  /** O que a estratégia exige, declarado em `desks.ts`. */
  toUsd: number;
  deltaUsd: number;
  /** O porquê do número — vem do registro, não é inventado aqui. */
  why: string;
  /** Quantas posições vivas seriam arquivadas. */
  openPositions: number;
  closedPositions: number;
}

/**
 * O que SERIA feito, sem fazer.
 *
 * Só mesas VIVAS, e só quando o capital declarado difere do atual. Mesa cujo
 * capital já bate não aparece — plano com linha inerte treina o operador a
 * clicar sem ler.
 */
export async function planRecap(): Promise<RecapPlan[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];

  const vivas = DESKS.filter((d) => d.status === "live");
  const { data: accounts } = await db
    .from("paper_accounts")
    .select("id, source, label, starting_usd, cash_usd")
    .in("source", vivas.map((d) => d.source));
  if (!accounts) return [];

  const plans: RecapPlan[] = [];
  for (const a of accounts) {
    const row = a as { id: string; source: string; label: string | null; starting_usd: number; cash_usd: number };
    const desk = deskFor(row.source);
    if (!desk) continue;
    const alvo = desk.capitalRequiredUsd;
    const atual = Number(row.starting_usd);
    // Tolerância de um centavo: diferença de ponto flutuante não é decisão.
    if (Math.abs(alvo - atual) < 0.01) continue;

    const { count: abertas } = await db
      .from("paper_positions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", row.id).eq("status", "open").is("archived_at", null);
    const { count: fechadas } = await db
      .from("paper_positions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", row.id).eq("status", "closed").is("archived_at", null);

    plans.push({
      source: row.source,
      label: row.label ?? desk.name,
      fromUsd: atual,
      toUsd: alvo,
      deltaUsd: alvo - atual,
      why: desk.capitalWhy,
      openPositions: abertas ?? 0,
      closedPositions: fechadas ?? 0,
    });
  }
  return plans.sort((a, b) => b.deltaUsd - a.deltaUsd);
}

export interface RecapOutcome {
  source: string;
  fromUsd: number;
  toUsd: number;
  archivedPositions: number;
}

/**
 * Executa: arquiva a rodada e recomeça com o capital declarado.
 *
 * `reason` é obrigatório e checado aqui além do banco — o erro tem que aparecer
 * antes do insert, não depois. Recapitalizar sem motivo escrito é a mesma coisa
 * que zerar um ledger sem dizer por quê: daqui a um mês ninguém sabe se aquele
 * degrau na curva foi decisão ou acidente.
 */
export async function recapitalize(
  sources: string[], reason: string,
): Promise<RecapOutcome[]> {
  if (reason.trim().length < 15) {
    throw new Error("recapitalização exige motivo escrito com pelo menos 15 caracteres");
  }
  const db = getSupabaseAdmin();
  if (!db) return [];

  const plans = (await planRecap()).filter((p) => sources.includes(p.source));
  const at = new Date().toISOString();
  const out: RecapOutcome[] = [];

  for (const p of plans) {
    const { data: acc } = await db
      .from("paper_accounts").select("id").eq("source", p.source).maybeSingle();
    if (!acc?.id) continue;
    const id = String(acc.id);

    // 1. ARQUIVA a rodada anterior. Nunca apaga — o histórico continua
    //    consultável, e é ele que explica o degrau na curva.
    //
    // Conta ANTES de arquivar: depois do update a condição `archived_at is
    // null` não casa mais nada, e o número voltaria zero para tudo.
    const { count } = await db
      .from("paper_positions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id).is("archived_at", null);
    await db
      .from("paper_positions")
      .update({ archived_at: at })
      .eq("account_id", id).is("archived_at", null);

    // 2. Recomeça com o capital declarado. `realized_pnl_usd` volta a zero
    //    junto — é o contador da rodada, e deixá-lo para trás é exatamente o
    //    defeito que o `radar` tinha.
    await db.from("paper_accounts").update({
      starting_usd: p.toUsd,
      cash_usd: p.toUsd,
      realized_pnl_usd: 0,
      wins: 0, losses: 0,
      updated_at: at,
    }).eq("id", id);

    out.push({
      source: p.source, fromUsd: p.fromUsd, toUsd: p.toUsd,
      archivedPositions: count ?? 0,
    });
  }

  // 3. Deixa registro em `admin_kv`, no mesmo padrão do reset e do reparo:
  //    sem marco, um degrau que aparecer amanhã fica indistinguível do de hoje.
  await db.from("admin_kv").upsert({
    key: "paper_recap:last",
    value: JSON.stringify({ at, reason, entries: out }),
    updated_at: at,
  });

  return out;
}

/** O último marco de recapitalização, para a tela mostrar contra o que comparar. */
export async function lastRecap(): Promise<{ at: string; reason: string; entries: RecapOutcome[] } | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("admin_kv").select("value").eq("key", "paper_recap:last").maybeSingle();
  if (!data?.value) return null;
  try {
    return JSON.parse(String(data.value)) as { at: string; reason: string; entries: RecapOutcome[] };
  } catch { return null; }
}
