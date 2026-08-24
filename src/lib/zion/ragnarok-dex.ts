/**
 * RAGNARÖK S3 — a mesa DEX (FREYJA, a acumuladora on-chain).
 *
 * O experimento anterior nunca tocou DEX, e a razão não era falta de vontade:
 * toda a camada de resolução era CEX-shaped. A migration 0019 abriu o caminho
 * (chain + pool_address no ledger e na posição), e este módulo é quem enche
 * esse caminho de trades.
 *
 * MESMO CÉREBRO, OUTRA PRAÇA: reusa exatamente o `selectPlaybook` do ferreiro
 * mecânico. Isso é de propósito — se a estratégia funciona, ela tem que
 * funcionar nos dois lugares; e se o resultado divergir entre CEX e DEX, a
 * diferença é da PRAÇA (liquidez, spread, quem está do outro lado), não do
 * método. Um seletor diferente em cada praça tornaria a comparação inútil.
 *
 * FILTRO DE LIQUIDEZ ANTES DE TUDO: um pool raso é uma armadilha — o preço
 * "existe" mas ninguém consegue sair por ele. O gate de TVL e volume vem antes
 * de qualquer análise técnica, porque indicador bonito em pool seco continua
 * sendo dinheiro preso.
 */

import { getTopPools, getOHLCV, geckoNetworkId } from "@/lib/api/geckoterminal";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectPlaybook, isPlan, type StrategyPlan } from "@/lib/zion/strategist";
import type { SymbolIndicators } from "@/lib/api/market-indicators";
import { getDexSymbolIndicators } from "@/lib/api/market-indicators";

/** A mesa DEX — acumulação de USDT com tokens on-chain. */
export const STRAT_DEX = "strat_dex";

/** Chains varridas. Mantido curto: cada uma custa chamadas de API e o tick tem
 *  60s de orçamento total compartilhado com o resto do flywheel. */
const CHAINS = ["ethereum", "base", "solana"];

/** Pools por chain avaliados a cada tick. */
const POOLS_PER_CHAIN = Number(process.env.RAGNAROK_DEX_POOLS ?? 4);

/** Piso de liquidez. Abaixo disto o preço é uma ficção: o candle existe, mas a
 *  saída não. Números conservadores de propósito — é melhor não operar do que
 *  operar preso. */
const MIN_TVL_USD = Number(process.env.RAGNAROK_DEX_MIN_TVL ?? 250_000);
const MIN_VOL24H_USD = Number(process.env.RAGNAROK_DEX_MIN_VOL ?? 100_000);

export interface DexCandidate {
  chain: string;
  pool: string;
  symbol: string;
  tvlUsd: number;
  volume24h: number;
}

/** Um pool é operável? Pura, testável — o gate que separa mercado de armadilha. */
export function isTradeablePool(p: { tvlUsd: number; volume24h: number; address: string; baseSymbol: string }): boolean {
  if (!p.address || !p.baseSymbol) return false;
  if (!(p.tvlUsd >= MIN_TVL_USD)) return false;
  if (!(p.volume24h >= MIN_VOL24H_USD)) return false;
  // Volume irrisório contra o TVL = pool parado; muito acima = provável wash.
  // A faixa é larga porque a intenção é só cortar os extremos absurdos.
  const turnover = p.volume24h / p.tvlUsd;
  return turnover >= 0.02 && turnover <= 50;
}

/** Varre as chains e devolve os pools que valem análise. Best-effort por chain:
 *  uma rede fora do ar não pode calar as outras. */
export async function findDexCandidates(): Promise<DexCandidate[]> {
  const out: DexCandidate[] = [];
  const results = await Promise.all(CHAINS.map(async (chain) => {
    if (!geckoNetworkId(chain)) return [];
    try { return await getTopPools(chain, POOLS_PER_CHAIN * 3); }
    catch { return []; }
  }));
  for (let i = 0; i < CHAINS.length; i++) {
    const chain = CHAINS[i];
    const good = results[i].filter(isTradeablePool).slice(0, POOLS_PER_CHAIN);
    for (const p of good) {
      out.push({ chain, pool: p.address, symbol: p.baseSymbol.toUpperCase(), tvlUsd: p.tvlUsd, volume24h: p.volume24h });
    }
  }
  return out;
}

export interface DexRun {
  scanned: number;
  candidates: number;
  logged: number;
  skipped: Array<{ symbol: string; reason: string }>;
}

/**
 * Um tick da mesa DEX: acha pools líquidos, calcula os MESMOS indicadores do
 * caminho CEX a partir do OHLCV do pool, roda o MESMO seletor, e grava com
 * chain+pool para que o resolver e a carteira saibam onde buscar o preço.
 */
export async function runDexScan(): Promise<DexRun> {
  const out: DexRun = { scanned: 0, candidates: 0, logged: 0, skipped: [] };
  const candidates = await findDexCandidates();
  out.candidates = candidates.length;
  if (candidates.length === 0) return out;

  const analyzed = await Promise.all(candidates.map(async (c) => {
    try {
      const ind = await getDexSymbolIndicators(c.symbol, c.chain, c.pool, "base");
      return { c, ind };
    } catch { return null; }
  }));

  const plans: Array<{ plan: StrategyPlan; c: DexCandidate; ind: SymbolIndicators }> = [];
  for (const a of analyzed) {
    if (!a) continue;
    out.scanned++;
    const d = selectPlaybook(a.ind);
    if (!isPlan(d)) { out.skipped.push({ symbol: a.c.symbol, reason: "reason" in d ? d.reason : "?" }); continue; }
    plans.push({ plan: d, c: a.c, ind: a.ind });
  }
  if (plans.length === 0) return out;

  const db = getSupabaseAdmin();
  if (!db) return out;
  const rows = plans.map(({ plan, c, ind }) => ({
    symbol: plan.symbol, kind: plan.playbook, side: "buy" as const,
    ref_price: plan.entry, entry_price: plan.entry,
    target_price: plan.target, stop_price: plan.stop,
    probability: null, regime: ind.regime,
    horizon_hours: plan.horizonHours, source: STRAT_DEX,
    chain: c.chain, pool_address: c.pool,
  }));
  // O cliente do Supabase NÃO lança em erro de banco: resolve com
  // `{ error }`. Um `try/catch` aqui nunca dispararia, e a contagem devolvida
  // seria uma MENTIRA — linhas "gravadas" que não existem. Foi essa mesma
  // suposição que fez as carteiras de paper vazarem capital (ver
  // `paper/engine.ts`). Aqui o estrago é de medição, não de dinheiro, mas uma
  // mesa que relata trades inexistentes envenena o experimento igual.
  const { error } = await db.from("zion_suggestions").insert(rows);
  out.logged = error ? 0 : rows.length;
  return out;
}

// Reexport para os testes conseguirem exercitar o gate sem tocar a rede.
export { getOHLCV };
