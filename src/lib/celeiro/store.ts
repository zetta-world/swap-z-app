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
export async function aplicarMutacao(
  db: SupabaseClient, mutacaoId: string, agente: string,
  paramsNovos: Record<string, unknown>, modelo: string, hipotese: string,
): Promise<number | null> {
  const { data: atual } = await db.from("celeiro_genoma")
    .select("versao").eq("agente", agente).order("versao", { ascending: false }).limit(1);
  const versao = (Number(atual?.[0]?.versao) || 0) + 1;

  await db.from("celeiro_genoma").update({ ativo: false }).eq("agente", agente).eq("ativo", true);
  const { error } = await db.from("celeiro_genoma").insert({
    agente, versao, params: paramsNovos, autor: modelo, hipotese, ativo: true,
  });
  if (error) return null;

  await db.from("celeiro_mutacoes").update({ aplicada_em: new Date().toISOString() }).eq("id", mutacaoId);
  return versao;
}

/**
 * Fecha o julgamento e, quando não pagou, REVERTE o genoma.
 *
 * ⚠️ REVERTER É REATIVAR A VERSÃO ANTERIOR, não escrever uma nova. Escrever
 * outra versão com os valores antigos encheria o histórico de idas e voltas e
 * faria a contagem de versões mentir sobre quantas ideias foram testadas.
 */
export async function fecharMutacao(
  db: SupabaseClient, mutacaoId: string, agente: string,
  veredito: "pagou" | "nao_pagou" | "inconclusiva",
  usdtControle: number, usdtMutacao: number,
): Promise<void> {
  const agora = new Date().toISOString();
  await db.from("celeiro_mutacoes").update({
    avaliada_em: agora, veredito,
    usdt_controle: usdtControle, usdt_mutacao: usdtMutacao,
    ...(veredito === "nao_pagou" ? { revertida_em: agora } : {}),
  }).eq("id", mutacaoId);

  if (veredito !== "nao_pagou") return;

  const { data } = await db.from("celeiro_genoma")
    .select("versao").eq("agente", agente).order("versao", { ascending: false }).limit(2);
  const anterior = data?.[1]?.versao;
  if (anterior == null) return;

  await db.from("celeiro_genoma").update({ ativo: false }).eq("agente", agente).eq("ativo", true);
  await db.from("celeiro_genoma").update({ ativo: true }).eq("agente", agente).eq("versao", anterior);
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
 * A qual braço do A/B esta posição pertence.
 *
 * ⚠️⚠️ ALTERNA POR POSIÇÃO, e não por símbolo. Dividir por símbolo daria a cada
 * braço um conjunto DIFERENTE de ativos — e aí o A/B mediria "BTC contra ETH"
 * em vez de "genoma antigo contra novo". Alternar é o único corte que mantém os
 * dois braços expostos ao mesmo mercado.
 *
 * ⚠️ Sem mutação em curso, TUDO é controle. Marcar como `mutacao` o que não
 * está sendo testado envenenaria o julgamento seguinte com dados de antes.
 */
export function bracoDaPosicao(temMutacao: boolean, jaAbertasDesdeAMutacao: number): Braco | null {
  if (!temMutacao) return null;
  return jaAbertasDesdeAMutacao % 2 === 0 ? "controle" : "mutacao";
}

/** Quantas posições o agente abriu desde que a mutação entrou. */
export async function posicoesDesde(db: SupabaseClient, agente: string, desdeMs: number): Promise<number> {
  const { count } = await db.from("celeiro_posicoes")
    .select("*", { count: "exact", head: true })
    .eq("agente", agente).gte("aberta_em", new Date(desdeMs).toISOString());
  return count ?? 0;
}
