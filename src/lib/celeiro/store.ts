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
import { genomaAbre } from "@/lib/celeiro/sementes";

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
 * O genoma da versão ANTERIOR à ativa — os parâmetros do braço de CONTROLE.
 *
 * ⚠️⚠️ SEM ISTO O A/B TINHA UM BRAÇO SÓ (29/08). O esquema declara em texto que
 * `controle` roda **sem** a mutação, mas o cron lia `genomaAtivo` para os dois
 * braços: `controle` e `mutacao` abriam com a MESMA geometria, e o rótulo era
 * decorativo. Duas mutações foram julgadas comparando duas metades da mesma
 * coisa — e cada "pagou" fixou um parâmetro que nunca foi testado.
 *
 * ⚠️ DEVOLVE `null` QUANDO NÃO HÁ ANTERIOR, e quem chama tem de tratar isso
 * PARANDO o A/B, não caindo no genoma ativo. Cair no ativo é exatamente o
 * defeito de origem: dois braços iguais com nomes diferentes.
 */
export async function genomaAnterior(
  db: SupabaseClient,
  agente: string,
  versaoAtiva: number | null | undefined,
): Promise<Genoma | null> {
  if (versaoAtiva == null) return null;
  // leitura-limitada: a versão imediatamente abaixo da ativa.
  const { data } = await db
    .from("celeiro_genoma")
    .select("versao, params, autor, hipotese")
    .eq("agente", agente).lt("versao", versaoAtiva)
    .order("versao", { ascending: false }).limit(1);

  const g = data?.[0];
  if (!g) return null;
  return {
    versao: g.versao,
    params: (g.params ?? {}) as Record<string, unknown>,
    autor: g.autor,
    hipotese: g.hipotese ?? null,
  };
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
    // ⚠️ `ref` sobe agora: o piso do A/B conta OPERAÇÕES, e sem ele só dava
    // para contar linhas de extrato — 3 a 4 por posição. Ver `operacoesDistintas`.
    .select("agente, causa, usdt, ocorreu_em, braco, genoma_versao, ref")
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
    ref: r.ref,
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
  /** O braço do A/B a que esta posição pertence — viaja até os fluxos dela. */
  braco: Braco | null;
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
/**
 * A alavanca guardada no `meta`, com 1× como piso.
 *
 * ⚠️ NA DÚVIDA, 1×. Um `meta` sem alavanca é uma posição antiga, aberta antes
 * do campo existir — e tratá-la como alavancada inventaria uma liquidação que
 * o agente nunca contratou.
 */
export function alavancaDoMeta(meta: Record<string, unknown>): number {
  const v = Number(meta?.alavanca);
  return Number.isFinite(v) && v >= 1 ? v : 1;
}

/**
 * A taxa por perna com que a posição foi ABERTA.
 *
 * ⚠️⚠️ SEM ISTO A POSIÇÃO FECHA COM OUTRA RÉGUA. A perna de abertura já foi
 * gravada com a taxa da praça do agente; se o fechamento cair no valor legado,
 * a mesma operação registra DUAS taxas diferentes e o extrato dela deixa de
 * reproduzir o dinheiro movido. `conferir` não pegaria: ele recalcula as duas
 * pernas do mesmo objeto, então seria coerente consigo mesmo e errado com o
 * banco — a pior combinação possível.
 *
 * Ausente = posição anterior a 23/08, que pagou a legada dos dois lados.
 */
export function taxaPernaDoMeta(meta: Record<string, unknown>): number | undefined {
  const v = Number(meta?.taxaPernaPct);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** A margem comprometida por uma posição — o nocional dividido pela alavanca. */
export function margemDa(p: { usd: number; alavanca?: number }): number {
  const v = p.alavanca ?? 1;
  return v >= 1 ? p.usd / v : p.usd;
}

/**
 * O SALDO de um agente — o dinheiro que ele REALMENTE tem agora.
 *
 * ⚠️⚠️ POR QUE ISTO PRECISOU EXISTIR (24/08). Até aqui não havia capital no
 * Celeiro: havia `bancaUsd: 1000`, um literal repetido cinco vezes num arquivo
 * `.ts`. O prejuízo NUNCA reduzia a banca. O Alavancado de Tendência queimou
 * $53,17 e seguia dimensionando posição como se tivesse $1.000 intactos.
 *
 * Três coisas que isso quebrava, todas silenciosamente:
 *
 *  · **Ruína era impossível.** Um agente podia perder infinito e continuar
 *    operando no tamanho cheio, para sempre.
 *  · **`capitalMinimoUsd` nunca disparava** — ele comparava contra a constante,
 *    e a constante não se move.
 *  · **Não havia composição.** Ganhar não aumentava o tamanho da próxima
 *    aposta, então o placar não media o que a estratégia realmente faria.
 *
 * ⚠️ O saldo sai do LEDGER, não de uma tabela nova. `celeiro_fluxos` já registra
 * cada centavo que entrou e saiu, decomposto por causa — inventar uma segunda
 * fonte de verdade para o mesmo número criaria duas contas que podem divergir,
 * e a divergência apareceria como dinheiro que ninguém sabe de onde veio.
 */
export interface Saldo {
  /** O dinheiro agora: inicial + tudo que o extrato lançou. */
  usd: number;
  bancaInicialUsd: number;
  realizadoUsd: number;
  lancamentos: number;
  /**
   * ⚠️⚠️ A SOMA PODE ESTAR INCOMPLETA. Se bateu no teto de leitura, este saldo
   * é MAIOR que o real (faltam lançamentos, e a maioria é negativa). Dimensionar
   * posição com ele apostaria dinheiro que não existe — quem recebe isto tem de
   * RECUSAR a operação, não seguir com o número otimista.
   */
  truncado: boolean;
}

const TETO_DE_LANCAMENTOS = 50_000;

export async function saldoDoAgente(
  db: SupabaseClient,
  agente: string,
  bancaInicialUsd: number,
): Promise<Saldo> {
  const { data, error } = await db
    .from("celeiro_fluxos")
    .select("usdt")
    .eq("agente", agente)
    .limit(TETO_DE_LANCAMENTOS);

  /**
   * ⚠️ ERRO DE LEITURA NÃO VIRA SALDO CHEIO. Devolver a banca inicial num erro
   * faria um agente quebrado parecer intacto — e ele abriria posição com
   * dinheiro imaginário. Marca truncado e quem chama recusa.
   */
  if (error || !data) {
    return {
      usd: bancaInicialUsd, bancaInicialUsd, realizadoUsd: 0,
      lancamentos: 0, truncado: true,
    };
  }

  const realizadoUsd = data.reduce((s, r) => s + (Number(r.usdt) || 0), 0);
  return {
    usd: bancaInicialUsd + realizadoUsd,
    bancaInicialUsd,
    realizadoUsd,
    lancamentos: data.length,
    truncado: data.length >= TETO_DE_LANCAMENTOS,
  };
}

export async function posicoesAbertas(
  db: SupabaseClient,
  agente: string,
): Promise<PosicaoAberta[]> {
  // leitura-limitada: só as abertas de um agente; o teto protege o patológico.
  const { data } = await db
    .from("celeiro_posicoes")
    .select("id, agente, simbolo, lado, usd, preco_entrada, alvo, stop, horas_limite, derrapagem_pct, aberta_em, genoma_versao, braco, meta")
    .eq("agente", agente).is("fechada_em", null)
    .limit(100);

  return (data ?? []).map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    return {
      id: r.id, agente: r.agente, simbolo: r.simbolo, lado: r.lado,
      usd: Number(r.usd), precoEntrada: Number(r.preco_entrada),
      alvo: Number(r.alvo), stop: Number(r.stop),
      horasLimite: Number(r.horas_limite), derrapagemPct: Number(r.derrapagem_pct),
      /**
       * ⚠️ A ALAVANCA VOLTA DO `meta`, não de uma coluna. Sem ela aqui,
       * `deveFechar` receberia `undefined`, assumiria 1× e a posição
       * alavancada nunca liquidaria — o defeito exato que 23/08 corrigiu.
       */
      alavanca: alavancaDoMeta(meta),
      taxaPernaPct: taxaPernaDoMeta(meta),
      abertaEmMs: Date.parse(r.aberta_em), genomaVersao: r.genoma_versao,
      braco: (r.braco ?? null) as Braco | null,
      meta,
    };
  });
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
  /**
   * ⚠️⚠️ O BRAÇO PRECISA CHEGAR AOS FLUXOS, não só à posição. `julgarMutacao`
   * lê FLUXOS — se o rótulo ficasse só na linha da posição, os dois braços
   * apareceriam vazios e todo veredito sairia "inconclusiva" para sempre, com
   * o A/B parecendo funcionar.
   */
  braco: Braco | null = null,
): Promise<string | null> {
  const { data, error } = await db.from("celeiro_posicoes").insert({
    agente: a.agente, simbolo: a.simbolo, lado: a.lado, usd: a.usd,
    preco_entrada: a.precoEntrada, alvo: a.alvo, stop: a.stop,
    horas_limite: a.horasLimite, derrapagem_pct: a.derrapagemPct,
    genoma_versao: genomaVersao, braco, meta,
  }).select("id").limit(1);

  const id = data?.[0]?.id as string | undefined;
  if (error || !id) return null;

  for (const l of lancamentosDaAbertura(a)) {
    await registrarFluxo(db, {
      agente: a.agente, causa: l.causa, usdt: l.usdt, simbolo: a.simbolo,
      ref: `abertura:${id}`, genomaVersao, braco, meta: { posicao: id },
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
      ref: `fechamento:${p.id}`, genomaVersao: p.genomaVersao, braco: p.braco,
      meta: { posicao: p.id, motivo: f.motivo, precoSaida: f.precoSaida },
    });
  }
  return { fechou: true, porque: `${f.motivo} em ${f.precoSaida}` };
}

/**
 * ⚠️⚠️ QUEM TEM POSIÇÃO ABERTA — perguntado à TABELA, não ao registro.
 *
 * A CICATRIZ (23/08): o `maker_de_faixa` foi apagado do registro quando a
 * autópsia condenou a estratégia — e deixou DUAS posições abertas. O varredor é
 * chamado por agente nomeado, numa lista escrita à mão no cron, e o Maker não
 * estava em nenhuma. Resultado: $100 congelados, uma posição parada EXATAMENTE
 * em cima do stop e 3,4h além do limite de 8h, sem ninguém para fechá-la.
 *
 * E o estrago não é o dinheiro: a autópsia que MATOU o agente é calculada sobre
 * posições fechadas. Essas duas nunca entrariam — o número que justificou a
 * decisão ficaria permanentemente incompleto.
 *
 * ⚠️ `deveFechar` só usa campos da própria linha (lado, alvo, stop, horas
 * limite). Fechar NUNCA precisou do registro — era a lista que precisava.
 */
export async function agentesComAbertas(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from("celeiro_posicoes")
    .select("agente")
    .is("fechada_em", null);
  if (error || !data) return [];
  return [...new Set(data.map((r) => String((r as { agente: string }).agente)))];
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

/* ───────────────────────── MUTAÇÕES ───────────────────────── */

export interface MutacaoNova {
  agente: string;
  modelo: string;
  hipotese: string;
  diff: Record<string, unknown>;
  esperado: string;
}

/** Grava a proposta. Ela ainda NÃO é aplicada — isso é decisão separada. */
export async function registrarMutacao(db: SupabaseClient, m: MutacaoNova): Promise<string | null> {
  const { data, error } = await db.from("celeiro_mutacoes").insert({
    agente: m.agente, modelo: m.modelo, hipotese: m.hipotese,
    diff: m.diff, esperado: m.esperado,
  }).select("id").limit(1);
  return error ? null : (data?.[0]?.id as string | undefined) ?? null;
}

export interface MutacaoEmCurso {
  id: string; agente: string; modelo: string;
  diff: Record<string, unknown>; esperado: string; hipotese: string;
  aplicadaEmMs: number | null;
}

/**
 * A mutação que está EM TESTE neste agente — aplicada e ainda não julgada.
 *
 * ⚠️ UMA POR AGENTE, e o `limit(1)` não é economia: duas mutações vivas ao mesmo
 * tempo tornariam o A/B ilegível, porque o braço `mutacao` carregaria as duas e
 * ninguém saberia qual pagou. É a mesma razão de o validador recusar diff com
 * dois parâmetros.
 */
export async function mutacaoEmCurso(db: SupabaseClient, agente: string): Promise<MutacaoEmCurso | null> {
  // leitura-limitada: no máximo uma mutação viva por agente, por construção.
  const { data } = await db.from("celeiro_mutacoes")
    .select("id, agente, modelo, diff, esperado, hipotese, aplicada_em")
    .eq("agente", agente).not("aplicada_em", "is", null).is("avaliada_em", null)
    .order("aplicada_em", { ascending: false }).limit(1);
  const r = data?.[0];
  if (!r) return null;
  return {
    id: r.id, agente: r.agente, modelo: r.modelo,
    diff: (r.diff ?? {}) as Record<string, unknown>,
    esperado: r.esperado, hipotese: r.hipotese,
    aplicadaEmMs: r.aplicada_em ? Date.parse(r.aplicada_em) : null,
  };
}

/**
 * Aplica a mutação: nova versão do genoma, com autor e hipótese.
 *
 * ⚠️ A VERSÃO ANTERIOR NÃO É APAGADA — só perde o `ativo`. Reverter é reativar,
 * não reconstruir; e o par (hipótese, resultado) fica no registro inclusive
 * quando falha, porque hipótese refutada é informação.
 */
export type MutacaoAplicada =
  | { ok: true; versao: number }
  | { ok: false; motivo: "impossivel"; porque: string }
  | { ok: false; motivo: "escrita"; porque: string };

export async function aplicarMutacao(
  db: SupabaseClient, mutacaoId: string, agente: string,
  paramsNovos: Record<string, unknown>, modelo: string, hipotese: string,
): Promise<MutacaoAplicada> {
  /**
   * ⚠️⚠️ O PORTÃO ANTES DA ESCRITA (05/09), e ele custou dois dias de A/B vazio.
   *
   * Em 03/09 o modelo aplicou `multiploDoPedagio` 6 → 12 no Maker — raciocínio
   * legítimo, já que 87,9% do prejuízo era taxa. Mas múltiplo 12 sobre pedágio
   * de 0,40% exige alvo de 4,80%, e o genoma declarava 2,50%. O agente parou de
   * abrir e ninguém soube: **0 posições, 0 fluxos no braço da mutação, 9 no
   * controle**, e o A/B a caminho de concluir que a mutação "não pagou".
   *
   * Um genoma que o portão de pedágio SEMPRE recusa não é uma hipótese ruim —
   * é uma hipótese que não pode ser testada. Ela é recusada aqui, com o motivo
   * gravado na própria mutação, em vez de descoberta dias depois no banco.
   */
  const portao = genomaAbre(agente, paramsNovos);
  if (portao && !portao.abre) {
    const porque = `genoma recusado ANTES de entrar no ar: ${portao.porque}`;
    /**
     * ⚠️ A RECUSA VIRA REGISTRO, não silêncio. `avaliada_em` fecha a mutação
     * sem `aplicada_em` — ela nunca esteve no ar, então não há A/B para julgar,
     * e o placar do modelo não deve ser penalizado por uma ideia que a arena
     * não deixou testar.
     */
    await db.from("celeiro_mutacoes").update({
      avaliada_em: new Date().toISOString(),
      veredito: "inconclusiva",
      porque,
    }).eq("id", mutacaoId);
    return { ok: false, motivo: "impossivel", porque };
  }

  const { data: atual } = await db.from("celeiro_genoma")
    .select("versao").eq("agente", agente).order("versao", { ascending: false }).limit(1);
  const versao = (Number(atual?.[0]?.versao) || 0) + 1;

  await db.from("celeiro_genoma").update({ ativo: false }).eq("agente", agente).eq("ativo", true);
  const { error } = await db.from("celeiro_genoma").insert({
    agente, versao, params: paramsNovos, autor: modelo, hipotese, ativo: true,
  });
  // ⚠️ `supabase-js` resolve com `{ data: null, error }` — não lança.
  if (error) return { ok: false, motivo: "escrita", porque: error.message.slice(0, 200) };

  await db.from("celeiro_mutacoes").update({ aplicada_em: new Date().toISOString() }).eq("id", mutacaoId);
  return { ok: true, versao };
}

/**
 * O que o fechamento conseguiu fazer — para quem chama poder CONFERIR.
 *
 * ⚠️ As três respostas boas são diferentes entre si e antes liam todas igual:
 * "reativei a versão N", "não pedi reversão" e "não havia versão anterior" não
 * são o mesmo fato, e nenhuma delas é "falhou".
 */
export type FechamentoDaMutacao =
  | { ok: true; reversao: "reativou"; versao: number }
  | { ok: true; reversao: "nao_pedida" }
  | { ok: true; reversao: "sem_anterior" }
  | { ok: false; onde: "julgamento" | "reversao"; porque: string };

/**
 * Fecha o julgamento e, quando não pagou, REVERTE o genoma.
 *
 * ⚠️ REVERTER É REATIVAR A VERSÃO ANTERIOR, não escrever uma nova. Escrever
 * outra versão com os valores antigos encheria o histórico de idas e voltas e
 * faria a contagem de versões mentir sobre quantas ideias foram testadas.
 *
 * ⚠️⚠️ E ELA PODIA DEIXAR O AGENTE SEM GENOMA NENHUM — achado A06 da auditoria
 * externa. Eram QUATRO escritas soltas, todo `error` descartado, retorno `void`:
 * não havia o que conferir. Entre desativar a versão atual e ativar a anterior
 * o agente fica sem os parâmetros com que opera — e uma falha no meio o DEIXAVA
 * assim, em silêncio.
 *
 * ⚠️ INVERTER A ORDEM NÃO É CONSERTO. O índice parcial
 * `celeiro_genoma_um_ativo on (agente) where ativo` recusa dois ativos — medido
 * contra o banco de produção, que devolve 23505. A ordem segura simplesmente não
 * existe fora de uma transação, então a reversão virou RPC (migration 0048),
 * pelo mesmo motivo de `apply_session_pnl` e `bump_session_trades` existirem.
 *
 * ⚠️ E O CARIMBO AGORA VEM DEPOIS DA REVERSÃO. Carimbar `revertida_em` primeiro
 * fazia uma falha na reversão deixar a mutação DIZENDO que foi revertida sobre
 * um genoma intacto — o registro mentindo sobre o mundo, que é a pior das
 * falhas possíveis aqui porque some do relatório. Nesta ordem, uma falha no
 * carimbo deixa a mutação por julgar e o próximo ciclo refaz o fechamento; a
 * reversão é idempotente (medido: reexecutar devolve a mesma versão e não move
 * nada, porque a "anterior" sai de `versao`, que não depende de `ativo`).
 */
export async function fecharMutacao(
  db: SupabaseClient, mutacaoId: string, agente: string,
  veredito: "pagou" | "nao_pagou" | "inconclusiva",
  usdtControle: number, usdtMutacao: number,
  /**
   * ⚠️⚠️ A AÇÃO VEM DO JULGAMENTO, NÃO DA PALAVRA (29/08).
   *
   * Antes reverter era inferido de `veredito === "nao_pagou"`, o que amarrava
   * duas decisões diferentes. O caso que a auditoria achou não cabia nessa
   * amarração: com os DOIS braços destruindo valor não há o que aprender sobre
   * o parâmetro (`inconclusiva`) e mesmo assim a mudança não pode ficar de pé
   * (`reverter`). O default preserva o comportamento antigo para quem não passa.
   */
  acao: "manter" | "reverter" = veredito === "nao_pagou" ? "reverter" : "manter",
): Promise<FechamentoDaMutacao> {
  let reversao: FechamentoDaMutacao & { ok: true };

  if (acao !== "reverter") {
    reversao = { ok: true, reversao: "nao_pedida" };
  } else {
    const { data, error } = await db.rpc("celeiro_reverter_genoma", { p_agente: agente });
    // ⚠️ `supabase-js` RESOLVE com `{ error }` — não lança. Um `try/catch` em
    // volta disto não pegaria uma falha sequer.
    if (error) return { ok: false, onde: "reversao", porque: error.message.slice(0, 200) };

    if (data == null) {
      // A RPC devolve NULL para genoma de versão única: não há para onde voltar.
      reversao = { ok: true, reversao: "sem_anterior" };
    } else {
      const versao = Number(data);
      /**
       * ⚠️ NÃO CONFUNDIR COM `sem_anterior`. `Number(null)` é 0 e passa em
       * `isFinite` — por isso o `data == null` é conferido ANTES, e o que cai
       * aqui sem virar número é resposta que não sabemos ler, não ausência.
       */
      if (!Number.isFinite(versao)) {
        return { ok: false, onde: "reversao",
          porque: `a RPC devolveu ${JSON.stringify(data)}, que nao e versao nem NULL` };
      }
      reversao = { ok: true, reversao: "reativou", versao };
    }
  }

  const agora = new Date().toISOString();
  const { error: erroDoCarimbo } = await db.from("celeiro_mutacoes").update({
    avaliada_em: agora, veredito,
    usdt_controle: usdtControle, usdt_mutacao: usdtMutacao,
    ...(acao === "reverter" ? { revertida_em: agora } : {}),
  }).eq("id", mutacaoId);
  if (erroDoCarimbo) {
    return { ok: false, onde: "julgamento", porque: erroDoCarimbo.message.slice(0, 200) };
  }

  return reversao;
}

/** As mutações já julgadas — o insumo do placar dos modelos. */
export async function mutacoesJulgadas(db: SupabaseClient, limite = 500): Promise<Array<{
  modelo: string; veredito: "pagou" | "nao_pagou" | "inconclusiva"; diferenca: number;
}>> {
  // leitura-limitada: o placar olha o histórico recente, não a vida inteira.
  const { data } = await db.from("celeiro_mutacoes")
    .select("modelo, veredito, usdt_controle, usdt_mutacao")
    .not("veredito", "is", null)
    .order("avaliada_em", { ascending: false }).limit(limite);

  return (data ?? []).map((r) => ({
    modelo: r.modelo,
    veredito: r.veredito as "pagou" | "nao_pagou" | "inconclusiva",
    diferenca: (Number(r.usdt_mutacao) || 0) - (Number(r.usdt_controle) || 0),
  }));
}

/**
 * O PERÍODO DE ALTERNÂNCIA DO A/B — um tick do cron do Celeiro.
 *
 * Não é gosto: é o intervalo em que o cron roda. Alternar mais rápido que isso
 * não muda nada (não há tick no meio), e mais devagar daria a cada braço blocos
 * longos de mercado diferente.
 */
export const PERIODO_DO_BRACO_MS = 30 * 60_000;

/**
 * A qual braço do A/B esta posição pertence — alterna por TICK.
 *
 * ⚠️⚠️ ANTES ALTERNAVA POR POSIÇÃO ABERTA, e isso trava (29/08). O braço saía de
 * `posicoesDesde`, um contador que só anda quando uma posição ABRE. Se os braços
 * passam a ter parâmetros diferentes — que é o conserto desta entrega — um deles
 * pode ser recusado num portão que depende do genoma: `alvoLimpaOPedagio` olha
 * `alvoPct` e `multiploDoPedagio`, e DUAS das cinco mutações já propostas mexem
 * exatamente nesses dois campos.
 *
 * Aí o contador congela no braço recusado, o outro braço nunca chega a ser
 * sorteado, e o A/B morre de fome sem ninguém ver — porque o extrato continua
 * cheio, só que de um braço só.
 *
 * ⚠️ O RELÓGIO SEMPRE ANDA. Alternar por tick não pode travar, não precisa de
 * contador guardado, e é função pura de dois instantes — dá para quebrar em
 * teste sem banco.
 *
 * ⚠️ E NÃO É CORTE POR SÍMBOLO, que é a armadilha que o comentário anterior
 * nomeava com razão: dentro de um tick todos os símbolos vão para o MESMO braço,
 * e o tick seguinte vai todo para o outro. Os dois braços veem todos os ativos.
 *
 * ⚠️ Sem mutação em curso devolve `null` e nada é marcado: rotular o que não
 * está sendo testado envenena o julgamento seguinte com dados de antes.
 */
export function bracoDoTick(
  aplicadaEmMs: number | null | undefined,
  agoraMs: number,
  periodoMs = PERIODO_DO_BRACO_MS,
): Braco | null {
  if (aplicadaEmMs == null || !Number.isFinite(aplicadaEmMs)) return null;
  if (!Number.isFinite(agoraMs) || agoraMs < aplicadaEmMs) return null;
  const p = periodoMs > 0 ? periodoMs : PERIODO_DO_BRACO_MS;
  return Math.floor((agoraMs - aplicadaEmMs) / p) % 2 === 0 ? "controle" : "mutacao";
}

/**
 * ⚠️ `posicoesDesde` FOI REMOVIDA EM 29/08 — ela era o contador que alternava o
 * braço por posição aberta, e que travaria assim que os braços passaram a ter
 * parâmetros diferentes. Quem alterna agora é `bracoDoTick`, pelo relógio.
 */
