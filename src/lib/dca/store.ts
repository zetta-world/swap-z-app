import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Intervalo } from "@/lib/dca/relogio";

/**
 * O ARMAZÉM DO DCA — planos e ciclos.
 * (`docs/PLANO-DCA-AUTOMATICO.md` D2 · migration `0032_dca_planos.sql`)
 *
 * ⚠️ CLIENTE CRU pelo mesmo motivo de `cex/conexoes.ts`: estas tabelas ficam
 * FORA do tipo `Database` porque a 20ª entrada estoura a inferência do
 * supabase-js e faz OUTRAS tabelas resolverem como `never`, em silêncio, em
 * arquivos que ninguém tocou. Ver §5.3 do `ESTADO-ATUAL`.
 *
 * ⚠️ E ISSO CUSTA CARO AQUI. Sem checagem de tipo, um filtro esquecido numa
 * consulta compila — foi o que aconteceu no `revogarConexao` uma hora atrás.
 * Toda função deste arquivo devolve sucesso explícito, e o caminho de dinheiro
 * (`reservarCiclo`) distingue "não deu" de "outro já pegou".
 */

interface Resposta<T> { data: T | null; error: { message: string; code?: string } | null }
type Filtro = {
  eq:  (c: string, v: unknown) => Filtro;
  lte: (c: string, v: unknown) => Filtro;
  /** ⚠️ Filtrar NO SERVIDOR. Filtro no cliente sobre leitura cortada é o
   *  defeito que este arquivo carregava — ver `gastoHojeDaCarteira`. */
  gte: (c: string, v: unknown) => Filtro;
  in:  (c: string, v: readonly unknown[]) => Filtro;
  order: (c: string, o: { ascending: boolean }) => Filtro;
  limit: (n: number) => Promise<Resposta<unknown[]>>;
} & Promise<Resposta<unknown[]>>;

type ClienteCru = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<Resposta<unknown>>;
  from: (t: never) => {
    select: (c: string) => Filtro;
    insert: (v: unknown) => {
      select: (c: string) => { single: () => Promise<Resposta<{ id: string }>> };
    } & Promise<Resposta<unknown>>;
    update: (v: unknown) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => Promise<Resposta<unknown>> } & Promise<Resposta<unknown>> };
  };
};

const PLANOS = "dca_planos" as never;
const CICLOS = "dca_ciclos" as never;

function cru(): ClienteCru | null {
  return getSupabaseAdmin() as unknown as ClienteCru | null;
}

export type ModoPlano = "simulado" | "real";

export interface PlanoRow {
  id:                  string;
  /**
   * ⚠️ `null` só em plano SIMULADO. O banco garante (check
   * `dca_planos_real_exige_conexao`) que plano real tem conexão — e a garantia
   * PRECISA estar lá, porque esta tabela fica fora do tipo `Database` e aqui
   * não há checagem de tipo nenhuma.
   */
  conexao_id:          string | null;
  wallet_address:      string;
  exchange_id:         string;
  symbol:              string;
  orcamento_total_usd: number;
  por_ciclo_usd:       number;
  ciclos_total:        number;
  intervalo:           Intervalo;
  next_run_at:         string;
  ciclos_feitos:       number;
  ciclos_pulados:      number;
  gasto_acumulado_usd: number;
  status:              "ativo" | "pausado" | "completo" | "encerrado";
  encerrado_por:       string | null;
  /**
   * ⚠️ IMUTÁVEL DEPOIS DE CRIADO, e por isso não há função para trocá-lo.
   * Simulado que vira real relabelaria histórico inteiro de uma vez.
   */
  modo:                ModoPlano;
}

/**
 * Os planos com janela vencida.
 *
 * ⚠️ TETO EXPLÍCITO E ESTOURO DECLARADO. Corte silencioso lê-se como "vi
 * tudo" — a mesma trava `read-safety` que já me recusou dois PRs. Quem chama
 * recebe `truncado` e registra.
 */
export type ResultadoFilaPlanosDca =
  | { ok: true; planos: PlanoRow[]; truncado: boolean }
  | { ok: false; erro: "sem_banco" | "consulta_falhou" | "retorno_invalido"; detalhe?: string };

export type ResultadoPlanosVencidos = ResultadoFilaPlanosDca;
export type ResultadoPlanosRecovery = ResultadoFilaPlanosDca;

export async function planosVencidos(agoraIso: string, teto = 200): Promise<ResultadoPlanosVencidos> {
  const db = cru();
  // A86 — indisponibilidade não é fila vazia.
  if (!db) return { ok: false, erro: "sem_banco" };
  const { data, error } = await db.from(PLANOS)
    .select("*")
    .eq("status", "ativo")
    .lte("next_run_at", agoraIso)
    .order("next_run_at", { ascending: true })
    .limit(teto + 1);
  if (error) {
    return { ok: false, erro: "consulta_falhou", detalhe: error.message.slice(0, 200) };
  }
  if (!Array.isArray(data)) return { ok: false, erro: "retorno_invalido" };
  const linhas = data as PlanoRow[];
  return { ok: true, planos: linhas.slice(0, teto), truncado: linhas.length > teto };
}

/**
 * A58 — fila INDEPENDENTE de recovery. Status do plano controla entrada nova,
 * não o direito/dever de descobrir o que aconteceu com um intent que já
 * cruzou SUBMITTING. A RPC da 0066 entrega planos de QUALQUER status que ainda
 * tenham intent DCA vivo/QUARANTINED.
 *
 * A86 vale igual aqui: erro/DB ausente/retorno inválido nunca vira `[]`.
 */
export async function planosComIntentVivoParaRecovery(
  teto = 200,
): Promise<ResultadoPlanosRecovery> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem_banco" };

  const { data, error } = await db.rpc("dca_planos_com_intent_vivo_para_recovery", {
    p_limite: teto + 1,
  });
  if (error) {
    return { ok: false, erro: "consulta_falhou", detalhe: error.message.slice(0, 200) };
  }
  if (!Array.isArray(data)) return { ok: false, erro: "retorno_invalido" };

  const linhas = data as PlanoRow[];
  return { ok: true, planos: linhas.slice(0, teto), truncado: linhas.length > teto };
}

/**
 * Cria um plano. ⚠️ Devolve o id ou o erro — nunca "provavelmente deu certo".
 *
 * O `next_run_at` do PRIMEIRO ciclo é decisão de quem chama: começar AGORA é o
 * que o dono espera ao apertar o botão, e adiar para a próxima janela seria a
 * tela fazendo algo diferente do que diz.
 */
export async function criarPlano(p: {
  /** `null` em plano simulado — que é o ponto: dá para testar sem entregar chave. */
  conexaoId: string | null; walletAddress: string; exchangeId: string; symbol: string;
  modo: ModoPlano;
  orcamentoTotalUsd: number; porCicloUsd: number; ciclosTotal: number;
  intervalo: Intervalo; primeiraJanelaIso: string;
}): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem banco" };
  const { data, error } = await db.from(PLANOS).insert({
    conexao_id: p.conexaoId, wallet_address: p.walletAddress, exchange_id: p.exchangeId,
    symbol: p.symbol, orcamento_total_usd: p.orcamentoTotalUsd, por_ciclo_usd: p.porCicloUsd,
    ciclos_total: p.ciclosTotal, intervalo: p.intervalo, next_run_at: p.primeiraJanelaIso,
    modo: p.modo,
  }).select("id").single();
  if (error || !data?.id) return { ok: false, erro: error?.message?.slice(0, 200) ?? "sem id" };
  return { ok: true, id: data.id };
}

/** Os planos de uma carteira, mais recentes primeiro. */
export async function planosDaCarteira(wallet: string, teto = 50): Promise<PlanoRow[]> {
  const db = cru();
  if (!db) return [];
  const { data, error } = await db.from(PLANOS)
    .select("*").eq("wallet_address", wallet)
    .order("criado_em", { ascending: false }).limit(teto);
  if (error || !Array.isArray(data)) return [];
  return data as PlanoRow[];
}

/**
 * ⚠⚠ UM PLANO SÓ, BUSCADO DIRETO — achado A18 da auditoria externa (14/09).
 *
 * A rota autorizava pausar/encerrar com
 * `planosDaCarteira(wallet).find(p => p.id === id)`, e essa lista tem teto de
 * **50**, ordenada do mais novo para o mais velho.
 *
 * O cron, porém, lê `planosVencidos` com teto de **200**. Então do 51º plano
 * mais antigo em diante havia uma assimetria com dinheiro dentro: **o executor
 * enxergava planos que o controlador não conseguia parar**. Pausar e encerrar
 * devolviam 404 `nao_encontrado` — e o plano seguia comprando, janela após
 * janela, sem botão que o alcançasse.
 *
 * ⚠️ LISTA NÃO É AUTORIZAÇÃO. A lista é uma VISTA, e toda vista tem teto;
 * a pergunta "este plano é desta carteira?" é de UMA linha e não pode depender
 * de paginação. O `eq("wallet_address", wallet)` aqui é o que autoriza — o id
 * sozinho continua não sendo autorização.
 *
 * ⚠️ `null` distingue "não é seu / não existe" de erro de banco: erro devolve
 * `undefined`, e quem chama trata os dois de forma diferente — 404 não pode
 * significar "o banco caiu".
 */
export async function planoDaCarteira(
  wallet: string, planoId: string,
): Promise<PlanoRow | null | undefined> {
  const db = cru();
  if (!db) return undefined;
  // ⚠️ `limit(1)` e não `maybeSingle`: o `Filtro` deste arquivo é estreito de
  // propósito (ver o cabeçalho), e alargá-lo por uma consulta não se paga.
  const { data, error } = await db.from(PLANOS)
    .select("*").eq("wallet_address", wallet).eq("id", planoId).limit(1);
  if (error || !Array.isArray(data)) return undefined;
  return (data[0] as PlanoRow | undefined) ?? null;
}

/**
 * A lista veio cortada? — para a tela poder dizer isso em vez de fingir que
 * mostrou tudo (A18, segunda metade).
 *
 * ⚠️ Mesmo padrão de `idsDaCarteira`: pede UM a mais que o teto. Erro de
 * banco devolve `null` (= não sei), nunca `false` — "não sei" e "mostrei tudo"
 * são respostas diferentes, e só uma delas é verdade.
 */
export async function haMaisPlanos(wallet: string, teto = 50): Promise<boolean | null> {
  const db = cru();
  if (!db) return null;
  const { data, error } = await db.from(PLANOS)
    .select("id").eq("wallet_address", wallet).limit(teto + 1);
  if (error || !Array.isArray(data)) return null;
  return data.length > teto;
}

/** Os ciclos de um plano — o extrato que prova o que aconteceu. */
export async function ciclosDoPlano(planoId: string, teto = 400): Promise<Array<{
  ciclo_numero: number; status: string; motivo: string | null;
  agendado_para: string; executado_em: string | null;
  preco: number | null; quantidade: number | null; custo_usd: number | null;
  taxa_usd: number | null;
}>> {
  const db = cru();
  if (!db) return [];
  const { data, error } = await db.from(CICLOS)
    .select("ciclo_numero, status, motivo, agendado_para, executado_em, preco, quantidade, custo_usd, taxa_usd")
    .eq("plano_id", planoId).order("ciclo_numero", { ascending: false }).limit(teto);
  if (error || !Array.isArray(data)) return [];
  return data as Array<{
    ciclo_numero: number; status: string; motivo: string | null;
    agendado_para: string; executado_em: string | null;
    preco: number | null; quantidade: number | null; custo_usd: number | null;
    taxa_usd: number | null;
  }>;
}

/** Postgres: violação de unicidade. É o sinal de "outra passada já pegou". */
const UNIQUE_VIOLATION = "23505";

export type ResultadoReserva = "reservado" | "ja_reservado" | "erro";

/**
 * ⚠️⚠️ O PASSO 1 DE TRÊS, E A ÚNICA GARANTIA CONTRA COMPRAR DUAS VEZES.
 *
 * A ordem é INEGOCIÁVEL: reserva aqui → coloca a ordem → grava o resultado.
 *
 * O lock por sessão tem TTL: uma passada que trave, expire o lock e volte a si
 * compraria de novo. Lock é otimização. A garantia é o
 * `unique (plano_id, ciclo_numero)` do banco, e é por isso que
 * `ja_reservado` é um resultado NORMAL e não um erro: significa que outra
 * passada está com este ciclo, e esta tem de sair sem gastar nada.
 *
 * Provado no banco em 24/08: o segundo insert do mesmo ciclo é recusado com
 * `unique_violation`, e o ciclo seguinte do mesmo plano passa.
 */
export async function reservarCiclo(
  planoId: string, cicloNumero: number, agendadoParaIso: string,
): Promise<ResultadoReserva> {
  const db = cru();
  if (!db) return "erro";
  const { error } = await db.from(CICLOS).insert({
    plano_id: planoId, ciclo_numero: cicloNumero,
    status: "reservado", agendado_para: agendadoParaIso,
  });
  if (!error) return "reservado";
  if (error.code === UNIQUE_VIOLATION) return "ja_reservado";
  return "erro";
}

/** Passo 3: o resultado REAL da ordem. Devolve se gravou. */
export async function fecharCiclo(planoId: string, cicloNumero: number, r: {
  status: "feito" | "falhou"; motivo?: string;
  orderId?: string; preco?: number; quantidade?: number; custoUsd?: number;
  /**
   * ⚠️ `undefined` NÃO VIRA 0 AQUI. Ciclo cuja taxa não deu para precificar
   * grava `null`, e `compararComRealizado()` conta esse ciclo à parte em vez de
   * somar zero — senão a alíquota real despenca por falta de dado e a tela lê
   * isso como "a corretora está cobrando barato".
   */
  taxaUsd?: number | null;
  taxaNaoPrecificada?: { moeda: string; valor: number } | null;
  /**
   * ⚠️ CARIMBADO NO CICLO, não deduzido do plano na hora de exibir. Se o modo
   * vivesse só no plano, um `update` nele relabelaria o histórico todo. O que
   * aconteceu fica dito onde aconteceu.
   */
  simulado?: boolean;
}): Promise<boolean> {
  const db = cru();
  if (!db) return false;
  const { error } = await db.from(CICLOS).update({
    status:       r.status,
    motivo:       r.motivo?.slice(0, 300) ?? null,
    executado_em: new Date().toISOString(),
    order_id:     r.orderId ?? null,
    preco:        r.preco ?? null,
    quantidade:   r.quantidade ?? null,
    custo_usd:    r.custoUsd ?? null,
    taxa_usd:     r.taxaUsd ?? null,
    taxa_nao_precificada: r.taxaNaoPrecificada ?? null,
    simulado:     r.simulado === true,
  }).eq("plano_id", planoId).eq("ciclo_numero", cicloNumero);
  return !error;
}

/**
 * Grava uma janela perdida. Não gasta dinheiro, mas gasta um número de ciclo —
 * e é isso que faz a soma bater no fim.
 */
export async function gravarPulo(
  planoId: string, cicloNumero: number, agendadoParaIso: string, motivo: string,
): Promise<boolean> {
  const db = cru();
  if (!db) return false;
  const { error } = await db.from(CICLOS).insert({
    plano_id: planoId, ciclo_numero: cicloNumero, status: "pulado",
    motivo, agendado_para: agendadoParaIso, executado_em: new Date().toISOString(),
  });
  // ⚠️ Unique aqui também é normal: outra passada já contou este pulo.
  return !error || error.code === UNIQUE_VIOLATION;
}

/** Avança o relógio e os contadores do plano. Devolve se gravou. */
export async function avancarPlano(planoId: string, p: {
  nextRunAt?:    string;
  ciclosFeitos?:  number;
  ciclosPulados?: number;
  gastoAcumulado?: number;
  status?:        PlanoRow["status"];
  encerradoPor?:  string;
}): Promise<boolean> {
  const db = cru();
  if (!db) return false;
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if (p.nextRunAt      !== undefined) patch.next_run_at         = p.nextRunAt;
  if (p.ciclosFeitos   !== undefined) patch.ciclos_feitos       = p.ciclosFeitos;
  if (p.ciclosPulados  !== undefined) patch.ciclos_pulados      = p.ciclosPulados;
  if (p.gastoAcumulado !== undefined) patch.gasto_acumulado_usd = p.gastoAcumulado;
  if (p.status         !== undefined) patch.status              = p.status;
  if (p.encerradoPor   !== undefined) patch.encerrado_por       = p.encerradoPor.slice(0, 120);
  const { error } = await db.from(PLANOS).update(patch).eq("id", planoId);
  return !error;
}

/**
 * Os ids dos planos de uma carteira.
 *
 * ⚠️ COM SINAL DE ESTOURO. Uma lista cortada faria o teto diário somar só parte
 * dos planos — o mesmo furo por outro caminho. Quem chama trata `truncado`
 * como "não sei".
 */
async function idsDaCarteira(wallet: string, teto = 200): Promise<{ ids: string[]; truncado: boolean }> {
  const db = cru();
  if (!db) return { ids: [], truncado: true };
  const { data, error } = await db.from(PLANOS)
    .select("id").eq("wallet_address", wallet).limit(teto + 1);
  if (error || !Array.isArray(data)) return { ids: [], truncado: true };
  const linhas = data as Array<{ id: string }>;
  return { ids: linhas.slice(0, teto).map((r) => r.id), truncado: linhas.length > teto };
}

/**
 * Quanto esta carteira já gastou HOJE, somando TODOS os planos dela.
 *
 * ⚠️⚠️ RECEBE A CARTEIRA, NÃO UMA LISTA DE PLANOS (26/08) — e a assinatura
 * antiga era o defeito.
 *
 * A versão anterior era `gastoHojeDaCarteira(planoIds: string[])`, e o único
 * chamador passava `[p.id]`: o plano CORRENTE, sozinho. O teto que este
 * cabeçalho promete para a CARTEIRA era, na prática, um teto POR PLANO — dez
 * planos na mesma carteira davam dez vezes o limite, que é exatamente o
 * cenário que o parágrafo abaixo nomeia como motivo desta função existir.
 *
 * O tipo não podia pegar: `[p.id]` e `idsDaCarteira(...)` são os dois
 * `string[]`. Pedir a CARTEIRA fecha a porta na assinatura — não dá para
 * passar um plano onde se pede um dono.
 *
 * ⚠️ É o teto que a separação do autopilot exigiu: sem sessão para herdar
 * limite, dez planos de US$ 100/dia na mesma carteira seriam US$ 1.000/dia com
 * nada olhando o conjunto.
 *
 * ⚠️⚠️ E OS FILTROS SÃO DO SERVIDOR AGORA. A versão anterior pedia os 1.000
 * ciclos `feito` mais recentes de TODA A PLATAFORMA e filtrava por plano e por
 * data NO CLIENTE. Com mais de mil ciclos concluídos no intervalo, os desta
 * carteira caem FORA da janela lida, a soma volta menor do que é — e um teto de
 * dinheiro que subestima o gasto ABRE. É a armadilha do PostgREST que o
 * cabeçalho de `paper/reconcile.ts` documenta, na função que existe para
 * fechar um limite.
 *
 * ⚠️ E DEVOLVE `null` QUANDO NÃO SABE — inclusive quando a leitura estoura o
 * teto. Um erro de consulta, ou um corte, que virasse `0` abriria o limite
 * inteiro exatamente quando o banco está ruim. Quem chama trata `null` como
 * "não compra": falha FECHADO, como o `price-guard`.
 */
export async function gastoHojeDaCarteira(
  wallet: string, modo: ModoPlano, teto = 2000,
): Promise<number | null> {
  const db = cru();
  if (!db) return null;

  if (modo === "real") {
    /**
     * A59 — o teto REAL vem das autoridades duráveis da execução, não do
     * fechamento best-effort de `dca_ciclos`. A RPC da 0066 conta:
     *   · requested_notional_usd como PISO enquanto o intent está depois do
     *     ponto sem volta e ainda inconclusivo; fill durável USD-like maior
     *     eleva o compromisso para o maior valor conhecido;
     *   · fills reais quando o intent terminou;
     *   · FAILED_PRE_SUBMIT como zero.
     * Qualquer unidade/NULL que impeça afirmar USD faz a RPC falhar e aqui
     * vira `null` => o cron não compra.
     */
    const { data, error } = await db.rpc("dca_gasto_real_comprometido_hoje", {
      p_wallet_address: wallet,
    });
    if (error) return null;
    const valor = Number(data);
    if (!Number.isFinite(valor) || valor < 0) return null;
    return valor;
  }

  // Simulado não move dinheiro; preserva a contabilidade do extrato simulado
  // sem fingir que ela é autoridade para risco real.
  const { ids, truncado } = await idsDaCarteira(wallet);
  if (truncado) return null;
  if (ids.length === 0) return 0;

  const desde = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await db.from(CICLOS)
    .select("custo_usd")
    .in("plano_id", ids)
    .eq("status", "feito")
    .eq("simulado", true)
    .gte("executado_em", desde)
    .limit(teto + 1);
  if (error || !Array.isArray(data)) return null;
  if (data.length > teto) return null;

  return (data as Array<{ custo_usd: number | null }>)
    .reduce((soma, c) => soma + (Number(c.custo_usd) || 0), 0);
}
