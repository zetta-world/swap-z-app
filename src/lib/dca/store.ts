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
  order: (c: string, o: { ascending: boolean }) => Filtro;
  limit: (n: number) => Promise<Resposta<unknown[]>>;
} & Promise<Resposta<unknown[]>>;

type ClienteCru = {
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

export interface PlanoRow {
  id:                  string;
  conexao_id:          string;
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
}

/**
 * Os planos com janela vencida.
 *
 * ⚠️ TETO EXPLÍCITO E ESTOURO DECLARADO. Corte silencioso lê-se como "vi
 * tudo" — a mesma trava `read-safety` que já me recusou dois PRs. Quem chama
 * recebe `truncado` e registra.
 */
export async function planosVencidos(agoraIso: string, teto = 200): Promise<{ planos: PlanoRow[]; truncado: boolean }> {
  const db = cru();
  if (!db) return { planos: [], truncado: false };
  const { data, error } = await db.from(PLANOS)
    .select("*")
    .eq("status", "ativo")
    .lte("next_run_at", agoraIso)
    .order("next_run_at", { ascending: true })
    .limit(teto + 1);
  if (error || !Array.isArray(data)) return { planos: [], truncado: false };
  const linhas = data as PlanoRow[];
  return { planos: linhas.slice(0, teto), truncado: linhas.length > teto };
}

/**
 * Cria um plano. ⚠️ Devolve o id ou o erro — nunca "provavelmente deu certo".
 *
 * O `next_run_at` do PRIMEIRO ciclo é decisão de quem chama: começar AGORA é o
 * que o dono espera ao apertar o botão, e adiar para a próxima janela seria a
 * tela fazendo algo diferente do que diz.
 */
export async function criarPlano(p: {
  conexaoId: string; walletAddress: string; exchangeId: string; symbol: string;
  orcamentoTotalUsd: number; porCicloUsd: number; ciclosTotal: number;
  intervalo: Intervalo; primeiraJanelaIso: string;
}): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const db = cru();
  if (!db) return { ok: false, erro: "sem banco" };
  const { data, error } = await db.from(PLANOS).insert({
    conexao_id: p.conexaoId, wallet_address: p.walletAddress, exchange_id: p.exchangeId,
    symbol: p.symbol, orcamento_total_usd: p.orcamentoTotalUsd, por_ciclo_usd: p.porCicloUsd,
    ciclos_total: p.ciclosTotal, intervalo: p.intervalo, next_run_at: p.primeiraJanelaIso,
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

/** Os ciclos de um plano — o extrato que prova o que aconteceu. */
export async function ciclosDoPlano(planoId: string, teto = 400): Promise<Array<{
  ciclo_numero: number; status: string; motivo: string | null;
  agendado_para: string; executado_em: string | null;
  preco: number | null; quantidade: number | null; custo_usd: number | null;
}>> {
  const db = cru();
  if (!db) return [];
  const { data, error } = await db.from(CICLOS)
    .select("ciclo_numero, status, motivo, agendado_para, executado_em, preco, quantidade, custo_usd")
    .eq("plano_id", planoId).order("ciclo_numero", { ascending: false }).limit(teto);
  if (error || !Array.isArray(data)) return [];
  return data as Array<{
    ciclo_numero: number; status: string; motivo: string | null;
    agendado_para: string; executado_em: string | null;
    preco: number | null; quantidade: number | null; custo_usd: number | null;
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
 * Quanto esta carteira já gastou HOJE, somando TODOS os planos dela.
 *
 * ⚠️ É o teto que a separação do autopilot exigiu: sem sessão para herdar
 * limite, dez planos de US$ 100/dia na mesma carteira seriam US$ 1.000/dia com
 * nada olhando o conjunto.
 *
 * ⚠️ E DEVOLVE `null` QUANDO NÃO SABE. Um erro de consulta que virasse `0`
 * abriria o teto inteiro exatamente quando o banco está ruim. Quem chama trata
 * `null` como "não compra" — falha FECHADO, como o `price-guard`.
 */
export async function gastoHojeDaCarteira(planoIds: string[]): Promise<number | null> {
  const db = cru();
  if (!db) return null;
  if (planoIds.length === 0) return 0;
  const desde = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await db.from(CICLOS)
    .select("plano_id, custo_usd, executado_em, status")
    .eq("status", "feito")
    .order("executado_em", { ascending: false })
    .limit(1000);
  if (error || !Array.isArray(data)) return null;
  const meus = new Set(planoIds);
  return (data as Array<{ plano_id: string; custo_usd: number | null; executado_em: string | null }>)
    .filter((c) => meus.has(c.plano_id) && (c.executado_em ?? "") >= desde)
    .reduce((s, c) => s + (Number(c.custo_usd) || 0), 0);
}
