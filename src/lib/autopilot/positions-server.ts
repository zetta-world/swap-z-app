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
 * ⚠️⚠️⚠️ `recordServerEntry` VIVIA AQUI, E SAIU NO A131-C (Round 9).
 *
 * Ela abria/somava posição a partir dos números que o CALLER calculava, e era
 * o caminho do cron imediato. O navegador não tinha caminho nenhum (gravava em
 * `localStorage`), e o fill tardio não tinha nenhum — a reconciliação nunca
 * tocou em `autopilot_positions`, apesar de o cron dizer por escrito "posicao
 * abre na reconciliacao".
 *
 * Três regras para a mesma pergunta, uma delas inexistente. Agora existe uma:
 * `projetarEfeitoDoIntent` (migration 0064), que lê `filled_qty`/`filled_quote`
 * do LIVRO, calcula `ledger − applied` e aplica dentro de uma transação. Ela é
 * idempotente por intent, o que `recordServerEntry` nunca poderia ser: somar
 * com média não tem como saber se aquele fill já entrou.
 *
 * ⚠️ NÃO RESSUSCITAR. Um segundo escritor de posição é um segundo modelo de
 * quanto o bot possui — que é exatamente o achado A131.
 */

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
 * ⚠️⚠️⚠️ `reduzirServerPosition` E `closeServerPosition` VIVIAM AQUI, E SAÍRAM
 * NO A136 (Round 9).
 *
 * Elas eram as duas escritas que a liquidação da saída armada fazia depois de
 * ler a ordem na corretora — e eram o ÚLTIMO caminho paralelo de escrita de
 * posição. Enquanto existiram, o produto tinha duas formas de reduzir a mesma
 * bolsa: a RPC idempotente (marcador + posição numa transação) e este par
 * solto, cujo registro no marcador era uma SEGUNDA operação.
 *
 * Qualquer ordem entre as duas perdia:
 *
 *   marcador OK + posição falha → a reconciliação vê delta zero para sempre;
 *   posição OK + marcador falha → a reconciliação reduz DE NOVO.
 *
 * Eu "consertei" invertendo a ordem, o que só troca qual cenário acontece. O
 * auditor apontou que exactly-once não se resolve com telemetria, e está
 * certo: `autopilot_liquidar_saida_armada` (0064) faz as duas numa transação.
 *
 * ⚠️ A cicatriz do A14 que `reduzirServerPosition` carregava continua valendo,
 * e mora agora dentro da RPC: saída PARCIAL não apaga a linha. Vender US$ 100
 * de uma posição de US$ 500 fazia o bot acreditar que não tem nada — o resto
 * ficava órfão e o teto de exposição liberava os US$ 500 inteiros.
 *
 * ⚠️ NÃO RESSUSCITAR. Um segundo escritor de posição é um segundo modelo do
 * que o bot possui, que é o achado A131.
 */

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
