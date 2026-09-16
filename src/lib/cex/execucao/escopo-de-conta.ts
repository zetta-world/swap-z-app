/**
 * ⚠️⚠️ ESCOPO DE CONTA — achado A124 (round 6).
 *
 * O QUE ESTAVA ERRADO. A checagem de deriva (A103) montava os conjuntos de
 * "ordens conhecidas" e "trades no livro" por `exchange_id` (+ símbolo, nas
 * ordens) — SEM conta. Duas contas do mesmo cliente na MESMA corretora (duas
 * conexões, duas credenciais) se absolviam mutuamente: um fill da conta A
 * entrava no conjunto da conta B e explicava atividade que a Z-SWAP não fez
 * na conta B. Cross-account é P0: o alarme de deriva tocava verde sobre
 * dinheiro de OUTRA conta.
 *
 * A IDENTIDADE DURÁVEL, por origem (diagnóstico do round):
 *
 *   · `autopilot_cron`  → `conexao_id` (e `session_id`);
 *   · `dca_cron`        → `conexao_id` (o cron SEMPRE passa `p.conexao_id`);
 *   · `autopilot_browser` → `session_id`, e a sessão tem `conexao_id`;
 *   · manual real       → `credential_fingerprint` (A120);
 *   · legado sem nada   → INDETERMINADO.
 *
 * ⚠️⚠️ O QUE NUNCA É IDENTIDADE DE CONTA: a wallet do cliente (duas contas
 * CEX do mesmo cliente dividem a mesma wallet custodial), `exchange_id`
 * sozinho, `symbol` sozinho, `plan_id`, `strategy_id`, `origin`. E NUNCA
 * existe "fallback exchange-wide": não saber a conta é INDETERMINADO, não é
 * "vale a corretora inteira" — fail-closed, o indeterminado nunca vira verde.
 *
 * ⚠️ PAGINAÇÃO É PARTE DO CONTRATO. Os helpers antigos faziam `.limit(1000)`
 * e tratavam o resultado como completo: a partir da milésima ordem na janela,
 * o truncamento silencioso virava "ordem desconhecida" e acusava deriva. Aqui
 * TODA leitura pagina com `.range()` até a página vir curta — truncamento
 * nunca vira conjunto completo.
 *
 * Convenção da casa: `undefined` = falha de leitura; `null` = ausência;
 * um Set vazio = "li tudo e não havia nada". Nunca confundir os três.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { IntentRow } from "@/lib/cex/execucao/intents";

/**
 * A conta CEX a que um intent pertence, nas três formas duráveis que o schema
 * já carrega. Cada forma vira UM filtro de igualdade sobre a tabela de
 * intents — nada mais alarga o escopo.
 */
export type EscopoDeContaCex =
  | { tipo: "conexao"; conexaoId: string }
  | { tipo: "fingerprint"; fingerprint: string }
  | { tipo: "sessao"; sessionId: string };

export type ResultadoDoEscopo =
  | { ok: true; escopo: EscopoDeContaCex }
  | { ok: false; porque: string };   // indeterminado (inclui falha de leitura)

/** Tamanho do pedaço do `IN (...)` dos fills — binds têm limite na prática. */
const CHUNK_DE_INTENTS = 200;

/**
 * Resolve a conta do intent pela PRECEDÊNCIA da SPEC (§11):
 *
 *   1. `conexao_id` → a conexão é a conta;
 *   2. `session_id` → lê `autopilot_sessions.conexao_id`:
 *      · erro de leitura → INDETERMINADO ("falha ao resolver sessao") —
 *        ⚠️ NUNCA vazio: um erro de banco não pode virar escopo estreito
 *        inventado nem escopo largo;
 *      · sessão com `conexao_id` → a conexão é a conta;
 *      · sessão sem `conexao_id` OU sessão inexistente → escopo SESSÃO
 *        (fallback ESTREITO: fecha mais, nunca alarga);
 *   3. `credential_fingerprint` → a credencial é a conta (manual real, A120);
 *   4. nada → INDETERMINADO ("sem identidade de conta").
 */
export async function resolverEscopoDaConta(
  db: SupabaseClient<Database>, intent: IntentRow,
): Promise<ResultadoDoEscopo> {
  if (intent.conexao_id) {
    return { ok: true, escopo: { tipo: "conexao", conexaoId: intent.conexao_id } };
  }
  if (intent.session_id) {
    const { data, error } = await db.from("autopilot_sessions")
      .select("conexao_id").eq("id", intent.session_id).limit(1);
    if (error) return { ok: false, porque: "falha ao resolver sessao" };
    const sessao = (data ?? [])[0] as { conexao_id: string | null } | undefined;
    if (sessao?.conexao_id) {
      return { ok: true, escopo: { tipo: "conexao", conexaoId: sessao.conexao_id } };
    }
    // Fallback estreito e fail-closed: a sessão é tudo o que sabemos.
    return { ok: true, escopo: { tipo: "sessao", sessionId: intent.session_id } };
  }
  if (intent.credential_fingerprint) {
    return { ok: true, escopo: { tipo: "fingerprint",
                                 fingerprint: intent.credential_fingerprint } };
  }
  return { ok: false, porque: "sem identidade de conta" };
}

/**
 * O filtro de igualdade que materializa o escopo sobre a tabela de intents.
 * Tipagem solta de propósito: o builder do PostgREST é um `this` polimórfico
 * e o banco falso dos testes é um objeto simples — o contrato real é "sabe
 * filtrar por igualdade", e a guarda estrutural (§42) impede que isto vire
 * porta para escopo largo.
 */
interface ConsultaComEscopo {
  eq(coluna: string, valor: string): ConsultaComEscopo;
}

function comEscopo<T extends ConsultaComEscopo>(q: T, escopo: EscopoDeContaCex): T {
  switch (escopo.tipo) {
    case "conexao":     return q.eq("conexao_id", escopo.conexaoId) as T;
    case "fingerprint": return q.eq("credential_fingerprint", escopo.fingerprint) as T;
    case "sessao":      return q.eq("session_id", escopo.sessionId) as T;
  }
}

/**
 * Os `external_order_id` das ordens que NÓS criamos NESTA CONTA, corretora e
 * símbolo, na janela. ⚠️ É o denominador da deriva (A103) COM escopo (A124):
 * ordem de OUTRA CONTA não absolve trade desta.
 *
 * Paginado com `.range()` até a página vir curta; `pagina` é injetável para
 * o teste provar a paginação sem mil linhas. `undefined` = falha de leitura.
 */
export async function ordensConhecidasNoEscopo(
  db: SupabaseClient<Database>, escopo: EscopoDeContaCex,
  exchangeId: string, symbol: string, desdeIso: string, pagina = 1000,
): Promise<Set<string> | undefined> {
  const conhecidas = new Set<string>();
  let inicio = 0;
  for (;;) {
    const base = db.from("cex_execution_intents")
      .select("external_order_id")
      .eq("exchange_id", exchangeId).eq("symbol", symbol)
      .gte("created_at", desdeIso)
      .not("external_order_id", "is", null)
      .order("created_at", { ascending: true })
      // ⚠️ Desempate determinístico (revisão R6): sem `id` secundário, empates
      // de created_at numa fronteira de página podem reordenar entre queries
      // no Postgres e pular/duplicar uma linha entre páginas.
      .order("id");
    const { data, error } = await comEscopo(base, escopo)
      .range(inicio, inicio + pagina - 1);
    if (error) return undefined;
    const linhas = (data ?? []) as Array<{ external_order_id: string }>;
    for (const r of linhas) conhecidas.add(String(r.external_order_id));
    // ⚠️ Página curta = fim de verdade. Página cheia = PODE haver mais —
    // truncar aqui era exatamente o `.limit(1000)` do achado.
    if (linhas.length < pagina) return conhecidas;
    inicio += pagina;
  }
}

/**
 * Os ids dos intents DO ESCOPO na janela — a ponte conta→fills.
 *
 * ⚠️ SEM FILTRO DE SÍMBOLO AQUI, de propósito: a conta é o conjunto INTEIRO
 * dos intents dela, e o corte de símbolo acontece na LINHA DO FILL (é o
 * filtro que o deliberate break §41 prova ser estrutural). Se o símbolo
 * cortasse aqui, um fill fora de símbolo nem chegaria a ser julgado.
 */
async function idsDosIntentsNoEscopo(
  db: SupabaseClient<Database>, escopo: EscopoDeContaCex,
  exchangeId: string, desdeIso: string, pagina: number,
): Promise<string[] | undefined> {
  const ids: string[] = [];
  let inicio = 0;
  for (;;) {
    const base = db.from("cex_execution_intents")
      .select("id")
      .eq("exchange_id", exchangeId)
      .gte("created_at", desdeIso)
      .order("created_at", { ascending: true })
      // ⚠️ Desempate determinístico (revisão R6): sem `id` secundário, empates
      // de created_at numa fronteira de página podem reordenar entre queries
      // no Postgres e pular/duplicar uma linha entre páginas.
      .order("id");
    const { data, error } = await comEscopo(base, escopo)
      .range(inicio, inicio + pagina - 1);
    if (error) return undefined;
    const linhas = (data ?? []) as Array<{ id: string }>;
    for (const r of linhas) ids.push(String(r.id));
    if (linhas.length < pagina) return ids;
    inicio += pagina;
  }
}

/**
 * Os `external_trade_id` que o LIVRO já tem NESTA CONTA, corretora, símbolo e
 * janela — via `intent_id IN (ids do escopo)`, em chunks. Fill é ligado ao
 * intent; a conta do fill é a conta do intent dele, nunca a corretora toda.
 *
 * ⚠️ O FILTRO DE SÍMBOLO É PARTE DO ESCOPO: o trade 999 de BTC/USDT não pode
 * absolver o trade 999 de ETH/USDT (a quebra deliberada §41 prova).
 *
 * Escopo com zero intents → Set VAZIO legítimo (li e não havia), que NÃO é
 * falha: `undefined` continua sendo só falha de leitura.
 */
export async function tradesNoLivroNoEscopo(
  db: SupabaseClient<Database>, escopo: EscopoDeContaCex,
  exchangeId: string, symbol: string, desdeIso: string, pagina = 1000,
): Promise<Set<string> | undefined> {
  const ids = await idsDosIntentsNoEscopo(db, escopo, exchangeId, desdeIso, pagina);
  if (ids === undefined) return undefined;
  const trades = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK_DE_INTENTS) {
    const chunk = ids.slice(i, i + CHUNK_DE_INTENTS);
    let inicio = 0;
    for (;;) {
      const { data, error } = await db.from("cex_fills")
        .select("external_trade_id")
        .in("intent_id", chunk)
        .eq("symbol", symbol)
        .gte("created_at", desdeIso)
        .not("external_trade_id", "is", null)
        .order("created_at", { ascending: true })
      // ⚠️ Desempate determinístico (revisão R6): sem `id` secundário, empates
      // de created_at numa fronteira de página podem reordenar entre queries
      // no Postgres e pular/duplicar uma linha entre páginas.
      .order("id")
        .range(inicio, inicio + pagina - 1);
      if (error) return undefined;
      const linhas = (data ?? []) as Array<{ external_trade_id: string }>;
      for (const r of linhas) trades.add(String(r.external_trade_id));
      if (linhas.length < pagina) break;
      inicio += pagina;
    }
  }
  return trades;
}
