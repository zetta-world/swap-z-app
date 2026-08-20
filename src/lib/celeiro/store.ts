/**
 * O CELEIRO NO BANCO — a camada que escreve o extrato e guarda o genoma.
 *
 * ⚠️ TODA REGRA DE DECISÃO VIVE NOS MÓDULOS PUROS (`fluxo.ts`, `aluguel.ts`,
 * `funding-colheita.ts`, ...). Aqui só há leitura e escrita. A separação é o que
 * permite testar a aritmética do dinheiro sem rede — e foi a falta dela que fez
 * a arena antiga ter regra de negócio dentro de rota de API, onde nenhum teste
 * alcança.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Causa, Braco, Fluxo } from "@/lib/celeiro/fluxo";

export interface LancamentoNovo {
  agente: string;
  causa: Causa;
  usdt: number;
  simbolo?: string | null;
  ref?: string | null;
  braco?: Braco | null;
  genomaVersao?: number | null;
  meta?: Record<string, unknown>;
}

/**
 * Escreve um lançamento no extrato.
 *
 * ⚠️ VALOR ZERO NÃO É GRAVADO. Um extrato cheio de zeros esconde os lançamentos
 * que importam e faz a contagem de amostra do A/B mentir: vinte ticks de juro
 * zero pareceriam vinte observações, e o `julgarMutacao` liberaria um veredito
 * sobre nada.
 */
export async function registrarFluxo(
  db: SupabaseClient,
  l: LancamentoNovo,
): Promise<boolean> {
  if (!Number.isFinite(l.usdt) || l.usdt === 0) return false;
  const { error } = await db.from("celeiro_fluxos").insert({
    agente: l.agente,
    causa: l.causa,
    usdt: l.usdt,
    simbolo: l.simbolo ?? null,
    ref: l.ref ?? null,
    braco: l.braco ?? null,
    genoma_versao: l.genomaVersao ?? null,
    meta: l.meta ?? {},
  });
  return !error;
}

/**
 * O instante do último lançamento de uma causa, para o agente.
 *
 * ⚠️ ISTO NÃO É O RELÓGIO — para isso existe `lerRelogio`. A diferença importa:
 * este devolve quando o agente MOVEU DINHEIRO daquela causa; o relógio devolve
 * quando ele foi VISTO. Um agente pode ser visto vinte vezes sem mover nada, e
 * confundir as duas coisas foi o que quase me fez gravar lançamentos falsos de
 * `1e-9` USDT só para marcar tempo.
 *
 * Serve para responder perguntas sobre a posição — "a Colheita já entrou?",
 * "quando foi o último funding?" — onde a resposta certa é sobre o dinheiro.
 */
export async function ultimoLancamentoMs(
  db: SupabaseClient,
  agente: string,
  causa: Causa,
): Promise<number | null> {
  // leitura-limitada: só a linha mais recente — é um relógio, não um histórico.
  const { data } = await db
    .from("celeiro_fluxos")
    .select("ocorreu_em")
    .eq("agente", agente).eq("causa", causa)
    .order("ocorreu_em", { ascending: false })
    .limit(1);
  const t = data?.[0]?.ocorreu_em;
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

export interface Genoma {
  versao: number;
  params: Record<string, unknown>;
  autor: string;
  hipotese: string | null;
}

/**
 * O genoma ativo do agente, semeando a v1 quando ele nasce.
 *
 * ⚠️ A SEMENTE TEM AUTOR `"nascimento"` E HIPÓTESE NULA, de propósito. Ela não é
 * uma mutação e não deve entrar no placar de nenhum modelo — atribuí-la a
 * alguém daria crédito por uma escolha que ninguém propôs.
 */
export async function genomaAtivo(
  db: SupabaseClient,
  agente: string,
  semente: Record<string, unknown>,
): Promise<Genoma | null> {
  // leitura-limitada: existe no máximo um genoma ativo por agente (índice parcial).
  const { data } = await db
    .from("celeiro_genoma")
    .select("versao, params, autor, hipotese")
    .eq("agente", agente).eq("ativo", true)
    .limit(1);

  const atual = data?.[0];
  if (atual) {
    return {
      versao: atual.versao,
      params: (atual.params ?? {}) as Record<string, unknown>,
      autor: atual.autor,
      hipotese: atual.hipotese ?? null,
    };
  }

  const { error } = await db.from("celeiro_genoma").insert({
    agente, versao: 1, params: semente, autor: "nascimento", hipotese: null, ativo: true,
  });
  if (error) return null;
  return { versao: 1, params: semente, autor: "nascimento", hipotese: null };
}

/**
 * Os fluxos de um agente desde um instante — o insumo do Investigador.
 *
 * ⚠️ JANELA EXPLÍCITA, e não "tudo". Um extrato que cresce sem limite acabaria
 * pedindo ao modelo para raciocinar sobre um ano de lançamentos em que o genoma
 * mudou seis vezes — misturando efeitos de parâmetros diferentes na mesma conta.
 */
export async function fluxosDesde(
  db: SupabaseClient,
  agente: string,
  desdeMs: number,
): Promise<Fluxo[]> {
  // leitura-limitada: uma janela por agente; o teto protege o caso patológico.
  const { data } = await db
    .from("celeiro_fluxos")
    .select("agente, causa, usdt, ocorreu_em, braco, genoma_versao")
    .eq("agente", agente)
    .gte("ocorreu_em", new Date(desdeMs).toISOString())
    .order("ocorreu_em", { ascending: true })
    .limit(5_000);

  return (data ?? []).map((r) => ({
    agente: r.agente,
    causa: r.causa as Causa,
    usdt: Number(r.usdt) || 0,
    ocorreuEmMs: Date.parse(r.ocorreu_em),
    braco: r.braco as Braco | null,
    genomaVersao: r.genoma_versao,
  }));
}

/**
 * O RELÓGIO DO AGENTE — quando ele foi visto pela última vez.
 *
 * ⚠️⚠️ POR QUE O RELÓGIO NÃO MORA NO EXTRATO. A primeira versão marcava o
 * instante inicial gravando um lançamento de `1e-9` USDT. Funcionava, e era
 * gambiarra: um lançamento falso no livro do dinheiro, que daqui a três meses
 * ninguém entenderia e que a contagem de amostra do A/B leria como observação
 * real.
 *
 * O extrato guarda DINHEIRO. Relógio não é dinheiro. Ele vai para o `admin_kv`,
 * onde já vivem os outros marcadores de estado da casa.
 *
 * ⚠️ E É POR ISSO QUE O CONTROLE SAI DO ZERO. Sem um relógio separado,
 * `ultimoLancamentoMs` devolveria `null` para sempre no primeiro tick (nada foi
 * creditado, logo nada foi escrito, logo nada a comparar) — e o piso ficaria
 * congelado em zero, fazendo TODO agente parecer vencedor.
 */
export async function lerRelogio(db: SupabaseClient, chave: string): Promise<number | null> {
  // leitura-limitada: uma chave só — é um relógio, não um histórico.
  const { data } = await db.from("admin_kv").select("value").eq("key", `celeiro:relogio:${chave}`).limit(1);
  const v = Number(data?.[0]?.value);
  return Number.isFinite(v) ? v : null;
}

export async function marcarRelogio(db: SupabaseClient, chave: string, ms: number): Promise<void> {
  await db.from("admin_kv").upsert(
    { key: `celeiro:relogio:${chave}`, value: String(ms), updated_at: new Date(ms).toISOString() },
    { onConflict: "key" },
  );
}
