/**
 * Server-side autopilot position memory (A5) — the cron's equivalent of the
 * browser store in src/lib/store/autopilotPositions.ts.
 *
 * The background cron records what it BUYS here so it can later inject open
 * positions into the ZION scan (model proposes exits), arm those exits, and
 * settle realized P&L back into the session's daily loss-stop.
 *
 * Server-only: imports the service-role Supabase client. Never import from a
 * client component.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AutopilotPositionRow } from "@/lib/supabase/types";

/**
 * ⚠️⚠️ POR QUE ESTAS FUNCOES DEVOLVEM RESULTADO EM VEZ DE `void`.
 * (auditoria do autopilot, 23/08)
 *
 * O `engine.ts` ja carrega esta cicatriz escrita, com o valor em dolares que
 * ela custou: **o cliente do Supabase NAO LANCA em erro de banco — ele
 * RESOLVE com `{ data: null, error }`**. Um `await db.from(...).upsert(...)`
 * sem conferir `error` e indistinguivel de sucesso.
 *
 * La foram US$ 450 a 1.000 em catorze carteiras de PAPEL. Aqui e a conta na
 * corretora do cliente, e a sequencia era:
 *
 *   1. `placeCexOrder` OK  -> dinheiro real saiu
 *   2. o upsert falha      -> resolve com {error}, ninguem olha
 *   3. o painel diz FIRED  -> e nenhuma posicao existe no banco
 *
 * Na passada seguinte `getOpenServerPositions` nao devolve a posicao, o ramo
 * de venda cai em "no open autopilot position for this base", e **o bot nunca
 * mais sai daquele trade**. O teto de exposicao tambem fica cego e libera
 * comprar mais.
 *
 * ⚠️ NAO DA PARA DESFAZER A ORDEM. Entao o objetivo aqui nao e impedir — e
 * NUNCA PERDER O FATO. Quem chama decide o que fazer; o que nao pode e achar
 * que gravou.
 */
export type Gravacao = { ok: true } | { ok: false; erro: string };

/** Uma tentativa extra cobre a falha transitoria sem virar retentativa infinita. */
export async function comRetentativa(
  // O builder do supabase-js e THENABLE, nao Promise completa — por isso
  // `PromiseLike`. Exigir `Promise` aqui recusa o proprio cliente.
  f: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<Gravacao> {
  for (let i = 0; i < 2; i++) {
    const { error } = await f();
    if (!error) return { ok: true };
    if (i === 1) return { ok: false, erro: error.message.slice(0, 200) };
  }
  return { ok: false, erro: "inalcancavel" };
}

/**
 * ⚠️⚠️⚠️ "ZERO POSIÇÕES" E "NÃO CONSEGUI LER" SÃO ESTADOS DIFERENTES — A133.
 *
 * Esta função devolvia `AutopilotPositionRow[]`, e devolvia `[]` para as duas
 * coisas:
 *
 *     if (!db)    return [];
 *     if (error)  return [];
 *
 * O caller não tinha como perguntar qual dos dois aconteceu. E o que ele faz
 * com `[]` é operar: `exposureUsd` vira 0, `ownedBases` vira vazio, e o teto de
 * exposição — o número que limita quanto dinheiro do dono fica exposto — passa
 * a permitir comprar tudo de novo. Um Postgres intermitente virava licença.
 *
 * ⚠️ O PIOR É QUE O CONSERTO JÁ ESTAVA ESCRITO UMA CAMADA ACIMA.
 * `reconciliar-conta.ts` documenta em letras maiúsculas que falha de leitura de
 * posições é `leitura_falhou` e bloqueia ENTRADAS — mas quem engolia o erro era
 * esta função, ANTES de ela poder decidir. É a família do A113 mais uma vez: a
 * peça certa, com a cicatriz escrita, e um caminho que a contorna.
 *
 * ⚠️ SEM BANCO TAMBÉM É FALHA, não "não há posições". O livro é a autoridade
 * sobre o que o bot possui; sem ele não se afirma inventário nenhum.
 */
export type LeituraDePosicoes =
  | { ok: true; posicoes: AutopilotPositionRow[] }
  | { ok: false; porque: string };

export type LeituraDeUmaPosicao =
  | { ok: true; posicao: AutopilotPositionRow | null }
  | { ok: false; porque: string };

/** All non-closed positions for a session (the held bag the cron manages). */
export async function getOpenServerPositions(sessionId: string): Promise<LeituraDePosicoes> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, porque: "supabase nao configurado" };
  const { data, error } = await db
    .from("autopilot_positions")
    .select("*")
    .eq("session_id", sessionId)
    .neq("status", "closed");
  if (error) return { ok: false, porque: error.message.slice(0, 200) };
  // ⚠️ `data` nulo sem erro é leitura vazia LEGÍTIMA — zero posições.
  return { ok: true, posicoes: data ?? [] };
}

/**
 * A posição do BOT numa base, para esta sessão — a resposta à única pergunta
 * que autoriza venda autônoma: "quanto deste ativo pertence ao bot?".
 *
 * ⚠️ TRÊS RESPOSTAS, NÃO DUAS: existe, não existe, e não consegui ler. A
 * terceira nunca pode se passar pela segunda — vender sem saber o que é do bot
 * é vender patrimônio do dono (A131).
 *
 * ⚠️ INCLUI `closed` DE PROPÓSITO: quem chama precisa distinguir "posição
 * fechada" de "nunca existiu", e o filtro de status é decisão de quem lê.
 */
export async function lerPosicaoDoBot(
  sessionId: string, base: string,
): Promise<LeituraDeUmaPosicao> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, porque: "supabase nao configurado" };
  const { data, error } = await db
    .from("autopilot_positions")
    .select("*")
    .eq("session_id", sessionId)
    .eq("base", base.toUpperCase())
    .maybeSingle();
  if (error) return { ok: false, porque: error.message.slice(0, 200) };
  return { ok: true, posicao: data ?? null };
}

/**
 * Record (or average into) an entry after a BUY fills. Mirrors the browser
 * store's average-in: a second buy of the same base folds into one row at the
 * blended average cost.
 */
export async function recordServerEntry(p: {
  sessionId:     string;
  walletAddress: string;
  exchangeId:    string;
  pair:          string;
  entryPrice:    number;
  baseAmount:    number;
  costUsd:       number;
  reasoning?:    string;
  entryLabel?:   string;
}): Promise<Gravacao> {
  const db = getSupabaseAdmin();
  // ⚠️ Sem banco configurado isto e falha, nao "nada a fazer": a ordem ja
  // existe na corretora e ninguem vai saber dela.
  if (!db) return { ok: false, erro: "supabase nao configurado" };
  const base = p.pair.split("/")[0].toUpperCase();

  /**
   * ⚠️⚠️ A LEITURA DE ANTES TAMBÉM FALHAVA ABERTA — A133, §6.
   *
   * Era `const { data: prev } = await ...`, com o `error` descartado. Falha de
   * leitura virava "não existe posição" — e o ramo de baixo INSERE uma linha
   * nova. Numa base onde o bot já tinha 0,5 BTC somado ao longo do dia, o
   * upsert por `(session_id, base)` sobrescreveria o acumulado pelo tamanho da
   * última compra: o livro passaria a dizer que o bot tem MENOS do que tem, e
   * o resto viraria órfão que ninguém mais vende.
   *
   * Agora não se conclui nada de uma leitura que não aconteceu.
   */
  const anterior = await lerPosicaoDoBot(p.sessionId, base);
  if (!anterior.ok) {
    return { ok: false, erro: `leitura da posicao anterior falhou: ${anterior.porque}` };
  }
  const prev = anterior.posicao;

  const nowIso = new Date().toISOString();
  if (prev && prev.status !== "closed") {
    const totalBase = Number(prev.base_amount) + p.baseAmount;
    const totalCost = Number(prev.cost_usd) + p.costUsd;
    const avgPrice  = totalBase > 0 ? totalCost / totalBase : p.entryPrice;
    return comRetentativa(() => db.from("autopilot_positions").update({
      entry_price: avgPrice,
      base_amount: totalBase,
      cost_usd:    totalCost,
      reasoning:   p.reasoning ?? prev.reasoning,
      entry_label: p.entryLabel ?? prev.entry_label,
      status:      "open",       // re-open if it had an exit armed
      updated_at:  nowIso,
    }).eq("id", prev.id));
  }

  // Fresh position (or replacing a closed one).
  return comRetentativa(() => db.from("autopilot_positions").upsert({
    session_id:     p.sessionId,
    wallet_address: p.walletAddress,
    exchange_id:    p.exchangeId,
    base,
    pair:           p.pair.toUpperCase(),
    entry_price:    p.entryPrice,
    base_amount:    p.baseAmount,
    cost_usd:       p.costUsd,
    reasoning:      p.reasoning ?? null,
    entry_label:    p.entryLabel ?? null,
    status:         "open",
    exit_order_id:  null,
    exit_armed_at:  null,
    entry_ts:       nowIso,
    updated_at:     nowIso,
  }, { onConflict: "session_id,base" }));
}

/**
 * Marca que existe ordem de saída pousada nesta posição.
 *
 * ⚠️ SE ISTO FALHAR CALADO, A POSIÇÃO CONTINUA `open` — e a passada seguinte
 * arma a saída DE NOVO. Duas ordens de venda para a mesma bolsa, e a segunda
 * tenta vender o que a primeira já vendeu.
 */
export async function markServerExitArmed(sessionId: string, base: string, orderId: string): Promise<Gravacao> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, erro: "sem banco" };
  return comRetentativa(() => db.from("autopilot_positions").update({
    status:        "exit_armed",
    exit_order_id: orderId,
    exit_armed_at: new Date().toISOString(),
    updated_at:    new Date().toISOString(),
  }).eq("session_id", sessionId).eq("base", base.toUpperCase()));
}

/**
 * Reabre posição cuja saída armada foi cancelada/expirada, para poder re-armar.
 *
 * ⚠️ SE ISTO FALHAR CALADO, a posição fica `exit_armed` apontando para uma ordem
 * MORTA. Ela nunca mais re-arma — e o bot nunca mais sai daquele trade. É a
 * mesma classe da posição não gravada, pelo lado oposto.
 */
export async function reopenServerPosition(sessionId: string, base: string): Promise<Gravacao> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, erro: "sem banco" };
  return comRetentativa(() => db.from("autopilot_positions").update({
    status:        "open",
    exit_order_id: null,
    exit_armed_at: null,
    updated_at:    new Date().toISOString(),
  }).eq("session_id", sessionId).eq("base", base.toUpperCase()));
}

/**
 * Reduz a posição depois de uma saída PARCIAL — o resto continua sendo gerido.
 *
 * ⚠️⚠️ ANTES NÃO EXISTIA: qualquer venda com preenchimento > 0 chamava
 * `closeServerPosition` e apagava a linha inteira (achado A14). Vender US$ 100
 * de uma posição de US$ 500 fazia o bot acreditar que não tem nada — o resto
 * fica órfão na conta do cliente, nunca mais gerido nem vendido, e o teto de
 * exposição libera os US$ 500 inteiros, então ele ainda compra por cima.
 *
 * ⚠️ Volta a `open` de propósito: a ordem de saída que estava armada acabou de
 * ser resolvida, e o que sobrou precisa poder armar de novo. Ficar
 * `exit_armed` apontando para ordem morta é a cicatriz de `reopenServerPosition`.
 */
export async function reduzirServerPosition(
  sessionId: string, base: string, baseRestante: number, custoRestante: number,
): Promise<Gravacao> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, erro: "sem banco" };
  return comRetentativa(() => db.from("autopilot_positions").update({
    base_amount:   baseRestante,
    cost_usd:      custoRestante,
    status:        "open",
    exit_order_id: null,
    exit_armed_at: null,
    updated_at:    new Date().toISOString(),
  }).eq("session_id", sessionId).eq("base", base.toUpperCase()));
}

/**
 * Remove a posição depois que ela saiu / não é mais mantida.
 *
 * ⚠️ SE ISTO FALHAR CALADO, o banco segue dizendo que a bolsa existe. O teto de
 * exposição conta capital que não está mais lá, e o ramo de venda pode tentar
 * vender de novo o que já foi vendido.
 */
export async function closeServerPosition(sessionId: string, base: string): Promise<Gravacao> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, erro: "sem banco" };
  return comRetentativa(() => db.from("autopilot_positions")
    .delete()
    .eq("session_id", sessionId)
    .eq("base", base.toUpperCase()));
}

/**
 * Atomically add realized P&L to the session's pnl_today and trip the freeze
 * if the daily loss-stop is crossed (apply_session_pnl does both in one
 * statement). `today` is the UTC day key set as frozen_until_day.
 */
export async function applySessionPnl(sessionId: string, deltaUsd: number, today: string): Promise<Gravacao> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, erro: "sem banco" };
  /**
   * ⚠️⚠️ ESTA É A PIOR DAS QUATRO, e por isso ficou por último no comentário.
   *
   * Este RPC faz duas coisas numa instrução: soma o P&L realizado do dia E
   * puxa o freio quando o stop de perda diária é cruzado.
   *
   * Falhar calado significa que o prejuízo NÃO FOI CONTADO. O stop que o dono
   * configurou deixa de existir naquele dia, sem nada na tela dizendo — e ele
   * só descobre pelo extrato da corretora. É a mesma cicatriz do contador
   * diário de trades (#340), no freio que protege mais dinheiro.
   */
  return comRetentativa(() =>
    db.rpc("apply_session_pnl", { p_id: sessionId, p_delta: deltaUsd, p_today: today }));
}
