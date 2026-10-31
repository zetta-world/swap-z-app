/**
 * Model-aware Anthropic cost estimation — the single source of truth for
 * "how much did this AI usage cost". Replaces the old flat `{input:3,
 * output:15, cacheRead:0.30}` table that (a) priced every model as Sonnet and
 * (b) ignored cache-WRITE entirely, which on a cache-heavy workload is the
 * single largest input line item (~24% of the bill went uncounted).
 *
 * Prices are USD per 1M tokens. Cache write 5m = 1.25× base input; cache write
 * 1h = 2× base input; cache read = 0.1× base input (Anthropic's standard
 * prompt-cache multipliers).
 */

interface ModelPrice {
  input: number;       // per 1M, uncached input
  output: number;      // per 1M, output
  cacheWrite5m: number;// per 1M, 5-minute cache write (1.25× input)
  cacheWrite1h: number;// per 1M, 1-hour cache write (2× input)
  cacheRead: number;   // per 1M, cache read (0.1× input)
}

function tier(input: number, output: number): ModelPrice {
  return { input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead: input * 0.1 };
}

/**
 * ⚠️ PREÇO DE LISTA PUBLICADO, com leitura e escrita de cache EXPLÍCITAS (RM-08).
 *
 * `tier()` aplica os multiplicadores da Anthropic (leitura 0,1×, escrita 1,25×).
 * Outros provedores NÃO seguem essa regra: o Kimi K2 cobra a leitura a 0,16 sobre
 * 0,95 (≈0,17×) e não tem preço de escrita separado (a escrita sai a preço de
 * entrada). Aplicar 0,1× nele subestimava a leitura em 1,7×.
 */
function lista(input: number, output: number, cacheRead: number, cacheWrite: number): ModelPrice {
  return { input, output, cacheWrite5m: cacheWrite, cacheWrite1h: cacheWrite, cacheRead };
}

// Keyed by a substring of the model id so version suffixes still match.
const PRICES: Array<[RegExp, ModelPrice]> = [
  // Opus 4.5+ is $5/$25 per MTok (official API pricing). The old tier(15, 75)
  // was Opus 4.1-era pricing and inflated the FINANCE estimate 3x.
  [/opus/i,            tier(5, 25)],
  [/sonnet/i,          tier(3, 15)],
  [/haiku/i,           tier(1, 5)],
  // Open/hosted models in the A/B (approximate public rates — the authoritative
  // cost is each provider's own console balance).
  /**
   * ⚠️ RM-08 (05/10/2026): preço de LISTA da página oficial do Kimi para o
   * `kimi-k2.6` — entrada (cache miss) 0,95, cache hit 0,16, saída 4,00 por
   * 1M; a série K2 não publica preço de escrita, então a escrita sai a preço de
   * entrada. A tabela antiga (0,60/2,50, leitura 0,06) estava abaixo da lista
   * em ~1,6× — e o modelo de 36 meses partia dela. A página não tem data; a
   * fonte autoritativa continua sendo a fatura do console.
   */
  [/kimi|moonshot/i,   lista(0.95, 4.0, 0.16, 0.95)],
  /**
   * ⚠️ RM-08 (05/10/2026): DeepSeek cobra por HORÁRIO (pico = 2× fora de pico).
   * Aqui vai o preço de PICO (limite superior, conservador). v4-flash e v4-pro
   * têm preços ~5× diferentes — a mais específica vem primeiro. Sem escrita.
   */
  [/deepseek.*flash/i, lista(0.3, 1.2, 0.006, 0.3)],
  [/deepseek/i,        lista(1.32, 3.96, 0.044, 1.32)],
  // Mistral runs on the FREE tier here (console 27/07: plano Gratuito,
  // pay-as-you-go OFF) — cash cost is $0 and the real constraint is the
  // monthly quota, not dollars. This line stays as the rate that WOULD
  // apply if pay-as-you-go is ever enabled; until then FINANCE overstates
  // Mistral, which is why it looked like our priciest agent when it is
  // in fact our cheapest.
  [/mistral/i,         tier(2, 6)],
  [/grok|xai/i,        tier(1.25, 2.5)],
  [/llama/i,           tier(0.2, 0.6)],
];
// Default to Sonnet pricing when the model is unknown/absent (old events).
const DEFAULT_PRICE = tier(3, 15);

export function priceForModel(model?: string | null): ModelPrice {
  if (model) for (const [re, p] of PRICES) if (re.test(model)) return p;
  return DEFAULT_PRICE;
}

export interface UsageTokens {
  model?:            string | null;
  inTokens?:         number;  // uncached input
  outTokens?:        number;
  cachedTokens?:     number;  // cache read
  cacheWriteTokens?: number;  // cache creation (5m); 1h tracked separately if ever used
}

/** USD cost for one usage record, priced by its own model. */
export function estimateCost(u: UsageTokens): number {
  const p = priceForModel(u.model);
  return (
    (u.inTokens ?? 0)         * p.input        +
    (u.outTokens ?? 0)        * p.output       +
    (u.cachedTokens ?? 0)     * p.cacheRead    +
    (u.cacheWriteTokens ?? 0) * p.cacheWrite5m
  ) / 1_000_000;
}

/** O modelo tem linha própria na tabela? `false` = foi precificado pelo padrão (Sonnet). */
export function temPrecoProprio(model?: string | null): boolean {
  return !!model && PRICES.some(([re]) => re.test(model));
}

// ── Agregação do uso (painel CUSTO DE IA, FINANCE, COMMAND) ──────────────────

export interface LinhaDeUsoIa { metadata: unknown; created_at: string }

export interface ModeloAgregado {
  model: string; today: number; week: number; month: number; all: number; calls: number;
  /** ⚠️ Sem modelo ou modelo fora da tabela: o custo é o do padrão (Sonnet), não o dele. */
  precoPadrao: boolean;
}

export interface AgregadoIa {
  today: number; week: number; month: number; year: number; all: number;
  /** Chamadas que FORAM ao provedor. Resposta servida do cache não entra (ver `respostasDoCache`). */
  calls: { today: number; week: number; month: number; year: number; all: number };
  byModel: Record<string, number>;
  bySource: Record<string, number>;
  models: ModeloAgregado[];
  /** `input` = entrada NÃO cacheada; leitura e escrita de cache à parte — somadas uma vez só. */
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** 14 dias UTC. Dia sem chamada = `calls: 0` (medido: nenhuma), não um zero inventado. */
  daily: Array<{ date: string; cost: number; calls: number }>;
  monthProjection: number;
  /** Eventos `cacheHit: true` — servidos da memória, sem chamada nem token. */
  respostasDoCache: number;
  /** Chamadas precificadas pelo padrão por falta de modelo conhecido. */
  semPrecoProprio: number;
  /** Eventos com token ilegível (texto, NaN, negativo): o token entra como 0 e o evento é contado aqui. */
  tokensIlegiveis: number;
  /** Eventos com `created_at` ilegível: entram no total, fora das janelas. */
  datasIlegiveis: number;
}

/** Token legível: número finito ≥ 0 (ou texto numérico, que é como `numeric` às vezes chega). */
function token(v: unknown): number | null {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * ⚠️ ADM-007 — UMA conta por chamada, pelo modelo DELA.
 *
 *   · `inTokens` é a entrada NÃO cacheada (`provider.ts` normaliza; `entradaOpenAICompat`
 *     tira a leitura e a escrita de cache de dentro dela). Leitura e escrita de cache são
 *     somadas cada uma UMA vez, a preço próprio — nunca de novo como entrada.
 *   · Resposta servida pelo cache de resposta (`cacheHit: true`, `zion/route.ts`) não foi ao
 *     provedor: não entra em custo, token nem chamada, mesmo que algum dia venha com tokens
 *     copiados da chamada original — contar seria cobrar a mesma resposta duas vezes.
 *   · Modelo ausente/desconhecido cai no preço padrão e é CONTADO (`semPrecoProprio`), em vez
 *     de sumir dentro do total como se fosse Sonnet de verdade.
 *   · Token ilegível vira 0 e é contado — um `NaN` derrubava o total inteiro para "NaN".
 *
 * ⚠️ ESTIMATIVA: tarifa pública × tokens medidos, recalculada com a tabela de HOJE. Não é fatura.
 */
export function agregarUsoDeIa(linhas: readonly LinhaDeUsoIa[], agoraMs: number): AgregadoIa {
  const d0 = new Date(agoraMs);
  const Y = d0.getUTCFullYear(), Mo = d0.getUTCMonth(), Da = d0.getUTCDate();
  const inicioDia = Date.UTC(Y, Mo, Da);
  const inicioMes = Date.UTC(Y, Mo, 1);
  const inicioAno = Date.UTC(Y, 0, 1);
  const semanaAtras = agoraMs - 7 * 86_400_000;
  const chaveDia = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const dias = new Map<string, { cost: number; calls: number }>();
  for (let i = 13; i >= 0; i--) dias.set(chaveDia(agoraMs - i * 86_400_000), { cost: 0, calls: 0 });

  const ai: AgregadoIa = {
    today: 0, week: 0, month: 0, year: 0, all: 0,
    calls: { today: 0, week: 0, month: 0, year: 0, all: 0 },
    byModel: {}, bySource: {}, models: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    daily: [], monthProjection: 0,
    respostasDoCache: 0, semPrecoProprio: 0, tokensIlegiveis: 0, datasIlegiveis: 0,
  };
  const porModelo = new Map<string, ModeloAgregado>();

  for (const r of linhas) {
    const m = (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as Record<string, unknown>;
    if (m.cacheHit === true) { ai.respostasDoCache++; continue; }

    const modelo = typeof m.model === "string" && m.model.trim() ? m.model.trim() : null;
    const fonte = typeof m.source === "string" && m.source ? m.source : "user";
    const brutos = [token(m.inTokens), token(m.outTokens), token(m.cachedTokens), token(m.cacheWriteTokens)];
    if (brutos.some((t) => t === null)) ai.tokensIlegiveis++;
    const [inT, outT, lidoT, escritoT] = brutos.map((t) => t ?? 0);
    const c = estimateCost({ model: modelo, inTokens: inT, outTokens: outT, cachedTokens: lidoT, cacheWriteTokens: escritoT });
    const proprio = temPrecoProprio(modelo);
    if (!proprio) ai.semPrecoProprio++;

    ai.all += c; ai.calls.all++;
    ai.tokens.input += inT; ai.tokens.output += outT; ai.tokens.cacheRead += lidoT; ai.tokens.cacheWrite += escritoT;
    const chave = modelo ?? "unknown";
    ai.byModel[chave] = (ai.byModel[chave] ?? 0) + c;
    ai.bySource[fonte] = (ai.bySource[fonte] ?? 0) + c;
    const agg = porModelo.get(chave) ?? { model: chave, today: 0, week: 0, month: 0, all: 0, calls: 0, precoPadrao: !proprio };
    agg.all += c; agg.calls++;

    const ts = Date.parse(r.created_at);
    if (!Number.isFinite(ts)) { ai.datasIlegiveis++; porModelo.set(chave, agg); continue; }
    if (ts >= inicioAno)   { ai.year  += c; ai.calls.year++; }
    if (ts >= inicioMes)   { ai.month += c; ai.calls.month++; agg.month += c; }
    if (ts >= semanaAtras) { ai.week  += c; ai.calls.week++;  agg.week  += c; }
    if (ts >= inicioDia)   { ai.today += c; ai.calls.today++; agg.today += c; }
    porModelo.set(chave, agg);
    const dia = dias.get(chaveDia(ts));
    if (dia) { dia.cost += c; dia.calls++; }
  }

  ai.daily = [...dias.entries()].map(([date, v]) => ({ date, cost: v.cost, calls: v.calls }));
  ai.models = [...porModelo.values()].sort((a, b) => b.all - a.all);
  const diasNoMes = new Date(Date.UTC(Y, Mo + 1, 0)).getUTCDate();
  ai.monthProjection = (ai.month / Da) * diasNoMes;
  return ai;
}
