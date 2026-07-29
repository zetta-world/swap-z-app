/**
 * ULLR — o arqueiro. A mesa de LANÇAMENTO, reescrita (docs/PLANO-RAGNAROK.md).
 *
 * O sniper antigo caçava os 14 majors com gatilho de preço e podia emitir
 * SHORT. Isso não é o que o dono descreveu:
 *
 *   "o sniper encontra um token recém-lançado com probabilidade alta de pump,
 *    com um risco moderado; a intenção dele é comprar e vender no objetivo
 *    calculado — sempre comprar e realizar lucro em USDT."
 *
 * Então esta mesa é outra coisa: caça POOL NOVO em DEX, compra, e sai no alvo.
 * Long-only, sem exceção.
 *
 * A DIFERENÇA DE OFÍCIO EM RELAÇÃO ÀS OUTRAS MESAS: token recém-lançado NÃO TEM
 * HISTÓRICO. Não existe RSI de 14 períodos, nem EMA50, nem suporte testado três
 * vezes — o gráfico tem minutos de vida. Portanto o seletor de playbook
 * (range/pullback/reversão) É INAPLICÁVEL aqui: ele lê estrutura que ainda não
 * existe. Usar indicador de 50 períodos num pool de 40 minutos é ler folha de
 * chá, e foi mais ou menos assim que a rodada anterior sangrou.
 *
 * O que existe num lançamento é OUTRA COISA: idade, liquidez travada,
 * velocidade de entrada de dinheiro, e a assimetria entre o que se arrisca e o
 * que se pode ganhar. É isso que esta mesa lê.
 *
 * MUNIÇÃO CONTADA: um arqueiro não atira em tudo. O teto diário existe porque
 * este é o terreno mais fácil de se perder dinheiro rápido — e um agente sem
 * limite de disparos vira uma torneira aberta.
 */

import { getNewPoolsAcrossChains, type PoolSummary } from "@/lib/api/geckoterminal";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/** A mesa de lançamento — long-only, on-chain. */
export const ULLR = "ullr_launch";

/** Janela de "recém-lançado". Mais velho que isso não é lançamento, é mercado. */
export const MAX_AGE_HOURS = Number(process.env.ULLR_MAX_AGE_HOURS ?? 48);
/** Idade mínima: pool com minutos de vida ainda está no caos do primeiro bloco
 *  (sniping de bot, liquidez entrando e saindo). Deixar assentar é barato. */
export const MIN_AGE_HOURS = Number(process.env.ULLR_MIN_AGE_HOURS ?? 2);
/** Liquidez mínima — abaixo disto a saída não existe, por melhor que pareça. */
export const MIN_TVL_USD = Number(process.env.ULLR_MIN_TVL ?? 80_000);
/** Volume mínimo em 24h: sem fluxo não há para quem vender. */
export const MIN_VOL_USD = Number(process.env.ULLR_MIN_VOL ?? 50_000);
/** Munição: disparos por dia. */
export const DAILY_CAP = Number(process.env.ULLR_DAILY_CAP ?? 6);

/** Alvo e stop do disparo, em % — assimetria fixa e declarada.
 *  Alvo modesto de propósito: a intenção é REALIZAR em USDT, não segurar
 *  esperando o topo. Um alvo ganancioso transforma acerto em pó. */
export const TARGET_PCT = Number(process.env.ULLR_TARGET_PCT ?? 18);
export const STOP_PCT = Number(process.env.ULLR_STOP_PCT ?? 9);
/** Horizonte curto: se o pump não veio em ~12h, a tese morreu de tédio. */
export const HORIZON_HOURS = Number(process.env.ULLR_HORIZON_HOURS ?? 12);

export interface LaunchShot {
  chain: string;
  pool: string;
  symbol: string;
  entry: number;
  target: number;
  stop: number;
  ageHours: number;
  tvlUsd: number;
  volume24h: number;
  why: string;
}

/** Idade do pool em horas, ou null quando a fonte não informou. */
export function poolAgeHours(p: Pick<PoolSummary, "createdAtMs">, nowMs: number): number | null {
  if (!p.createdAtMs || !Number.isFinite(p.createdAtMs)) return null;
  const h = (nowMs - p.createdAtMs) / 3_600_000;
  return h >= 0 ? h : null;
}

/**
 * O alvo vale uma flecha? Puro e testável.
 *
 * Idade DESCONHECIDA reprova: num feed de pools novos, não saber a idade é o
 * caso perigoso (pode ser qualquer coisa), e este é o terreno onde o erro sai
 * caro. Fail-closed.
 */
export function isWorthAShot(p: PoolSummary, nowMs: number): boolean {
  if (!p.address || !p.baseSymbol) return false;
  if (!(p.priceUsd > 0)) return false;
  const age = poolAgeHours(p, nowMs);
  if (age == null) return false;
  if (age < MIN_AGE_HOURS || age > MAX_AGE_HOURS) return false;
  if (!(p.tvlUsd >= MIN_TVL_USD)) return false;
  if (!(p.volume24h >= MIN_VOL_USD)) return false;
  // Já subiu demais: comprar depois de +80% é pagar a festa de quem chegou
  // antes. A mesa quer o pump, não o troco dele.
  if (p.change24h > 80) return false;
  // Despencando desde o lançamento — quem entrou já está saindo.
  if (p.change24h < -40) return false;
  return true;
}

/** Monta o disparo: entrada a mercado, alvo e stop em assimetria fixa. */
export function buildShot(p: PoolSummary, chain: string, ageHours: number): LaunchShot {
  const entry = p.priceUsd;
  return {
    chain, pool: p.address, symbol: p.baseSymbol.toUpperCase(),
    entry,
    target: entry * (1 + TARGET_PCT / 100),
    stop: entry * (1 - STOP_PCT / 100),
    ageHours, tvlUsd: p.tvlUsd, volume24h: p.volume24h,
    why: `lançamento com ${ageHours.toFixed(1)}h · TVL $${Math.round(p.tvlUsd / 1000)}k · vol $${Math.round(p.volume24h / 1000)}k`,
  };
}

/** Quantos disparos já saíram hoje (UTC) — a munição é diária. */
async function shotsToday(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  try {
    const { count } = await db.from("zion_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("source", ULLR)
      .gte("created_at", since.toISOString());
    return count ?? 0;
  } catch { return DAILY_CAP; } // sem leitura confiável, considera esgotado (fail-closed)
}

export interface UllrRun { seen: number; eligible: number; fired: number; capped: boolean }

/** Um tick do arqueiro. */
export async function runUllrScan(): Promise<UllrRun> {
  const out: UllrRun = { seen: 0, eligible: 0, fired: 0, capped: false };
  const db = getSupabaseAdmin();
  if (!db) return out;

  const already = await shotsToday(db);
  const remaining = DAILY_CAP - already;
  if (remaining <= 0) { out.capped = true; return out; }

  let pools: PoolSummary[] = [];
  try { pools = await getNewPoolsAcrossChains(8); } catch { return out; }
  out.seen = pools.length;

  const nowMs = Date.now();
  const shots: LaunchShot[] = [];
  for (const p of pools) {
    if (!isWorthAShot(p, nowMs)) continue;
    const age = poolAgeHours(p, nowMs);
    if (age == null) continue;
    shots.push(buildShot(p, p.network, age));
  }
  out.eligible = shots.length;
  if (shots.length === 0) return out;

  // Não repetir um pool já atirado — a mesma flecha duas vezes é só dobrar
  // aposta no mesmo lugar, não uma segunda oportunidade.
  const { data: prior } = await db.from("zion_suggestions")
    .select("pool_address").eq("source", ULLR).not("pool_address", "is", null).limit(1000);
  const seen = new Set((prior ?? []).map((r) => r.pool_address));

  // Mais líquido primeiro: a saída é o que decide se o acerto vira USDT.
  const picks = shots
    .filter((s) => !seen.has(s.pool))
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, remaining);
  if (picks.length === 0) return out;

  const rows = picks.map((s) => ({
    symbol: s.symbol, kind: "launch_shot", side: "buy" as const,
    ref_price: s.entry, entry_price: s.entry,
    target_price: s.target, stop_price: s.stop,
    probability: null, regime: null,
    horizon_hours: HORIZON_HOURS, source: ULLR,
    chain: s.chain, pool_address: s.pool,
  }));
  try { await db.from("zion_suggestions").insert(rows); out.fired = rows.length; }
  catch { /* best-effort */ }
  return out;
}
