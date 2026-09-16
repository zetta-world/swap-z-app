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
 * ⚠️⚠️ A126 (round 7): O ESCOPO CONEXÃO INCLUI AS SESSÕES DA CONEXÃO. O
 * intent `autopilot_browser` grava `session_id` com `conexao_id` NULL (a
 * sessão aponta para a conexão em `autopilot_sessions.conexao_id`) — filtrar
 * só por `conexao_id = C1` fazia esses intents SUMIREM do escopo da própria
 * conta, e a ordem de um browser da conta virava "deriva" na reconciliação
 * de outro browser da MESMA conta (falso drift). A materialização de
 * `{tipo:"conexao"}` é a UNIÃO de dois braços — `conexao_id = C1` e
 * `session_id IN sessoes(C1)` — com dedup por `intent.id` e fail-closed:
 * erro em QUALQUER braço (inclusive listar as sessões) → `undefined`, nunca
 * o conjunto "completo" só do braço direto.
 *
 * Convenção da casa: `undefined` = falha de leitura; `null` = ausência;
 * um Set vazio = "li tudo e não havia nada". Nunca confundir os três.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { IntentRow } from "@/lib/cex/execucao/intents";

/**
 * A conta CEX a que um intent pertence, nas três formas duráveis que o schema
 * já carrega. Fingerprint e sessão viram UM filtro de igualdade sobre a
 * tabela de intents; a conexão vira a UNIÃO de `conexao_id = C1` com
 * `session_id IN sessoes(C1)` (A126) — nada mais alarga o escopo.
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

/** Tamanho do pedaço do `IN (session_id ...)` do braço indireto (A126). */
const CHUNK_DE_SESSOES = 200;

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
 * Os ids das sessões que apontam para a conexão — o mapa do braço indireto
 * do escopo conexão (A126). Paginado com `.range()` até a página vir curta,
 * ordenado por `id` (desempate determinístico: sem ele, empates numa
 * fronteira de página podem reordenar entre queries no Postgres e pular ou
 * repetir uma sessão entre páginas). `undefined` = falha de leitura.
 */
export async function idsDeSessoesDaConexao(
  db: SupabaseClient<Database>, conexaoId: string, pagina = 1000,
): Promise<string[] | undefined> {
  const ids: string[] = [];
  let inicio = 0;
  for (;;) {
    const { data, error } = await db.from("autopilot_sessions")
      .select("id")
      .eq("conexao_id", conexaoId)
      .order("id")
      .range(inicio, inicio + pagina - 1);
    if (error) return undefined;
    const linhas = (data ?? []) as Array<{ id: string }>;
    for (const r of linhas) ids.push(String(r.id));
    if (linhas.length < pagina) return ids;
    inicio += pagina;
  }
}

/**
 * UM braço de materialização do escopo: um filtro de igualdade (`eq`) ou de
 * pertencimento (`in`) sobre a tabela de intents. O escopo conexão tem dois
 * braços (o direto e um por chunk de sessões); fingerprint e sessão têm um só.
 */
type BracoDeEscopo =
  | { op: "eq"; coluna: string; valor: string }
  | { op: "in"; coluna: string; valores: string[] };

/**
 * Os braços que materializam o escopo. ⚠️ A126: para `{tipo:"conexao"}` isto
 * LÊ `autopilot_sessions` — e erro nessa leitura devolve `undefined` para a
 * consulta INTEIRA (§33: nunca declarar o escopo completo só com o braço
 * direto). Sessões vazio → o braço indireto é legítimamente VAZIO (a conexão
 * pode não ter nenhuma sessão; não é erro). Escopos `fingerprint` e `sessao`
 * seguem com um braço só, INALTERADOS (§28).
 */
async function bracosDoEscopo(
  db: SupabaseClient<Database>, escopo: EscopoDeContaCex, paginaSessoes: number,
): Promise<BracoDeEscopo[] | undefined> {
  switch (escopo.tipo) {
    case "fingerprint":
      return [{ op: "eq", coluna: "credential_fingerprint", valor: escopo.fingerprint }];
    case "sessao":
      return [{ op: "eq", coluna: "session_id", valor: escopo.sessionId }];
    case "conexao": {
      const sessoes = await idsDeSessoesDaConexao(db, escopo.conexaoId, paginaSessoes);
      if (sessoes === undefined) return undefined;
      const bracos: BracoDeEscopo[] = [
        { op: "eq", coluna: "conexao_id", valor: escopo.conexaoId },
      ];
      for (let i = 0; i < sessoes.length; i += CHUNK_DE_SESSOES) {
        bracos.push({ op: "in", coluna: "session_id",
                      valores: sessoes.slice(i, i + CHUNK_DE_SESSOES) });
      }
      return bracos;
    }
  }
}

/**
 * O filtro de igualdade/pertencimento que materializa UM braço sobre a
 * tabela de intents. Tipagem solta de propósito: o builder do PostgREST é um
 * `this` polimórfico e o banco falso dos testes é um objeto simples — o
 * contrato real é "sabe filtrar por igualdade/pertencimento", e a guarda
 * estrutural (§42) impede que isto vire porta para escopo largo.
 */
interface ConsultaComEscopo {
  eq(coluna: string, valor: string): ConsultaComEscopo;
  in(coluna: string, valores: string[]): ConsultaComEscopo;
  not(coluna: string, operador: string, valor: unknown): ConsultaComEscopo;
  range(inicio: number, fim: number): PromiseLike<
    { data: unknown; error: { message: string } | null }>;
}

function aplicarBraco(q: ConsultaComEscopo, braco: BracoDeEscopo): ConsultaComEscopo {
  return braco.op === "eq" ? q.eq(braco.coluna, braco.valor)
                           : q.in(braco.coluna, braco.valores);
}

/** A linha mínima de intent que alimenta os dois conjuntos da deriva. */
interface LinhaDeIntentDoEscopo {
  id: string;
  external_order_id: string | null;
}

/** Os filtros comuns a TODOS os braços (A126: os dois lados da união filtram igual). */
interface FiltroDeIntents {
  exchangeId: string;
  /** null = SEM filtro de símbolo (o caminho dos fills — ver tradesNoLivroNoEscopo). */
  symbol: string | null;
  desdeIso: string;
  /** `external_order_id IS NOT NULL` — SÓ no caminho de ordens (como sempre foi). */
  soComOrdemExterna: boolean;
}

/**
 * O listador paginado ÚNICO de `{id, external_order_id}` por braço — uma só
 * lógica de paginação (`.range()` até a página vir curta, com desempate
 * determinístico por `id`) para os dois braços e para os dois conjuntos
 * derivados. `undefined` = falha de leitura.
 */
async function listarIntentsDoBraco(
  db: SupabaseClient<Database>, braco: BracoDeEscopo,
  filtro: FiltroDeIntents, pagina: number,
): Promise<LinhaDeIntentDoEscopo[] | undefined> {
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
    const { data, error } = await aplicarBraco(q, braco)
      .range(inicio, inicio + pagina - 1);
    if (error) return undefined;
    const paginaDeLinhas = (data ?? []) as Array<
      { id: string; external_order_id: string | null }>;
    for (const r of paginaDeLinhas) {
      linhas.push({ id: String(r.id),
                    external_order_id: r.external_order_id == null
                      ? null : String(r.external_order_id) });
    }
    // ⚠️ Página curta = fim de verdade. Página cheia = PODE haver mais —
    // truncar aqui era exatamente o `.limit(1000)` do achado.
    if (paginaDeLinhas.length < pagina) return linhas;
    inicio += pagina;
  }
}

/**
 * A UNIÃO dos braços do escopo (A126), com DEDUP por `intent.id`: um intent
 * com `conexao_id = C1` E `session_id = S1` (S1→C1) bate nos dois braços e
 * apareceria duplicado — aqui aparece UMA vez. Erro em QUALQUER braço →
 * `undefined` para a consulta inteira (fail-closed, §33).
 */
async function intentsDoEscopo(
  db: SupabaseClient<Database>, escopo: EscopoDeContaCex,
  filtro: FiltroDeIntents, pagina: number,
): Promise<LinhaDeIntentDoEscopo[] | undefined> {
  const bracos = await bracosDoEscopo(db, escopo, pagina);
  if (bracos === undefined) return undefined;
  const vistos = new Map<string, LinhaDeIntentDoEscopo>();
  for (const braco of bracos) {
    const linhas = await listarIntentsDoBraco(db, braco, filtro, pagina);
    if (linhas === undefined) return undefined;
    for (const l of linhas) if (!vistos.has(l.id)) vistos.set(l.id, l);
  }
  return [...vistos.values()];
}

/**
 * Os `external_order_id` das ordens que NÓS criamos NESTA CONTA, corretora e
 * símbolo, na janela. ⚠️ É o denominador da deriva (A103) COM escopo (A124):
 * ordem de OUTRA CONTA não absolve trade desta. E COM as sessões da conexão
 * (A126): a ordem do browser da mesma conta entra pelo braço `session_id IN
 * sessoes(C1)` — sem ele ela virava falso drift.
 *
 * Paginado com `.range()` até a página vir curta em CADA braço; `pagina` é
 * injetável para o teste provar a paginação sem mil linhas (e vale também
 * para a listagem das sessões). `undefined` = falha de leitura.
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
