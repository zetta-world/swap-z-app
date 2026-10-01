import { getSupabaseAdmin } from "@/lib/supabase/server";
import { encryptJson, decryptJson } from "@/lib/crypto/secretbox";
import { identidadeDaConexao } from "@/lib/cex/fingerprint";
import type { CexCredentials } from "@/lib/cex/types";

/**
 * O COFRE DA CREDENCIAL DE CORRETORA.
 * (`docs/PLANO-DCA-AUTOMATICO.md` §2 · migration `0031_cex_conexoes.sql`)
 *
 * ⚠️⚠️ POR QUE ESTE MÓDULO EXISTE. `autopilot_sessions` dizia ao mesmo tempo
 * "conectei minha corretora" e "o robô de IA está ligado". Ter um plano de
 * poupança não pode exigir ligar um robô de IA — são produtos e públicos
 * diferentes. A chave passa a morar aqui, e cada produto aplica a própria
 * política de prazo em cima.
 *
 * ⚠️ UMA CÓPIA DO SEGREDO. O dono recusou dar a cada produto a própria cópia
 * cifrada, e o motivo é de segurança: com duas cópias, matar o autopilot no
 * pânico NÃO mataria o DCA — ele seguiria operando com a segunda chave.
 *
 * ⚠️⚠️ A127 — CONEXÕES VERSIONADAS (migration 0063). Até o Round 8 o
 * `guardarConexao` fazia UPSERT por (wallet, exchange): salvar credencial
 * nova para o mesmo par SOBRESCREVIA `creds_cipher` NA MESMA LINHA, e o `id`
 * — gravado como `conexao_id` em intents, sessões e planos — passava a
 * apontar para OUTRA conta CEX. Agora cada conexão carrega
 * `credential_identity` (HMAC da credencial, `identidadeDaConexao`) e o par
 * vive versionado: no máximo UMA linha `is_current` por (wallet, exchange)
 * (índice parcial único da 0063), e trocar a credencial APOSENTA a versão
 * anterior (`is_current=false`, `superseded_at`) em vez de apagá-la — a
 * aposentada segue `is_active` e RECONCILIA os intents antigos que a
 * referenciam, mas NUNCA mais executa operação nova. A decisão de versão é
 * atômica no banco (RPC `cex_guardar_conexao_versionada`, advisory lock por
 * par); aqui só se calcula a identidade, cifra e chama.
 *
 * ⚠️⚠️ E POR QUE O CLIENTE AQUI É CRU, com `as never` no nome da tabela.
 *
 * `cex_conexoes` seria a 20ª entrada de `lib/supabase/types.ts`, e a 20ª
 * estoura a profundidade de inferência do supabase-js: ao registrar
 * `einherjar_mensagens` em 23/08, o `type-check` quebrou em DOIS ARQUIVOS QUE
 * NINGUÉM TOCOU — `zion/sniper.ts` e `zion/ullr.ts` — porque
 * `zion_suggestions` passou a resolver como `never`. É a CONTAGEM, não a
 * forma, e o TypeScript degrada EM SILÊNCIO.
 *
 * Está documentado na §5.3 do `ESTADO-ATUAL`, escrito por mim, e sou o
 * primeiro a bater nele. O cast é contenção: perde-se tipagem NESTE arquivo
 * para preservar a de tabelas que movem dinheiro.
 */

interface Resposta<T> { data: T | null; error: { message: string; code?: string } | null }
type ClienteCru = {
  from: (t: never) => {
    select: (c: string) => {
      eq: (c: string, v: unknown) => {
        maybeSingle: () => Promise<Resposta<unknown>>;
        eq: (c: string, v: unknown) => {
          maybeSingle: () => Promise<Resposta<unknown>>;
          eq: (c: string, v: unknown) => { maybeSingle: () => Promise<Resposta<unknown>> };
        };
      };
    };
    update: (v: unknown) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => Promise<Resposta<unknown>>;
      } & Promise<Resposta<unknown>>;
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<Resposta<unknown>>;
};
const TABELA = "cex_conexoes" as never;

const COLUNAS =
  "id, wallet_address, exchange_id, creds_cipher, expires_at, is_active, " +
  "credential_identity, is_current, superseded_at";

export interface Conexao {
  id:             string;
  wallet_address: string;
  exchange_id:    string;
  creds_cipher:   string;
  /** `null` = sem prazo duro. Cada produto aplica a própria política. */
  expires_at:     string | null;
  is_active:      boolean;
  /**
   * A127: HMAC da credencial (domínio `cex-connection-v1`). `null` = linha
   * legada (anterior à 0063): identidade NÃO comprovada — um save novo nunca
   * reusa essa linha, aposenta-a e cria versão própria.
   */
  credential_identity: string | null;
  /** A127: no máximo UMA por (wallet, exchange) — índice parcial único da 0063. */
  is_current:     boolean;
  /** A127: quando esta versão foi substituída por outra. `null` = nunca. */
  superseded_at:  string | null;
}

/**
 * O `db` opcional existe para os TESTES (banco-falso). Produção não passa
 * nada e cai no singleton — o padrão dos callers fica intacto.
 */
function cru(db?: unknown): ClienteCru | null {
  return (db === undefined ? getSupabaseAdmin() : db) as unknown as ClienteCru | null;
}

/**
 * Cria a conexão de uma carteira numa corretora — ou reusa a versão atual.
 *
 * ⚠️ SEM UPSERT (A127). O corpo é: identidade → cifra → RPC versionada. A
 * RPC decide, sob advisory lock do par: mesma identidade na current ativa →
 * devolve o MESMO id (só refresca `expires_at`); identidade diferente (ou
 * legacy com identity NULL, ou current revogada) → aposenta a atual e insere
 * versão nova com id NOVO. Um `id` nunca muda de conta.
 *
 * ⚠️ ENV DE HMAC AUSENTE = `{ ok:false }` E NADA GRAVADO. `identidadeDaConexao`
 * lança `server_configuration_error`; capturamos aqui porque uma linha sem
 * identity comprovada seria pior que nenhuma — e o erro sobe no retorno, não
 * num throw que a rota teria de adivinhar.
 *
 * ⚠️ DEVOLVE SE GRAVOU. Uma credencial que o dono acha que salvou e não existe
 * vira "plano parado sem motivo" três dias depois. Mesma lição do autopilot.
 */
export async function guardarConexao(input: {
  walletAddress: string;
  exchangeId:    string;
  credentials:   CexCredentials;
  expiresAt?:    string | null;
}, db?: unknown): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const banco = cru(db);
  if (!banco) return { ok: false, erro: "sem banco" };

  let identidade: string;
  try {
    identidade = identidadeDaConexao(input.exchangeId, {
      apiKey:     input.credentials.apiKey,
      apiSecret:  input.credentials.apiSecret,
      passphrase: input.credentials.passphrase,
    });
  } catch (e) {
    return { ok: false, erro: (e as Error).message.slice(0, 200) };
  }

  const cipher = encryptJson({
    apiKey:     input.credentials.apiKey,
    apiSecret:  input.credentials.apiSecret,
    passphrase: input.credentials.passphrase ?? null,
  });

  const { data, error } = await banco.rpc("cex_guardar_conexao_versionada", {
    p_wallet_address:      input.walletAddress,
    p_exchange_id:         input.exchangeId,
    p_creds_cipher:        cipher,
    p_credential_identity: identidade,
    p_expires_at:          input.expiresAt ?? null,
  });

  if (error || typeof data !== "string" || data.length === 0) {
    return { ok: false, erro: error?.message?.slice(0, 200) ?? "sem id" };
  }
  return { ok: true, id: data };
}

/**
 * A conexão CURRENT de uma carteira numa corretora, ou `null`.
 *
 * ⚠️ A127: com o versionamento há no máximo UMA `is_current` por par, e é
 * ELA que este leitor devolve. Versões aposentadas (históricas) NÃO se leem
 * por (wallet, exchange) — só por id, via `lerConexaoPorId`, porque quem as
 * referencia (intent, plano, sessão antiga) guarda o id da versão com que
 * nasceu.
 */
export async function lerConexao(
  walletAddress: string, exchangeId: string, db?: unknown,
): Promise<Conexao | null> {
  const banco = cru(db);
  if (!banco) return null;
  const { data, error } = await banco.from(TABELA)
    .select(COLUNAS)
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId)
    .eq("is_current", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as Conexao;
}

/**
 * ⚠️⚠️ TRÊS RESPOSTAS, NÃO DUAS — achado A115.
 *
 * Esta função devolvia `null` para "não existe", para "o banco recusou a
 * leitura" e para "não há banco configurado". Quem chamava caía no segredo
 * LEGADO nos três casos, e a propriedade que o cofre existe para dar — *uma
 * cópia do segredo, um lugar para revogar* — deixava de valer exatamente
 * quando o banco estava ruim.
 *
 *     `undefined`  não consegui olhar      → BLOQUEAR
 *     `null`       olhei e não existe      → BLOQUEAR
 *     `Conexao`    olhei e está aqui       → usar
 *
 * As duas primeiras bloqueiam; a diferença entre elas é de diagnóstico, não de
 * permissão. Fundi-las seria voltar ao defeito.
 *
 * A127: a semântica tri-state é INALTERADA; o select só ganhou as colunas de
 * versão. É o único leitor que alcança versões aposentadas — e é de propósito:
 * a reconciliação de um intent antigo precisa da versão com que ele nasceu.
 */
export async function lerConexaoPorId(
  id: string, db?: unknown,
): Promise<Conexao | null | undefined> {
  const banco = cru(db);
  if (!banco) return undefined;
  const { data, error } = await banco.from(TABELA)
    .select(COLUNAS)
    .eq("id", id).maybeSingle();
  if (error) return undefined;
  if (!data) return null;
  return data as Conexao;
}

/** Motivos de uma conexão NÃO servir para OPERAÇÃO NOVA (A127). */
export type MotivoConexaoInaptaParaExecucao =
  | "ilegivel"     // a leitura falhou — sobre dúvida de credencial, não se opera
  | "inexistente"  // o id não aponta para linha nenhuma
  | "revogada"     // o dono desligou — revogação alcança TODAS as versões do par
  | "substituida"; // aposentada (is_current=false): outra versão é a current

/**
 * A127 §68: a conexão para uma OPERAÇÃO NOVA (createOrder, ciclo de DCA).
 * Só serve se existe E está ativa E é a current — uma versão aposentada nunca
 * mais executa, mesmo ainda ativa para reconciliar o passado. "substituida" e
 * "revogada" são motivos DISTINTOS de propósito: quem foi substituído não
 * deve ser tratado (nem reportado) como revogado.
 */
export async function conexaoParaExecucao(
  id: string, db?: unknown,
): Promise<{ ok: true; conexao: Conexao } | { ok: false; motivo: MotivoConexaoInaptaParaExecucao }> {
  const c = await lerConexaoPorId(id, db);
  if (c === undefined) return { ok: false, motivo: "ilegivel" };
  if (c === null) return { ok: false, motivo: "inexistente" };
  if (!c.is_active) return { ok: false, motivo: "revogada" };
  if (!c.is_current) return { ok: false, motivo: "substituida" };
  return { ok: true, conexao: c };
}

/** Motivos de uma conexão NÃO servir nem para reconciliar (A127). */
export type MotivoConexaoInaptaParaReconciliacao =
  | "ilegivel" | "inexistente" | "revogada";

/**
 * A127 §19/§26: a conexão para RECONCILIAR um intent antigo. Basta
 * `is_active` — a versão APOSENTADA (retired) reconcilia, porque o intent foi
 * criado com a credencial DELA e só ela enxerga aquela ordem na corretora.
 * Revogada não reconcilia: revogar é o dono desligando a chave, e vale para
 * todas as versões.
 */
export async function conexaoParaReconciliacao(
  id: string, db?: unknown,
): Promise<{ ok: true; conexao: Conexao } | { ok: false; motivo: MotivoConexaoInaptaParaReconciliacao }> {
  const c = await lerConexaoPorId(id, db);
  if (c === undefined) return { ok: false, motivo: "ilegivel" };
  if (c === null) return { ok: false, motivo: "inexistente" };
  if (!c.is_active) return { ok: false, motivo: "revogada" };
  return { ok: true, conexao: c };
}

/**
 * A127 §25/§26: a credencial de RECOVERY de um intent, derivada do elo durável
 * `intent.conexao_id` — NUNCA da sessão (a sessão é mutável: após um rearm ela
 * aponta para a conexão NOVA, e reconciliar um intent da C1 com a credencial
 * da C2 é exatamente o ataque que o versionamento fecha).
 *
 * `conexao_id` nulo → `null`: intent legacy session-only ou manual NÃO herda
 * credencial nenhuma (fail-closed). E NUNCA LANÇA: revogada, inexistente,
 * ilegível ou cipher adulterado viram `null` — quem chama já trata "sem
 * credencial" como bloqueio.
 */
export async function credenciaisDoIntentParaRecovery(
  db: unknown,
  intent: { conexao_id?: string | null },
): Promise<CexCredentials | null> {
  if (!intent.conexao_id) return null;
  try {
    const r = await conexaoParaReconciliacao(intent.conexao_id, db);
    if (!r.ok) return null;
    return decifrarConexao(r.conexao);
  } catch {
    return null;
  }
}

/**
 * ⚠️ REVOGAR É AQUI, E VALE PARA OS DOIS PRODUTOS. É o ponto inteiro do cofre:
 * um lugar para desligar tudo que usa esta chave.
 *
 * A127 §17/§18: o update é por (wallet, exchange) SEM filtro de versão — ele
 * alcança a current E as aposentadas, e apaga `is_current` em todas. Uma
 * revogada não é "a conexão para novas operações" e o índice parcial fica
 * livre para o reconnect — que NUNCA ressuscita linha morta: nasce com id
 * novo (a RPC aposenta/ignora a revogada e insere versão nova).
 */
export async function revogarConexao(
  walletAddress: string, exchangeId: string, db?: unknown,
): Promise<boolean> {
  const banco = cru(db);
  if (!banco) return false;
  // ⚠️ OS DOIS FILTROS. A primeira versão deste código filtrava só pela
  // carteira e eu disfarcei o parâmetro sobrando com um `Boolean(exchangeId)`
  // sem sentido — revogaria TODAS as corretoras de quem quisesse desligar uma.
  // Um `as never` no nome da tabela custa a checagem que teria pego isso.
  const { error } = await banco.from(TABELA)
    .update({ is_active: false, is_current: false, atualizado_em: new Date().toISOString() })
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId);
  return !error;
}

/** Decifra. Lança em adulteração ou chave de cifra ausente — de propósito. */
export function decifrarConexao(c: Conexao): CexCredentials {
  const o = decryptJson<{ apiKey: string; apiSecret: string; passphrase: string | null }>(c.creds_cipher);
  return { apiKey: o.apiKey, apiSecret: o.apiSecret, passphrase: o.passphrase ?? undefined };
}
