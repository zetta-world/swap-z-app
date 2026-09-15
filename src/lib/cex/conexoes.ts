import { getSupabaseAdmin } from "@/lib/supabase/server";
import { encryptJson, decryptJson } from "@/lib/crypto/secretbox";
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
        eq: (c: string, v: unknown) => { maybeSingle: () => Promise<Resposta<unknown>> };
        maybeSingle: () => Promise<Resposta<unknown>>;
      };
    };
    upsert: (v: unknown, o: { onConflict: string }) => {
      select: (c: string) => { single: () => Promise<Resposta<{ id: string }>> };
    };
    update: (v: unknown) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => Promise<Resposta<unknown>>;
      } & Promise<Resposta<unknown>>;
    };
  };
};
const TABELA = "cex_conexoes" as never;

export interface Conexao {
  id:             string;
  wallet_address: string;
  exchange_id:    string;
  creds_cipher:   string;
  /** `null` = sem prazo duro. Cada produto aplica a própria política. */
  expires_at:     string | null;
  is_active:      boolean;
}

function cru(): ClienteCru | null {
  return getSupabaseAdmin() as unknown as ClienteCru | null;
}

/**
 * Cria ou atualiza a conexão de uma carteira numa corretora.
 *
 * ⚠️ DEVOLVE SE GRAVOU. Uma credencial que o dono acha que salvou e não existe
 * vira "plano parado sem motivo" três dias depois. Mesma lição do autopilot.
 */
export async function guardarConexao(input: {
  walletAddress: string;
  exchangeId:    string;
  credentials:   CexCredentials;
  expiresAt?:    string | null;
}): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem banco" };

  const cipher = encryptJson({
    apiKey:     input.credentials.apiKey,
    apiSecret:  input.credentials.apiSecret,
    passphrase: input.credentials.passphrase ?? null,
  });

  const { data, error } = await db.from(TABELA).upsert({
    wallet_address: input.walletAddress,
    exchange_id:    input.exchangeId,
    creds_cipher:   cipher,
    expires_at:     input.expiresAt ?? null,
    is_active:      true,
    atualizado_em:  new Date().toISOString(),
  }, { onConflict: "wallet_address,exchange_id" }).select("id").single();

  if (error || !data?.id) return { ok: false, erro: error?.message?.slice(0, 200) ?? "sem id" };
  return { ok: true, id: data.id };
}

/** A conexão de uma carteira numa corretora, ou `null`. */
export async function lerConexao(walletAddress: string, exchangeId: string): Promise<Conexao | null> {
  const db = cru();
  if (!db) return null;
  const { data, error } = await db.from(TABELA)
    .select("id, wallet_address, exchange_id, creds_cipher, expires_at, is_active")
    .eq("wallet_address", walletAddress).eq("exchange_id", exchangeId).maybeSingle();
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
 */
export async function lerConexaoPorId(id: string): Promise<Conexao | null | undefined> {
  const db = cru();
  if (!db) return undefined;
  const { data, error } = await db.from(TABELA)
    .select("id, wallet_address, exchange_id, creds_cipher, expires_at, is_active")
    .eq("id", id).maybeSingle();
  if (error) return undefined;
  if (!data) return null;
  return data as Conexao;
}

/**
 * ⚠️ REVOGAR É AQUI, E VALE PARA OS DOIS PRODUTOS. É o ponto inteiro do cofre:
 * um lugar para desligar tudo que usa esta chave.
 */
export async function revogarConexao(walletAddress: string, exchangeId: string): Promise<boolean> {
  const db = cru();
  if (!db) return false;
  // ⚠️ OS DOIS FILTROS. A primeira versão deste código filtrava só pela
  // carteira e eu disfarcei o parâmetro sobrando com um `Boolean(exchangeId)`
  // sem sentido — revogaria TODAS as corretoras de quem quisesse desligar uma.
  // Um `as never` no nome da tabela custa a checagem que teria pego isso.
  const { error } = await db.from(TABELA)
    .update({ is_active: false, atualizado_em: new Date().toISOString() })
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId);
  return !error;
}

/** Decifra. Lança em adulteração ou chave de cifra ausente — de propósito. */
export function decifrarConexao(c: Conexao): CexCredentials {
  const o = decryptJson<{ apiKey: string; apiSecret: string; passphrase: string | null }>(c.creds_cipher);
  return { apiKey: o.apiKey, apiSecret: o.apiSecret, passphrase: o.passphrase ?? undefined };
}
