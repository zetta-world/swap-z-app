import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Mensagem } from "./mensagem";

/**
 * EINHERJAR — a caixa entre o dono e os agentes.
 * (`docs/PLANO-EINHERJAR.md`)
 *
 * ⚠️⚠️ POR QUE ESTA TABELA NÃO ESTÁ NO TIPO `Database` (23/08).
 *
 * Ela seria a 20ª entrada de `lib/supabase/types.ts`, e a 20ª estoura a
 * profundidade de inferência do supabase-js: ao registrá-la, o `type-check`
 * quebrou em DOIS ARQUIVOS QUE NINGUÉM TOCOU — `zion/sniper.ts` e `zion/ullr.ts`
 * — porque `zion_suggestions` passou a resolver como `never`.
 *
 * Isolado em dois testes: remover a entrada faz os erros sumirem; mantê-la na
 * forma mais simples possível NÃO faz. É a CONTAGEM, não a forma. E o
 * TypeScript degrada EM SILÊNCIO: ele não avisa "limite atingido", ele resolve
 * outras tabelas como `never`.
 *
 * ⚠️ ENTÃO O CAST AQUI NÃO É PREGUIÇA — é contenção. Registrar a tabela
 * derrubaria a tipagem de tabelas que movem dinheiro (`zion_suggestions` é a
 * fila de sugestões das mesas). Trocar a segurança de tipo DELAS pela desta
 * caixa de recados seria péssimo negócio.
 *
 * ⚠️ E O TETO CONTINUA LÁ. Quem adicionar a próxima tabela ao `Database` vai
 * ver o build quebrar em `sniper.ts` e procurar ali. O conserto é a §7.1 do
 * plano, e merece PR próprio: `types.ts` é usado pelas DUAS sessões.
 */

/**
 * ⚠️ O cliente sem o genérico do `Database`, restrito a ESTA tabela.
 *
 * O `as never` é a menor superfície possível: só o nome da tabela escapa da
 * checagem, e as linhas voltam tipadas como `Mensagem` logo abaixo.
 */
type ClienteCru = { from: (t: never) => {
  select: (c: string) => Promise<{ data: unknown; error: { message: string } | null }> & {
    order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }> };
  };
  insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
} };

const TABELA = "einherjar_mensagens" as never;

/**
 * ⚠️ SÓ O QUE TOCA O BANCO MORA AQUI — e por isso este módulo NUNCA pode ser
 * importado por componente cliente. `estadoDa`, `faz`, `interlocutorValido` e o
 * tipo `Mensagem` estão em `./mensagem`, que não importa nada de servidor.
 * Reexportados abaixo só para o lado servidor, que já paga o import de qualquer
 * jeito.
 */
export {
  INTERLOCUTORES, interlocutorValido, estadoDa, faz,
} from "./mensagem";
export type { Mensagem, Interlocutor, EstadoMensagem } from "./mensagem";

/** As mensagens mais recentes. Melhor-esforço: sem banco, devolve vazio. */
export async function lerMensagens(limite = 50): Promise<Mensagem[]> {
  const db = getSupabaseAdmin() as unknown as ClienteCru | null;
  if (!db) return [];
  const { data, error } = await db.from(TABELA)
    .select("*").order("criado_em", { ascending: false }).limit(limite);
  if (error || !Array.isArray(data)) return [];
  return data as Mensagem[];
}

/**
 * Grava uma pergunta.
 *
 * ⚠️ DEVOLVE SE GRAVOU — a mesma lição do autopilot de hoje: o cliente do
 * Supabase RESOLVE com `{ error }` em vez de lançar, e uma pergunta que o dono
 * acha que fez e não existe é pior que um erro na cara dele.
 */
export async function escreverMensagem(m: {
  de: string; para: string; assunto: string; corpo: string;
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const db = getSupabaseAdmin() as unknown as ClienteCru | null;
  if (!db) return { ok: false, erro: "sem banco" };
  const { error } = await db.from(TABELA).insert({
    de: m.de, para: m.para, assunto: m.assunto.slice(0, 200), corpo: m.corpo.slice(0, 4000),
  });
  return error ? { ok: false, erro: error.message.slice(0, 200) } : { ok: true };
}
