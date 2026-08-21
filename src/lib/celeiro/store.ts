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

/* ───────────────────────── POSIÇÕES ───────────────────────── */

import {
  lancamentosDaAbertura, lancamentosDoFechamento, deveFechar, conferir,
  type Abertura, type Fechamento,
} from "@/lib/celeiro/posicao";

export interface PosicaoAberta extends Abertura {
  id: string;
  abertaEmMs: number;
  genomaVersao: number | null;
  /**
   * O que o agente guardou ao abrir — endereço do pool, cadeia, o porquê.
   *
   * ⚠️ VEM JUNTO NA MESMA CONSULTA, de propósito. A primeira versão buscava o
   * `meta` de cada posição separadamente para achar o endereço do pool: N+1
   * consultas num cron com `maxDuration` de 60s, e o custo apareceria como tick
   * morrendo no meio, não como erro.
   */
  meta: Record<string, unknown>;
}

/** As posições que o agente ainda tem em pé. */
export async function posicoesAbertas(
  db: SupabaseClient,
  agente: string,
): Promise<PosicaoAberta[]> {
  // leitura-limitada: só as abertas de um agente; o teto protege o patológico.
  const { data } = await db
    .from("celeiro_posicoes")
    .select("id, agente, simbolo, lado, usd, preco_entrada, alvo, stop, horas_limite, derrapagem_pct, aberta_em, genoma_versao, meta")
    .eq("agente", agente).is("fechada_em", null)
    .limit(100);

  return (data ?? []).map((r) => ({
    id: r.id, agente: r.agente, simbolo: r.simbolo, lado: r.lado,
    usd: Number(r.usd), precoEntrada: Number(r.preco_entrada),
    alvo: Number(r.alvo), stop: Number(r.stop),
    horasLimite: Number(r.horas_limite), derrapagemPct: Number(r.derrapagem_pct),
    abertaEmMs: Date.parse(r.aberta_em), genomaVersao: r.genoma_versao,
    meta: (r.meta ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Abre a posição E grava os lançamentos dela.
 *
 * ⚠️ A POSIÇÃO ENTRA PRIMEIRO. Se o registro falhar, nenhum lançamento é escrito
 * — um extrato com taxa de uma posição que não existe seria dinheiro saindo sem
 * dono, e nunca fecharia com nada.
 */
export async function abrirPosicao(
  db: SupabaseClient,
  a: Abertura,
  genomaVersao: number | null,
  meta: Record<string, unknown> = {},
): Promise<string | null> {
  const { data, error } = await db.from("celeiro_posicoes").insert({
    agente: a.agente, simbolo: a.simbolo, lado: a.lado, usd: a.usd,
    preco_entrada: a.precoEntrada, alvo: a.alvo, stop: a.stop,
    horas_limite: a.horasLimite, derrapagem_pct: a.derrapagemPct,
    genoma_versao: genomaVersao, meta,
  }).select("id").limit(1);

  const id = data?.[0]?.id as string | undefined;
  if (error || !id) return null;

  for (const l of lancamentosDaAbertura(a)) {
    await registrarFluxo(db, {
      agente: a.agente, causa: l.causa, usdt: l.usdt, simbolo: a.simbolo,
      ref: `abertura:${id}`, genomaVersao, meta: { posicao: id },
    });
  }
  return id;
}

/**
 * Fecha a posição, grava o movimento e a segunda perna.
 *
 * ⚠️⚠️ A CONTA É CONFERIDA ANTES DE GRAVAR. Se a decomposição não reproduz o
 * dinheiro movido, NADA é escrito e a posição fica aberta com o motivo no
 * evento. Vale travar o agente em vez de gravar uma conta que não fecha: o
 * extrato é a base do ranking, da comparação com o controle e do Investigador —
 * se ele mente, os três raciocinam sobre ficção.
 */
export async function fecharPosicao(
  db: SupabaseClient,
  p: PosicaoAberta,
  f: Fechamento,
): Promise<{ fechou: boolean; porque: string }> {
  const c = conferir(p, f);
  if (!c.bate) return { fechou: false, porque: c.porque };

  const { error } = await db.from("celeiro_posicoes").update({
    fechada_em: new Date().toISOString(),
    preco_saida: f.precoSaida, motivo_saida: f.motivo,
  }).eq("id", p.id).is("fechada_em", null);
  if (error) return { fechou: false, porque: `não consegui marcar o fechamento: ${error.message}` };

  for (const l of lancamentosDoFechamento(p, f)) {
    await registrarFluxo(db, {
      agente: p.agente, causa: l.causa, usdt: l.usdt, simbolo: p.simbolo,
      ref: `fechamento:${p.id}`, genomaVersao: p.genomaVersao,
      meta: { posicao: p.id, motivo: f.motivo, precoSaida: f.precoSaida },
    });
  }
  return { fechou: true, porque: `${f.motivo} em ${f.precoSaida}` };
}

/** Varre as abertas de um agente e fecha as que devem fechar. */
export async function varrerAbertas(
  db: SupabaseClient,
  agente: string,
  precoDe: (simbolo: string) => number | null,
  agoraMs: number,
): Promise<Array<{ simbolo: string; fechou: boolean; porque: string }>> {
  const out: Array<{ simbolo: string; fechou: boolean; porque: string }> = [];
  for (const p of await posicoesAbertas(db, agente)) {
    const preco = precoDe(p.simbolo);
    if (preco === null) {
      // ⚠️ Sem preço a posição SEGUE ABERTA. Fechar no escuro inventaria saída.
      out.push({ simbolo: p.simbolo, fechou: false, porque: "sem preço — segue aberta" });
      continue;
    }
    const horas = (agoraMs - p.abertaEmMs) / 3_600_000;
    const f = deveFechar(p, preco, horas);
    if (!f) continue;
    const r = await fecharPosicao(db, p, f);
    out.push({ simbolo: p.simbolo, ...r });
  }
  return out;
}
