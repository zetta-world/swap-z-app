/**
 * A BANCADA NO BANCO — a única camada que fala com o Postgres, e a única que
 * pode vazar a linha de um cliente para outro.
 *
 * ⚠️⚠️ A REGRA QUE VALE PARA O ARQUIVO INTEIRO: `dono` é o PRIMEIRO parâmetro
 * de toda função, e ele é do tipo marcado `Dono` (ver `dono.ts`). Não há
 * sobrecarga sem dono, não há função "interna" que pule o filtro. Esquecer o
 * filtro deixa de ser um descuido possível e vira erro de compilação.
 *
 * ⚠️ E TODA LEITURA PASSA POR `doDono()`. Uma única porta significa uma única
 * coisa a auditar; vinte `.eq("dono", ...)` espalhados significam vinte
 * chances de faltar um, e o que falta não aparece em teste nenhum porque a
 * consulta sem filtro devolve MAIS dados, não menos — ela funciona.
 *
 * ⚠️ A ARITMÉTICA NÃO MORA AQUI. Custo, pedágio, equilíbrio e veredito são a
 * fase 2, puros e testados em `lib/bancada/`. Aqui só há leitura e escrita —
 * a mesma separação de `celeiro/store.ts` e `mercado/store.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalletChain } from "@/lib/supabase/types";
import { donoDeLinhaDoBanco, type Dono } from "@/lib/bancada/dono";

export type Praca = "spot_gate" | "futuros_gate" | "dex";
export type Papel = "maker" | "taker";
export type StatusRodada = "rodando" | "concluida" | "recusada" | "falhou";
export type Veredito = "perdeu" | "ganhou" | "ganhou_perdendo_do_indice" | "ruido";
export type StatusPosicao = "aberta" | "ganhou" | "perdeu" | "expirada";

/** As tabelas que têm coluna `dono`. Fechada: nomear tabela por string solta
 *  seria a porta de trás que este módulo existe para não ter. */
type TabelaComDono = "bancada_estrategia" | "bancada_rodada" | "bancada_resultado" | "bancada_posicao";

/**
 * ⚠️⚠️ A PORTA ÚNICA DE LEITURA. Todo `select` deste arquivo nasce aqui, já
 * filtrado. É esta função que o teste de isolamento observa: o banco falso
 * grava os filtros aplicados e a asserção é sobre o FILTRO QUE CHEGOU AO BANCO,
 * não sobre o texto do código.
 */
function doDono(db: SupabaseClient, tabela: TabelaComDono, dono: Dono, colunas: string) {
  return db.from(tabela).select(colunas).eq("dono", dono);
}

/**
 * O desfecho de uma escrita.
 *
 * ⚠️ `supabase-js` RESOLVE COM `{ data: null, error }` — ele não lança. Um
 * `try/catch` em volta de uma escrita aqui não pega nada, e um `await` cujo
 * erro ninguém lê é uma gravação que falhou em silêncio. Por isso o retorno é
 * explícito e o motivo vem junto.
 */
export type Escrita<T> = { ok: true; valor: T } | { ok: false; porque: string };

function falhou(e: { message?: string } | null, onde: string): { ok: false; porque: string } {
  return { ok: false, porque: `${onde}: ${(e?.message ?? "erro sem mensagem").slice(0, 160)}` };
}

// ── ESTRATÉGIAS ─────────────────────────────────────────────────────

export interface EstrategiaNova {
  nome: string;
  /** ⚠️ Vocabulário FECHADO, validado na fase 2. Nunca código do cliente. */
  params: Record<string, unknown>;
  praca: Praca;
  papel: Papel;
  /** Onde a mesa olha, quando ela vira papel adiante (0039). */
  simbolos?: string[];
  intervalo?: string;
}

export interface Estrategia extends EstrategiaNova {
  id: string;
  criadaEm: string;
  arquivada: boolean;
  papelAdiante: boolean;
  papelDesde: string | null;
}

type LinhaEstrategia = {
  id: string; nome: string; params: Record<string, unknown> | null;
  praca: string; papel: string; criada_em: string; arquivada_em: string | null;
  papel_adiante: boolean | null; simbolos: string[] | null;
  intervalo: string | null; papel_desde: string | null;
};

function paraEstrategia(r: LinhaEstrategia): Estrategia {
  return {
    id: r.id,
    nome: r.nome,
    params: (r.params ?? {}) as Record<string, unknown>,
    praca: r.praca as Praca,
    papel: r.papel as Papel,
    criadaEm: r.criada_em,
    arquivada: r.arquivada_em != null,
    simbolos: r.simbolos ?? [],
    intervalo: r.intervalo ?? "1h",
    papelAdiante: Boolean(r.papel_adiante),
    papelDesde: r.papel_desde,
  };
}

const COLUNAS_ESTRATEGIA = "id, nome, params, praca, papel, criada_em, arquivada_em, papel_adiante, simbolos, intervalo, papel_desde";

export async function salvarEstrategia(
  dono: Dono, chain: WalletChain, db: SupabaseClient, nova: EstrategiaNova,
): Promise<Escrita<string>> {
  const { data, error } = await db.from("bancada_estrategia").insert({
    dono, chain,
    nome: nova.nome.slice(0, 120),
    params: nova.params,
    praca: nova.praca,
    papel: nova.papel,
    simbolos: nova.simbolos ?? [],
    intervalo: nova.intervalo ?? "1h",
    // ⚠️ O papel adiante NASCE DESLIGADO. Salvar não é ligar: ligar é ato
    // explícito, e é o ato que a cota de mesas conta.
    papel_adiante: false,
  }).select("id").single();
  if (error || !data) return falhou(error, "salvar estratégia");
  return { ok: true, valor: String((data as { id: string }).id) };
}

/**
 * As estratégias deste dono.
 *
 * ⚠️ AS ARQUIVADAS VÊM JUNTO, com a marca. Escondê-las faria a cota de
 * "estratégias salvas" (§6.2) discordar da tela: o cliente veria três e o
 * contador diria dez.
 */
export async function listarEstrategias(dono: Dono, db: SupabaseClient): Promise<Estrategia[]> {
  const { data, error } = await doDono(db, "bancada_estrategia", dono, COLUNAS_ESTRATEGIA)
    .order("criada_em", { ascending: false })
    .limit(300);
  if (error || !data) return [];
  return (data as unknown as LinhaEstrategia[]).map(paraEstrategia);
}

/**
 * Uma estratégia pelo id.
 *
 * ⚠️⚠️ O FILTRO DE DONO VEM ANTES DO FILTRO DE ID, e não é estilo. Buscar por
 * id e conferir o dono DEPOIS já leu a linha alheia para dentro do processo —
 * e a diferença entre "não é sua" e "não existe" vaza a existência dela. Aqui
 * a linha de outra carteira simplesmente não volta.
 */
export async function estrategia(dono: Dono, db: SupabaseClient, id: string): Promise<Estrategia | null> {
  const { data, error } = await doDono(db, "bancada_estrategia", dono, COLUNAS_ESTRATEGIA)
    .eq("id", id).maybeSingle();
  if (error || !data) return null;
  return paraEstrategia(data as unknown as LinhaEstrategia);
}

/**
 * ⚠️ ARQUIVA, NÃO APAGA. Uma rodada aponta para a estratégia que a gerou;
 * deletar transformaria resultado medido em resultado órfão, e o cliente
 * perderia o histórico do que ele mesmo testou.
 */
export async function arquivarEstrategia(dono: Dono, db: SupabaseClient, id: string): Promise<Escrita<true>> {
  const { error } = await db.from("bancada_estrategia")
    .update({ arquivada_em: new Date().toISOString(), atualizada_em: new Date().toISOString() })
    .eq("dono", dono).eq("id", id);
  if (error) return falhou(error, "arquivar estratégia");
  return { ok: true, valor: true };
}

/** Quantas estratégias VIVAS este dono tem — a régua da cota da §6.2. */
export async function contarEstrategiasVivas(dono: Dono, db: SupabaseClient): Promise<number | null> {
  const { count, error } = await db.from("bancada_estrategia")
    .select("id", { count: "exact", head: true })
    .eq("dono", dono).is("arquivada_em", null);
  // ⚠️ `null` É "NÃO SEI", NÃO ZERO. Devolver 0 numa falha de leitura liberaria
  // a cota inteira exatamente quando o banco está ruim — falha ABERTA no
  // caminho que segura custo. Quem chama decide, e decide fechado.
  if (error || typeof count !== "number") return null;
  return count;
}

/**
 * Liga ou desliga o papel adiante de UMA estratégia.
 *
 * ⚠️ O TETO NÃO É CONFERIDO AQUI, e isso é de propósito: quem conta mesas é a
 * camada de decisão (`cotas`/rota), com o tier em mãos. Um store que decide
 * política é um store que duplica a política.
 *
 * ⚠️ E `papel_desde` só é escrito ao LIGAR: um resultado de papel adiante sem o
 * tempo decorrido é o mesmo defeito do número sem amostra.
 */
export async function ligarPapelAdiante(
  dono: Dono, db: SupabaseClient, id: string, ligar: boolean,
): Promise<Escrita<true>> {
  const { error } = await db.from("bancada_estrategia").update({
    papel_adiante: ligar,
    papel_desde: ligar ? new Date().toISOString() : null,
    atualizada_em: new Date().toISOString(),
  }).eq("dono", dono).eq("id", id);
  if (error) return falhou(error, "ligar papel adiante");
  return { ok: true, valor: true };
}

/** Quantas mesas VIVAS este dono tem — a régua da cota `mesasDePapel`. */
export async function contarMesasVivas(dono: Dono, db: SupabaseClient): Promise<number | null> {
  const { count, error } = await db.from("bancada_estrategia")
    .select("id", { count: "exact", head: true })
    .eq("dono", dono).eq("papel_adiante", true).is("arquivada_em", null);
  // ⚠️ `null` é "não sei", nunca 0 — ver `contarEstrategiasVivas`.
  if (error || typeof count !== "number") return null;
  return count;
}

/** Uma mesa como o cron a enxerga: a regra, onde olha, e o estado dela. */
export interface MesaDoCron {
  id: string;
  dono: Dono;
  params: Record<string, unknown>;
  simbolos: string[];
  intervalo: string;
  criadaEm: string;
}

/**
 * ⚠️⚠️ TODAS AS MESAS LIGADAS, DE TODO MUNDO — a segunda função sem dono deste
 * arquivo, e o nome diz por quê.
 *
 * O cron não tem sessão e não tem uma carteira "certa" a filtrar: ele varre o
 * mundo e trata cada linha como do dono dela, reconstruído com
 * `donoDeLinhaDoBanco`. ⚠️ Se isto aparecer numa rota de cliente, o isolamento
 * acabou.
 */
export async function mesasLigadasParaOCron(db: SupabaseClient, limite = 200): Promise<MesaDoCron[]> {
  const { data, error } = await db.from("bancada_estrategia")
    .select("id, dono, params, simbolos, intervalo, criada_em")
    .eq("papel_adiante", true).is("arquivada_em", null)
    .order("criada_em", { ascending: true })
    .limit(Math.max(1, Math.min(1000, Math.floor(limite))));
  if (error || !data) return [];
  const linhas = data as unknown as Array<{
    id: string; dono: string; params: Record<string, unknown> | null;
    simbolos: string[] | null; intervalo: string | null; criada_em: string;
  }>;
  return linhas.flatMap((r) => {
    const d = donoDeLinhaDoBanco(r.dono);
    if (!d) return [];
    return [{
      id: r.id, dono: d, params: r.params ?? {},
      simbolos: r.simbolos ?? [], intervalo: r.intervalo ?? "1h", criadaEm: r.criada_em,
    }];
  });
}

// ── RODADAS ─────────────────────────────────────────────────────────

export interface RodadaNova {
  estrategiaId: string | null;
  origem: "propria" | "casa";
  capitalUsd: number;
  simbolos: string[];
  intervalo: string;
  janelaDe: number;
  janelaAte: number;
  praca: Praca;
  papel: Papel;
  /** ⚠️ CÓPIA CONGELADA dos parâmetros, não referência. Ver a migration. */
  params: Record<string, unknown>;
  /** `símbolos × velas` — o trabalho que esta rodada custa. */
  custoVelas: number;
}

/**
 * Abre a rodada com a janela DECLARADA ANTES de qualquer resultado existir.
 *
 * ⚠️ É a mesma disciplina de `lab/store.ts:startRun`. Gravar os parâmetros
 * depois de ver o resultado permite — sem ninguém querer — escolher a janela
 * que ficou bonita. A linha nasce antes de haver o que escolher.
 */
export async function abrirRodada(
  dono: Dono, chain: WalletChain, db: SupabaseClient, nova: RodadaNova,
): Promise<Escrita<string>> {
  const { data, error } = await db.from("bancada_rodada").insert({
    dono, chain,
    estrategia_id: nova.estrategiaId,
    origem: nova.origem,
    capital_usd: nova.capitalUsd,
    simbolos: nova.simbolos,
    intervalo: nova.intervalo,
    janela_de: nova.janelaDe,
    janela_ate: nova.janelaAte,
    praca: nova.praca,
    papel: nova.papel,
    params: nova.params,
    custo_velas: Math.max(0, Math.floor(nova.custoVelas)),
    status: "rodando",
  }).select("id").single();
  if (error || !data) return falhou(error, "abrir rodada");
  return { ok: true, valor: String((data as { id: string }).id) };
}

/**
 * Fecha a rodada com um desfecho.
 *
 * ⚠️ `recusada` É DESFECHO, NÃO ERRO. O portão do pedágio recusa configuração
 * que nunca poderia abrir, e o cliente merece o motivo NA HORA — foi assim que
 * o Maker de Faixa ficou dois dias sem operar sem ninguém notar.
 */
export async function fecharRodada(
  dono: Dono, db: SupabaseClient, id: string, status: StatusRodada, porque?: string,
): Promise<Escrita<true>> {
  const { error } = await db.from("bancada_rodada")
    .update({ status, porque: porque ?? null, terminada_em: new Date().toISOString() })
    .eq("dono", dono).eq("id", id);
  if (error) return falhou(error, "fechar rodada");
  return { ok: true, valor: true };
}

export interface Rodada {
  id: string;
  origem: "propria" | "casa";
  estrategiaId: string | null;
  capitalUsd: number;
  simbolos: string[];
  intervalo: string;
  janelaDe: number;
  janelaAte: number;
  praca: Praca;
  papel: Papel;
  custoVelas: number;
  status: StatusRodada;
  porque: string | null;
  criadaEm: string;
}

const COLUNAS_RODADA =
  "id, origem, estrategia_id, capital_usd, simbolos, intervalo, janela_de, janela_ate, praca, papel, custo_velas, status, porque, criada_em";

type LinhaRodada = {
  id: string; origem: string; estrategia_id: string | null; capital_usd: number | string;
  simbolos: string[] | null; intervalo: string; janela_de: number | string; janela_ate: number | string;
  praca: string; papel: string; custo_velas: number | string; status: string;
  porque: string | null; criada_em: string;
};

function paraRodada(r: LinhaRodada): Rodada {
  return {
    id: r.id,
    origem: r.origem === "casa" ? "casa" : "propria",
    estrategiaId: r.estrategia_id,
    capitalUsd: Number(r.capital_usd),
    simbolos: r.simbolos ?? [],
    intervalo: r.intervalo,
    janelaDe: Number(r.janela_de),
    janelaAte: Number(r.janela_ate),
    praca: r.praca as Praca,
    papel: r.papel as Papel,
    custoVelas: Number(r.custo_velas),
    status: r.status as StatusRodada,
    porque: r.porque,
    criadaEm: r.criada_em,
  };
}

export async function listarRodadas(dono: Dono, db: SupabaseClient, limite = 50): Promise<Rodada[]> {
  const { data, error } = await doDono(db, "bancada_rodada", dono, COLUNAS_RODADA)
    .order("criada_em", { ascending: false })
    .limit(Math.max(1, Math.min(200, Math.floor(limite))));
  if (error || !data) return [];
  return (data as unknown as LinhaRodada[]).map(paraRodada);
}

export async function rodada(dono: Dono, db: SupabaseClient, id: string): Promise<Rodada | null> {
  const { data, error } = await doDono(db, "bancada_rodada", dono, COLUNAS_RODADA)
    .eq("id", id).maybeSingle();
  if (error || !data) return null;
  return paraRodada(data as unknown as LinhaRodada);
}

/** ⚠️ A JANELA DA COTA É MÓVEL, 24h — e a escolha tem motivo. */
export const JANELA_DA_COTA_MS = 24 * 60 * 60 * 1000;

export interface ConsumoDoDia {
  /** Quantas rodadas nas últimas 24h. A cota VISÍVEL da §6.2. */
  rodadas: number;
  /** `Σ símbolos × velas`. O freio REAL — é isto que gasta CPU. */
  velas: number;
}

/**
 * O que este dono já consumiu na janela móvel.
 *
 * ⚠️⚠️ O CONTADOR SÃO AS PRÓPRIAS LINHAS, não um contador à parte. Um contador
 * separado pode divergir do que de fato aconteceu — e diverge sempre para o
 * lado errado, porque quem falha é a escrita do contador, não a da rodada.
 *
 * ⚠️ E A JANELA É MÓVEL DE 24h, NÃO O DIA DO CALENDÁRIO. Reset à meia-noite
 * convida ao consumo dobrado na virada: gastar a cota inteira às 23h59 e a
 * cota inteira de novo às 00h01. Contra a janela móvel isso não existe.
 *
 * ⚠️ `null` = NÃO SEI. Quem chama tem de recusar, não liberar: uma falha de
 * leitura não pode virar cota infinita.
 */
export async function consumoDaJanela(
  dono: Dono, db: SupabaseClient, agoraMs: number = Date.now(),
): Promise<ConsumoDoDia | null> {
  const desde = new Date(agoraMs - JANELA_DA_COTA_MS).toISOString();
  const { data, error } = await doDono(db, "bancada_rodada", dono, "custo_velas, status")
    .gte("criada_em", desde);
  if (error || !data) return null;
  const linhas = data as unknown as Array<{ custo_velas: number | string; status: string }>;
  /**
   * ⚠️ RODADA RECUSADA NÃO CONSOME COTA. Ela é recusada pelo PORTÃO, antes de
   * qualquer vela ser lida — cobrar por ela puniria o cliente justamente pela
   * mensagem que o impediu de perder dinheiro, e ensinaria a não testar.
   */
  const contam = linhas.filter((l) => l.status !== "recusada");
  return {
    rodadas: contam.length,
    velas: contam.reduce((s, l) => s + (Number(l.custo_velas) || 0), 0),
  };
}

// ── RESULTADOS ──────────────────────────────────────────────────────

export interface ResultadoNovo {
  brutoPct: number;
  taxaPct: number;
  /**
   * ⚠️ `null` = NÃO MEDIDO, e nunca 0 (migration 0038). Um backtest lê velas, e
   * vela não tem livro de ofertas: gravar 0 aqui afirmaria que a derrapagem foi
   * medida e não existiu. O nome do que falta vai em `naoMedido`.
   */
  derrapagemPct: number | null;
  liquidoPct: number;
  n: number;
  acertos: number;
  equilibrioExigidoPct: number | null;
  veredito: Veredito;
  /** ⚠️ O que NÃO foi medido, com nome. Lista vazia = medimos tudo. */
  naoMedido: string[];
}

export async function gravarResultado(
  dono: Dono, db: SupabaseClient, rodadaId: string, r: ResultadoNovo,
): Promise<Escrita<true>> {
  const { error } = await db.from("bancada_resultado").upsert({
    rodada_id: rodadaId,
    dono,
    bruto_pct: r.brutoPct,
    taxa_pct: r.taxaPct,
    derrapagem_pct: r.derrapagemPct,
    liquido_pct: r.liquidoPct,
    n: Math.max(0, Math.floor(r.n)),
    acertos: Math.max(0, Math.floor(r.acertos)),
    equilibrio_exigido_pct: r.equilibrioExigidoPct,
    veredito: r.veredito,
    nao_medido: r.naoMedido,
  }, { onConflict: "rodada_id" });
  if (error) return falhou(error, "gravar resultado");
  return { ok: true, valor: true };
}

export interface Resultado extends ResultadoNovo { rodadaId: string; criadoEm: string }

const COLUNAS_RESULTADO =
  "rodada_id, bruto_pct, taxa_pct, derrapagem_pct, liquido_pct, n, acertos, equilibrio_exigido_pct, veredito, nao_medido, criado_em";

type LinhaResultado = {
  rodada_id: string; bruto_pct: number | string; taxa_pct: number | string;
  derrapagem_pct: number | string | null; liquido_pct: number | string;
  n: number; acertos: number; equilibrio_exigido_pct: number | string | null;
  veredito: string; nao_medido: unknown; criado_em: string;
};

export async function resultado(dono: Dono, db: SupabaseClient, rodadaId: string): Promise<Resultado | null> {
  const { data, error } = await doDono(db, "bancada_resultado", dono, COLUNAS_RESULTADO)
    .eq("rodada_id", rodadaId).maybeSingle();
  if (error || !data) return null;
  const r = data as unknown as LinhaResultado;
  const eq = r.equilibrio_exigido_pct;
  return {
    rodadaId: r.rodada_id,
    brutoPct: Number(r.bruto_pct),
    taxaPct: Number(r.taxa_pct),
    // ⚠️ `Number(null)` é 0 e passa em `isFinite` — a cicatriz mais barata de
    // repetir desta base, e aqui ela transformaria "não medimos" em "medimos e
    // deu zero".
    derrapagemPct: r.derrapagem_pct == null ? null : Number(r.derrapagem_pct),
    liquidoPct: Number(r.liquido_pct),
    n: Number(r.n),
    acertos: Number(r.acertos),
    // ⚠️ `Number(null)` é 0 e passa em `isFinite` — a cicatriz mais barata de
    // repetir desta base. Ausência tem de continuar ausência.
    equilibrioExigidoPct: eq == null ? null : Number(eq),
    veredito: r.veredito as Veredito,
    naoMedido: Array.isArray(r.nao_medido) ? (r.nao_medido as unknown[]).map(String) : [],
    criadoEm: r.criado_em,
  };
}

// ── PAPEL ADIANTE ───────────────────────────────────────────────────

export interface PosicaoNova {
  estrategiaId: string;
  simbolo: string;
  lado: "long" | "short";
  entrada: number;
  tamanhoUsd: number;
  alvoPct: number | null;
  stopPct: number | null;
  expiraEm: string | null;
  /**
   * ⚠️ De qual VELA veio o sinal (unix ms) — migration 0040. É ela que impede o
   * mesmo cruzamento de abrir duas vezes quando o cron tick mais rápido do que
   * a vela fecha. NÃO confundir com `aberta_em` (quando a linha foi criada).
   */
  velaEm: number | null;
}

export async function abrirPosicao(
  dono: Dono, db: SupabaseClient, p: PosicaoNova,
): Promise<Escrita<string>> {
  const { data, error } = await db.from("bancada_posicao").insert({
    dono,
    estrategia_id: p.estrategiaId,
    simbolo: p.simbolo,
    lado: p.lado,
    entrada: p.entrada,
    tamanho_usd: p.tamanhoUsd,
    alvo_pct: p.alvoPct,
    stop_pct: p.stopPct,
    expira_em: p.expiraEm,
    vela_em: p.velaEm,
    status: "aberta",
  }).select("id").single();
  if (error || !data) return falhou(error, "abrir posição");
  return { ok: true, valor: String((data as { id: string }).id) };
}

export interface Posicao extends PosicaoNova { id: string; dono: Dono; status: StatusPosicao; abertaEm: string }

const COLUNAS_POSICAO =
  "id, dono, estrategia_id, simbolo, lado, entrada, tamanho_usd, alvo_pct, stop_pct, expira_em, vela_em, status, aberta_em";

type LinhaPosicao = {
  id: string; dono: string; estrategia_id: string; simbolo: string; lado: string;
  entrada: number | string; tamanho_usd: number | string;
  alvo_pct: number | string | null; stop_pct: number | string | null;
  expira_em: string | null; vela_em: number | string | null;
  status: string; aberta_em: string;
};

function paraPosicao(r: LinhaPosicao): Posicao | null {
  const d = donoDeLinhaDoBanco(r.dono);
  if (!d) return null;
  return {
    id: r.id,
    dono: d,
    estrategiaId: r.estrategia_id,
    simbolo: r.simbolo,
    lado: r.lado === "short" ? "short" : "long",
    entrada: Number(r.entrada),
    tamanhoUsd: Number(r.tamanho_usd),
    alvoPct: r.alvo_pct == null ? null : Number(r.alvo_pct),
    stopPct: r.stop_pct == null ? null : Number(r.stop_pct),
    expiraEm: r.expira_em,
    velaEm: r.vela_em == null ? null : Number(r.vela_em),
    abertaEm: r.aberta_em,
    status: r.status as StatusPosicao,
  };
}

export async function posicoesAbertas(dono: Dono, db: SupabaseClient): Promise<Posicao[]> {
  const { data, error } = await doDono(db, "bancada_posicao", dono, COLUNAS_POSICAO)
    .eq("status", "aberta").order("aberta_em", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as LinhaPosicao[]).map(paraPosicao).filter((p): p is Posicao => p !== null);
}

/**
 * ⚠️⚠️ A ÚNICA FUNÇÃO DESTE ARQUIVO SEM DONO — e o nome grita por quê.
 *
 * O cron do papel adiante varre as posições abertas de TODO MUNDO; não há
 * sessão, e não há uma carteira "certa" a filtrar. Cada linha carrega o dono
 * dela, e `paraPosicao` o reconstrói com `donoDeLinhaDoBanco` — carteira que
 * veio do próprio banco, nunca de requisição.
 *
 * ⚠️ SE ESTA FUNÇÃO APARECER NUMA ROTA DE CLIENTE, o isolamento acabou. Ela
 * existe para o cron e o nome é a trava: `paraOCron` numa rota `/api/bancada/*`
 * é impossível de ler como acidente.
 */
export async function posicoesAbertasParaOCron(db: SupabaseClient, limite = 500): Promise<Posicao[]> {
  const { data, error } = await db.from("bancada_posicao")
    .select(COLUNAS_POSICAO)
    .eq("status", "aberta")
    .order("aberta_em", { ascending: true })
    .limit(Math.max(1, Math.min(2000, Math.floor(limite))));
  if (error || !data) return [];
  return (data as unknown as LinhaPosicao[]).map(paraPosicao).filter((p): p is Posicao => p !== null);
}

/**
 * ⚠️ `expirada` NÃO É NEM GANHO NEM PERDA. Contá-la como derrota infla o custo,
 * como vitória infla a borda — é cicatriz do flywheel, e o `check` da coluna
 * mantém as quatro classes separadas no banco também.
 */
export async function fecharPosicao(
  dono: Dono, db: SupabaseClient, id: string,
  status: Exclude<StatusPosicao, "aberta">, saida: number | null, resultadoPct: number | null,
): Promise<Escrita<true>> {
  const { error } = await db.from("bancada_posicao").update({
    status, saida, resultado_pct: resultadoPct, fechada_em: new Date().toISOString(),
  }).eq("dono", dono).eq("id", id);
  if (error) return falhou(error, "fechar posição");
  return { ok: true, valor: true };
}
