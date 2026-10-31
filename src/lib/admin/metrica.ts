/**
 * MÉTRICA OPERACIONAL — o contrato de verdade das telas de dinheiro e operação (R0, Admin 2.0).
 *
 * ⚠️⚠️ "NÃO SEI" NÃO É "ZERO". O padrão que esta casa já pagou caro: `count ?? 0`,
 * `data ?? []`, 14 barras pré-zeradas — e uma queda do banco aparecia como "$0 · 0 operações
 * · ALL CLEAR". Cada número que sai daqui carrega o ESTADO da leitura que o produziu:
 *
 *   · `ok`          — a fonte respondeu e o valor é o valor;
 *   · `zero`        — a fonte respondeu e o número É zero (há registros, somam 0 / contagem 0);
 *   · `empty`       — a fonte respondeu e a coleção veio vazia ("nunca visto" num batimento);
 *   · `stale`       — o último valor era válido e perdeu o frescor;
 *   · `partial`     — parte faltou (corte declarado, ou uma das fontes caiu): NÃO é total;
 *   · `unavailable` — a fonte necessária não respondeu: `value` é null, nunca 0;
 *   · `error`       — a fonte respondeu algo que não é número/data válida.
 *
 * E a QUALIDADE do número, que não é rodapé: `verified` (on-chain conferido), `measured`
 * (lido do nosso banco), `estimated` (tabela de preço × tokens — NÃO é fatura), `declared`
 * (o navegador/tier disse), `simulated` (papel/laboratório — nunca dinheiro).
 *
 * Não inventa padrão paralelo: os construtores partem das formas que o repo já tem —
 * `Contagem` de `growth.ts` (o `{count, error}` do supabase-js), `LeituraPaginada` de
 * `supabase/paginar.ts` (com `truncado`) e `LeituraKv` de `early-access/gate.ts` (`lido`).
 * O estado agregado da resposta segue o `estado` de `growth.ts` (completo | parcial | indisponivel).
 *
 * ⚠️ MÓDULO PURO, importável por painel client: nada daqui importa módulo de servidor. Trazer o
 * cliente do Supabase para cá levaria `supabase/server.ts` ao navegador (ele lança lá).
 */
import type { LeituraPaginada } from "@/lib/supabase/paginar";

/**
 * ⚠️ FORMAS REPETIDAS DE PROPÓSITO (estruturalmente iguais às de `growth.ts` e
 * `early-access/gate.ts`). Importar até um TIPO de lá puxa o MÓDULO para o
 * painel, e os dois importam `supabase/server` — a trava
 * `nao-vaza-para-o-cliente` pegou isto. TypeScript é estrutural: quem passa a
 * forma de lá aqui continua compilando.
 */
export interface Contagem { count: number | null; error: { message: string } | null }
export type LeituraKv = { lido: true; valor: string | null } | { lido: false };

export type DataState = "ok" | "zero" | "empty" | "stale" | "partial" | "unavailable" | "error";
export type Quality = "verified" | "measured" | "estimated" | "declared" | "simulated";
export type ErrorCode =
  | "db_indisponivel" | "leitura_falhou" | "excecao" | "tempo_esgotado"
  | "truncado" | "valor_invalido" | "config_ausente" | "upstream";

export interface Cobertura { expected: number | null; observed: number; truncated: boolean }

export interface OperationalMetric<T> {
  state: DataState;
  /** null = desconhecido. NUNCA 0 implícito. */
  value: T | null;
  quality: Quality;
  /** "platform_events/zion_analysis", "admin_kv", "coingecko"… */
  source: string;
  /** Quando a fonte foi lida (ou quando o dado nasceu, num batimento). */
  asOf: string | null;
  coverage?: Cobertura;
  /** Sem stack, PII ou segredo. */
  errorCode?: ErrorCode;
  staleAfterSec?: number;
}

/** Estado da resposta inteira — o mesmo vocabulário de `growth.ts`. */
export type EstadoResposta = "completo" | "parcial" | "indisponivel";

/**
 * Orçamento de leitura de uma fonte num painel. O mesmo número de `GATE_KV_TIMEOUT_MS`
 * (`early-access/gate.ts`): com o banco fora, a leitura levava ~20 s para falhar (ensaio
 * X05) e o painel ficava pendurado. Não importa a constante de lá porque aquele módulo
 * puxa o cliente do servidor.
 */
export const TETO_PADRAO_MS = 3_000;

const ehZeroNumerico = (v: unknown): boolean => typeof v === "number" && v === 0;

// ── Construtores ──────────────────────────────────────────────────────────────

export function indisponivel<T>(
  source: string, quality: Quality, errorCode: ErrorCode, asOf: string | null = null,
): OperationalMetric<T> {
  return { state: "unavailable", value: null, quality, source, asOf, errorCode };
}

/** `{ count, error }` do supabase-js (`head: true`). */
export function deContagem(
  c: Contagem, source: string, opcoes: { quality?: Quality; asOf?: string | null } = {},
): OperationalMetric<number> {
  const quality = opcoes.quality ?? "measured";
  const asOf = opcoes.asOf ?? null;
  if (c.error) return indisponivel(source, quality, "leitura_falhou", asOf);
  if (typeof c.count !== "number" || !Number.isFinite(c.count) || c.count < 0) {
    // A fonte respondeu sem o número pedido. Não é "nenhum" — é "não sei".
    return { state: "error", value: null, quality, source, asOf, errorCode: "valor_invalido" };
  }
  return { state: c.count === 0 ? "zero" : "ok", value: c.count, quality, source, asOf };
}

/**
 * `LeituraPaginada` → métrica. Erro = `unavailable` (sem valor: meia soma é pior que
 * nenhuma, `paginar.ts`). Corte do teto = `partial` COM o valor do que foi visto e a
 * cobertura — a tela diz "parcial", não "total".
 */
export function deLeitura<L, T>(
  l: LeituraPaginada<L>,
  source: string,
  agregar: (linhas: L[]) => T,
  opcoes: { quality?: Quality; asOf?: string | null; esperado?: number | null } = {},
): OperationalMetric<T> {
  const quality = opcoes.quality ?? "measured";
  const asOf = opcoes.asOf ?? null;
  if (l.erro) return indisponivel(source, quality, "leitura_falhou", asOf);
  const coverage: Cobertura | undefined = l.truncado || opcoes.esperado != null
    ? { expected: opcoes.esperado ?? null, observed: l.linhas.length, truncated: l.truncado }
    : undefined;
  const value = agregar(l.linhas);
  if (l.truncado) return { state: "partial", value, quality, source, asOf, coverage, errorCode: "truncado" };
  const state: DataState = l.linhas.length === 0 ? "empty" : ehZeroNumerico(value) ? "zero" : "ok";
  return { state, value, quality, source, asOf, ...(coverage ? { coverage } : {}) };
}

/** `LeituraKv` → métrica de texto. `dominio` rejeita valor fora do esperado. */
export function deKv(
  l: LeituraKv, source: string,
  opcoes: { quality?: Quality; asOf?: string | null; dominio?: (v: string) => boolean } = {},
): OperationalMetric<string> {
  const quality = opcoes.quality ?? "measured";
  const asOf = opcoes.asOf ?? null;
  if (!l.lido) return indisponivel(source, quality, "leitura_falhou", asOf);
  if (l.valor === null) return { state: "empty", value: null, quality, source, asOf };
  if (opcoes.dominio && !opcoes.dominio(l.valor)) {
    return { state: "error", value: null, quality, source, asOf, errorCode: "valor_invalido" };
  }
  return { state: "ok", value: l.valor, quality, source, asOf };
}

/**
 * Batimento de cron (`cron:<nome>:last`). Ausente = `empty` ("nunca visto"); velho =
 * `stale`; ilegível = `error`; leitura que falhou = `unavailable`. ⚠️ Os dois últimos
 * eram "never" na tela — desconhecido mostrado como "o cron nunca rodou".
 */
export function deBatimento(
  l: LeituraKv, staleAfterSec: number, agoraMs: number, source: string,
): OperationalMetric<string> {
  if (!l.lido) return { ...indisponivel<string>(source, "measured", "leitura_falhou"), staleAfterSec };
  if (l.valor === null) return { state: "empty", value: null, quality: "measured", source, asOf: null, staleAfterSec };
  const t = Date.parse(l.valor);
  if (!Number.isFinite(t)) {
    return { state: "error", value: null, quality: "measured", source, asOf: null, errorCode: "valor_invalido", staleAfterSec };
  }
  const velho = (agoraMs - t) / 1000 > staleAfterSec;
  return { state: velho ? "stale" : "ok", value: l.valor, quality: "measured", source, asOf: l.valor, staleAfterSec };
}

/**
 * Estado da resposta a partir das métricas. Todas indisponíveis = `indisponivel`; alguma
 * indisponível, com erro ou parcial = `parcial` (não soma como total); senão `completo`.
 */
export function estadoGeral(ms: ReadonlyArray<OperationalMetric<unknown> | null | undefined>): EstadoResposta {
  const falhou = (m: OperationalMetric<unknown> | null | undefined) =>
    m == null || m.state === "unavailable" || m.state === "error";
  if (ms.length === 0 || ms.every(falhou)) return "indisponivel";
  if (ms.some((m) => falhou(m) || m!.state === "partial")) return "parcial";
  return "completo";
}

// ── Leitura com teto e sem exceção ───────────────────────────────────────────

export type ComTeto<T> =
  | { ok: true; valor: T; ms: number }
  | { ok: false; errorCode: "tempo_esgotado" | "excecao"; ms: number };

/** Nunca lança. Estourar o orçamento = `tempo_esgotado` (a promessa original é abandonada). */
export async function comTeto<T>(p: PromiseLike<T> | (() => PromiseLike<T>), ms: number = TETO_PADRAO_MS): Promise<ComTeto<T>> {
  const inicio = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<ComTeto<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, errorCode: "tempo_esgotado", ms: Date.now() - inicio }), ms);
  });
  const leitura = (async (): Promise<ComTeto<T>> => {
    try {
      const valor = await (typeof p === "function" ? p() : p);
      return { ok: true, valor, ms: Date.now() - inicio };
    } catch {
      return { ok: false, errorCode: "excecao", ms: Date.now() - inicio };
    }
  })();
  try {
    return await Promise.race([leitura, estouro]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `{ count, error }` que nunca lança. O supabase-js resolve com `error` na maioria das
 * falhas, mas não em todas — e um `Promise.all` com uma rejeição derruba a tela inteira.
 */
export async function contagemSegura(
  p: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<Contagem> {
  try {
    const { count, error } = await p;
    return { count, error: error ? { message: String(error.message ?? "erro sem mensagem").slice(0, 200) } : null };
  } catch (e) {
    return { count: null, error: { message: (e instanceof Error ? e.message : "exceção sem mensagem").slice(0, 200) } };
  }
}

// ── Exibição (painel client) ─────────────────────────────────────────────────

export type Selo = "INDISPONÍVEL" | "ERRO" | "PARCIAL" | "DESATUALIZADO" | "ZERO" | "SEM REGISTROS";

export interface Exibicao {
  /** O que vai no lugar do número. "—" quando não há número. */
  texto: string;
  /** Etiqueta ao lado do número; null quando o número é o número (`ok`). */
  selo: Selo | null;
  /** Cor do selo/valor; null = a cor que o painel já usa para o valor. */
  cor: string | null;
  /** Dica (title): fonte, qualidade, quando, cobertura, código. */
  dica: string;
}

const QUALIDADE: Record<Quality, string> = {
  verified: "VERIFICADO", measured: "MEDIDO", estimated: "ESTIMADO", declared: "DECLARADO", simulated: "SIMULADO",
};
export const rotuloQualidade = (q: Quality): string => QUALIDADE[q] ?? q.toUpperCase();

function dicaDe(m: OperationalMetric<unknown>): string {
  const partes = [`${rotuloQualidade(m.quality)} · ${m.source}`];
  if (m.asOf) partes.push(`em ${m.asOf}`);
  if (m.coverage) {
    partes.push(`cobertura ${m.coverage.observed}${m.coverage.expected != null ? `/${m.coverage.expected}` : ""}${m.coverage.truncated ? " (cortada)" : ""}`);
  }
  if (m.errorCode) partes.push(`código ${m.errorCode}`);
  return partes.join(" · ");
}

/**
 * Como mostrar uma métrica. ⚠️ Os quatro casos que a tela confundia ficam distintos:
 * "—" + INDISPONÍVEL (não li), valor + PARCIAL (li parte), valor + ZERO (li, é zero),
 * valor + SEM REGISTROS (li, não há nada). Métrica ausente na resposta = INDISPONÍVEL.
 */
export function exibirMetrica<T>(
  m: OperationalMetric<T> | null | undefined,
  formatar: (v: T) => string,
): Exibicao {
  if (m == null) return { texto: "—", selo: "INDISPONÍVEL", cor: "var(--adm-red)", dica: "a resposta não trouxe esta métrica" };
  const dica = dicaDe(m);
  const fmt = () => (m.value == null ? "—" : formatar(m.value));
  switch (m.state) {
    case "unavailable": return { texto: "—", selo: "INDISPONÍVEL", cor: "var(--adm-red)", dica };
    case "error":       return { texto: "—", selo: "ERRO", cor: "var(--adm-red)", dica };
    case "partial":     return { texto: fmt(), selo: "PARCIAL", cor: "var(--adm-amber)", dica };
    case "stale":       return { texto: fmt(), selo: "DESATUALIZADO", cor: "var(--adm-amber)", dica };
    case "zero":        return { texto: fmt(), selo: "ZERO", cor: "var(--adm-ink-3)", dica };
    case "empty":       return { texto: fmt(), selo: "SEM REGISTROS", cor: "var(--adm-ink-3)", dica };
    default:            return { texto: fmt(), selo: null, cor: null, dica };
  }
}

/**
 * A mensagem de uma resposta não-ok. A rota manda `{ state, errorCode }` (ou o `error`
 * antigo); a tela diz INDISPONÍVEL com o código — nunca um quadro de zeros.
 */
export function mensagemDeFalha(status: number, corpo: unknown): string {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as { errorCode?: unknown; error?: unknown };
  const codigo = typeof c.errorCode === "string" ? c.errorCode : typeof c.error === "string" ? c.error : null;
  return `INDISPONÍVEL — ${codigo ?? "sem código"} (HTTP ${status})`;
}

/**
 * A fonte PRINCIPAL de uma tela falhou? Devolve o motivo (para mostrar) ou null.
 * Lê o `falha` que `/receita` sempre mandou (e a tela nunca leu) e o `estado` do contrato.
 */
export function falhaDaTela(d: { falha?: string | null; estado?: string | null } | null | undefined): string | null {
  if (!d) return "sem resposta";
  if (typeof d.falha === "string" && d.falha.length > 0) return d.falha;
  if (d.estado === "indisponivel") return "fonte principal indisponível";
  return null;
}
