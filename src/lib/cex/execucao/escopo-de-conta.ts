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
 * ⚠️⚠️ A126 (round 7, hipótese SUPERADA) → A127 §65/§66 (round 8, o que
 * vale agora): o R7 materializava o escopo conexão como a UNIÃO de
 * `conexao_id = C1` com `session_id IN sessoes(C1)`, porque o intent do
 * browser gravava `session_id` com `conexao_id` NULL. O R8 SUPERA essa
 * hipótese: a sessão é MUTÁVEL (rearm C1→C2 reescreve
 * `autopilot_sessions.conexao_id`), então o join `session→conexao` não é
 * prova histórica de conta — ele migraria intents ANTIGOS para o escopo da
 * conexão NOVA (§66). Do R8 em diante a identidade de conta vem SÓ do que o
 * próprio intent gravou: `conexao_id` (crons e browser novos gravam — §67)
 * ou `credential_fingerprint` (manual real, A120). O intent legacy
 * session-only é INDETERMINADO com motivo explícito — nunca herda a sessão.
 *
 * Convenção da casa: `undefined` = falha de leitura; `null` = ausência;
 * um Set vazio = "li tudo e não havia nada". Nunca confundir os três.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { IntentRow } from "@/lib/cex/execucao/intents";

/**
 * A conta CEX a que um intent pertence, nas DUAS formas duráveis que o
 * próprio intent carrega. As duas viram UM filtro de igualdade sobre a
 * tabela de intents — nada mais alarga o escopo (R8 supera R7/A126 §66: a
 * variante `sessao` e o braço por sessões da conexão foram removidos; a
 * sessão é mutável e não é prova histórica).
 */
export type EscopoDeContaCex =
  | { tipo: "conexao"; conexaoId: string }
  | { tipo: "fingerprint"; fingerprint: string };

export type ResultadoDoEscopo =
  | { ok: true; escopo: EscopoDeContaCex }
  | { ok: false; porque: string };   // indeterminado (inclui falha de leitura)

/** Tamanho do pedaço do `IN (...)` dos fills — binds têm limite na prática. */
const CHUNK_DE_INTENTS = 200;

/**
 * Resolve a conta do intent pela PRECEDÊNCIA do R8 (§65 — supera o R7):
 *
 *   1. `conexao_id` → a conexão gravada NO INTENT é a conta. Dura para
 *      sempre: rearm da sessão (C1→C2) NÃO migra intents antigos de escopo
 *      (§66) — o vínculo histórico é o que está na linha;
 *   2. `credential_fingerprint` → a credencial é a conta (manual real, A120);
 *   3. session-only ou nada → INDETERMINADO, com motivo explícito. O join
 *      `session→autopilot_sessions.conexao_id` do R7 foi REMOVIDO: a sessão
 *      é mutável e não comprova a conta histórica (A127).
 *
 * ⚠️ NÃO LÊ O BANCO. Resolver o escopo é olhar a linha do intent — nenhuma
 * consulta a `autopilot_sessions` acontece aqui nem na materialização.
 */
export async function resolverEscopoDaConta(
  db: SupabaseClient<Database>, intent: IntentRow,
): Promise<ResultadoDoEscopo> {
  if (intent.conexao_id) {
    return { ok: true, escopo: { tipo: "conexao", conexaoId: intent.conexao_id } };
  }
  if (intent.credential_fingerprint) {
    return { ok: true, escopo: { tipo: "fingerprint",
                                 fingerprint: intent.credential_fingerprint } };
  }
  if (intent.session_id) {
    return { ok: false, porque:
      "legacy session-only: identidade historica nao comprovada — A127" };
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
  not(coluna: string, operador: string, valor: unknown): ConsultaComEscopo;
  range(inicio: number, fim: number): PromiseLike<
    { data: unknown; error: { message: string } | null }>;
}

/** A linha mínima de intent que alimenta os dois conjuntos da deriva. */
interface LinhaDeIntentDoEscopo {
  id: string;
  external_order_id: string | null;
}

/** Os filtros comuns a TODA materialização de escopo. */
interface FiltroDeIntents {
  exchangeId: string;
  /** null = SEM filtro de símbolo (o caminho dos fills — ver tradesNoLivroNoEscopo). */
  symbol: string | null;
  desdeIso: string;
  /** `external_order_id IS NOT NULL` — SÓ no caminho de ordens (como sempre foi). */
  soComOrdemExterna: boolean;
}

/**
 * ⚠️⚠️ A127 §66 (R8 supera R7/A126): O ESCOPO TEM UM BRAÇO SÓ. O que a
 * materialização consulta é `conexao_id = C` OU `credential_fingerprint = F`
 * — o que o INTENT gravou, nunca a sessão (mutável; não é prova histórica).
 * Não há união, não há braço por sessões, não há dedup: uma igualdade sobre
 * uma coluna durável, paginada até a página vir curta. Novos intents — DCA,
 * cron e browser — todos gravam `conexao_id` (§67); o legacy session-only
 * nem chega aqui (o resolver o declara indeterminado).
 *
 * `undefined` = falha de leitura. Página cheia = PODE haver mais — truncar
 * aqui era exatamente o `.limit(1000)` do achado original.
 */
async function intentsDoEscopo(
  db: SupabaseClient<Database>, escopo: EscopoDeContaCex,
  filtro: FiltroDeIntents, pagina: number,
): Promise<LinhaDeIntentDoEscopo[] | undefined> {
  const coluna = escopo.tipo === "conexao" ? "conexao_id" : "credential_fingerprint";
  const valor = escopo.tipo === "conexao" ? escopo.conexaoId : escopo.fingerprint;
  const linhas: LinhaDeIntentDoEscopo[] = [];
  let inicio = 0;
  for (;;) {
    const base = db.from("cex_execution_intents")
      .select("id, external_order_id")
      .eq("exchange_id", filtro.exchangeId)
      .gte("created_at", filtro.desdeIso)
      .order("created_at", { ascending: true })
      // ⚠️ Desempate determinístico (revisão R6): sem `id` secundário, empates
      // de created_at numa fronteira de página podem reordenar entre queries
      // no Postgres e pular/duplicar uma linha entre páginas.
      .order("id");
    let q = base as unknown as ConsultaComEscopo;
    if (filtro.symbol !== null) q = q.eq("symbol", filtro.symbol);
    if (filtro.soComOrdemExterna) q = q.not("external_order_id", "is", null);
    const { data, error } = await q.eq(coluna, valor)
      .range(inicio, inicio + pagina - 1);
    if (error) return undefined;
    const paginaDeLinhas = (data ?? []) as Array<
      { id: string; external_order_id: string | null }>;
    for (const r of paginaDeLinhas) {
      linhas.push({ id: String(r.id),
                    external_order_id: r.external_order_id == null
                      ? null : String(r.external_order_id) });
    }
    if (paginaDeLinhas.length < pagina) return linhas;
    inicio += pagina;
  }
}

/**
 * Os `external_order_id` das ordens que NÓS criamos NESTA CONTA, corretora e
 * símbolo, na janela. ⚠️ É o denominador da deriva (A103) COM escopo (A124):
 * ordem de OUTRA CONTA não absolve trade desta. R8 (§66): o escopo conexão é
 * SÓ `conexao_id = C` — o rearm da sessão (C1→C2) não migra intents antigos,
 * porque o vínculo histórico é o que o intent gravou.
 *
 * Paginado com `.range()` até a página vir curta; `pagina` é injetável para
 * o teste provar a paginação sem mil linhas. `undefined` = falha de leitura.
 */
export async function ordensConhecidasNoEscopo(
  db: SupabaseClient<Database>, escopo: EscopoDeContaCex,
  exchangeId: string, symbol: string, desdeIso: string, pagina = 1000,
): Promise<Set<string> | undefined> {
  const intents = await intentsDoEscopo(db, escopo,
    { exchangeId, symbol, desdeIso, soComOrdemExterna: true }, pagina);
  if (intents === undefined) return undefined;
  const conhecidas = new Set<string>();
  for (const i of intents) {
    if (i.external_order_id !== null) conhecidas.add(i.external_order_id);
  }
  return conhecidas;
}

/**
 * Os `external_trade_id` que o LIVRO já tem NESTA CONTA, corretora, símbolo e
 * janela — via `intent_id IN (ids do escopo)`, em chunks. Fill é ligado ao
 * intent; a conta do fill é a conta do intent dele, nunca a corretora toda.
 *
 * ⚠️ SEM FILTRO DE SÍMBOLO NA LISTAGEM DOS INTENTS, de propósito: a conta é
 * o conjunto INTEIRO dos intents dela, e o corte de símbolo acontece na LINHA
 * DO FILL (é o filtro que o deliberate break §41 prova ser estrutural). Se o
 * símbolo cortasse na listagem, um fill fora de símbolo nem chegaria a ser
 * julgado.
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
  const intents = await intentsDoEscopo(db, escopo,
    { exchangeId, symbol: null, desdeIso, soComOrdemExterna: false }, pagina);
  if (intents === undefined) return undefined;
  const ids = intents.map((i) => i.id);
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
