/**
 * RAGNARÖK — o seletor de estratégia (docs/PLANO-RAGNAROK.md).
 *
 * O experimento anterior (rodada direcional, arquivada em Valhalla) testou UMA
 * pergunta: "a IA acerta a próxima direção?". A resposta foi não. Mas nunca
 * testou a pergunta do dono: "a IA escolhe a ESTRATÉGIA que melhor se adequa ao
 * momento?" — range, pullback, suporte/resistência.
 *
 * Duas diferenças de fundo em relação ao scanner antigo:
 *
 *  1. LONG-ONLY. O objetivo é ACUMULAR USDT: comprar um token barato e vender
 *     mais caro. Nada de short. `side` é sempre "buy", por construção.
 *
 *  2. RANGE É ALVO, NÃO LIXO. O funil antigo (`extractSuggestion`) rejeitava
 *     `regime === "RANGING"` — literalmente descartava o mercado lateral, que é
 *     onde mean-reversion vive. Aqui o RANGING é o playbook principal.
 *
 * Este módulo é PURO: sem I/O, sem LLM, sem DB. É o "bot mecânico" — o controle
 * honesto do experimento. Se um bot determinístico não lucra seguindo estas
 * regras, o problema é a estratégia, não a inteligência. A camada de IA (S4)
 * entra depois, por cima, podendo aceitar/vetar/ajustar o que sai daqui.
 */

import type { SymbolIndicators } from "@/lib/api/market-indicators";

/** Os playbooks LONG que o seletor sabe operar. */
export type Playbook =
  | "range_reversion"        // RANGING: compra no suporte, vende na resistência
  | "trend_pullback"         // TRENDING_UP: compra o recuo, monta na continuação
  | "capitulation_reversal"  // TRENDING_DOWN + divergência de exaustão perto do fundo
  | "stand_aside";           // não operar É uma posição

export interface StrategyPlan {
  symbol: string;
  playbook: Playbook;
  /** Sempre "buy" — este agente só acumula USDT comprando barato. */
  side: "buy";
  entry: number;
  target: number;
  stop: number;
  /** reward/risk planejado do bracket. */
  rr: number;
  /** stop em % da entrada — usado pelo piso de volatilidade. */
  stopPct: number;
  /** Horizonte em horas: o range respira mais rápido que a tendência. */
  horizonHours: number;
  /** Por que ESTE playbook, em uma linha (vai para o log/painel). */
  rationale: string;
}

/** Motivo pelo qual o seletor ficou de fora — diagnóstico, não erro. */
export interface StandAside {
  symbol: string;
  playbook: "stand_aside";
  reason: string;
}

export type StrategyDecision = StrategyPlan | StandAside;

export function isPlan(d: StrategyDecision): d is StrategyPlan {
  return d.playbook !== "stand_aside";
}

// ── Parâmetros (mesmas cicatrizes do flywheel) ────────────────────────────
//
// O stop TEM que ficar fora da banda de ruído do próprio símbolo, senão morre
// de clima em vez de morrer de estar errado — foi a lição que os agentes
// escreveram sozinhos no Auto-Retro ("stops under 1% are getting clipped almost
// instantly"). ATR floor + piso absoluto, o mais rígido vence.
export const MIN_STOP_ATR = Number(process.env.RAGNAROK_MIN_STOP_ATR ?? 1.5);
export const MIN_STOP_PCT = Number(process.env.RAGNAROK_MIN_STOP_PCT ?? 1.2);
/** RR mínimo. Abaixo disso o bracket não paga o custo de ida-e-volta. */
export const MIN_RR = Number(process.env.RAGNAROK_MIN_RR ?? 1.8);
/** Alvo absurdo = card corrompido (o bug dos alvos de 500% do Grok). */
export const MAX_TARGET_PCT = Number(process.env.RAGNAROK_MAX_TARGET_PCT ?? 30);

/** Piso de stop para um símbolo: max(ATR% × mult, piso absoluto). */
export function stopFloorPct(atrPct: number | null): number {
  const fromAtr = atrPct != null && atrPct > 0 ? atrPct * MIN_STOP_ATR : 0;
  return Math.max(fromAtr, MIN_STOP_PCT);
}

/**
 * Valida a geometria de um bracket LONG e devolve o plano, ou null se o setup
 * for inoperável. Um bracket só é tradeável quando:
 *   stop < entrada < alvo, RR >= MIN_RR, alvo dentro da escala, stop fora do ruído.
 */
export function buildLongBracket(
  symbol: string,
  playbook: Exclude<Playbook, "stand_aside">,
  entry: number,
  target: number,
  stop: number,
  atrPct: number | null,
  horizonHours: number,
  rationale: string,
): StrategyPlan | null {
  if (!(entry > 0) || !(target > 0) || !(stop > 0)) return null;
  // Long: o stop fica ABAIXO da entrada e o alvo ACIMA. Sem exceção — é isso
  // que torna o agente long-only por construção, não por boa vontade do prompt.
  if (!(stop < entry) || !(target > entry)) return null;

  const reward = target - entry;
  const risk = entry - stop;
  if (!(reward > 0) || !(risk > 0)) return null;

  const stopPct = (risk / entry) * 100;
  const targetPct = (reward / entry) * 100;
  if (stopPct < stopFloorPct(atrPct)) return null;   // dentro do ruído → morre de clima
  if (targetPct < 0.15 || targetPct > MAX_TARGET_PCT) return null;

  const rr = reward / risk;
  if (rr < MIN_RR) return null;

  return { symbol, playbook, side: "buy", entry, target, stop, rr, stopPct, horizonHours, rationale };
}

// ── Os playbooks ──────────────────────────────────────────────────────────

/**
 * RANGE REVERSION — o unlock. Em mercado lateral (ADX baixo) o preço oscila
 * entre suporte e resistência: compra-se perto do suporte e realiza-se perto da
 * resistência. O funil antigo jogava este regime fora inteiro.
 *
 * Só compra na METADE DE BAIXO do range (perto do suporte). Comprar no meio ou
 * no topo do range é comprar caro — o oposto de acumular USDT.
 */
function rangeReversion(ind: SymbolIndicators): StrategyDecision {
  const { symbol, price } = ind;
  if (price == null || !(price > 0)) return { symbol, playbook: "stand_aside", reason: "sem preço" };

  const support = ind.supports[0];      // suporte mais próximo ABAIXO do preço
  const resistance = ind.resistances[0]; // resistência mais próxima ACIMA
  if (support == null || resistance == null) {
    return { symbol, playbook: "stand_aside", reason: "range sem S/R definido" };
  }
  if (!(resistance > support)) {
    return { symbol, playbook: "stand_aside", reason: "S/R degenerado" };
  }

  // Onde o preço está DENTRO do range: 0 = no suporte, 1 = na resistência.
  const posInRange = (price - support) / (resistance - support);
  if (posInRange > 0.5) {
    return { symbol, playbook: "stand_aside", reason: `caro no range (${(posInRange * 100).toFixed(0)}% do canal)` };
  }

  // Entra a mercado (já está barato), realiza um pouco ANTES da resistência —
  // a fila de venda se forma no nível, não em cima dele.
  //
  // Stop um ATR INTEIRO abaixo do suporte, não meio: um pavio furando o suporte
  // é ruído, um fechamento um ATR abaixo é quebra de range de verdade. Meio ATR
  // punha o stop dentro da própria banda de ruído do símbolo — reprovado pelo
  // piso de volatilidade, que é a cicatriz que os agentes escreveram sozinhos
  // no Auto-Retro. Comprar no suporte já dá RR de sobra; não precisa apertar.
  const atrAbs = ind.atr14 != null && ind.atr14 > 0 ? ind.atr14 : price * 0.01;
  const target = resistance - (resistance - support) * 0.15;
  const stop = support - atrAbs;

  return buildLongBracket(
    symbol, "range_reversion", price, target, stop, ind.atrPct, 48,
    `lateral (ADX ${ind.adx?.toFixed(0) ?? "?"}) a ${(posInRange * 100).toFixed(0)}% do canal — compra no suporte, realiza na resistência`,
  ) ?? { symbol, playbook: "stand_aside", reason: "bracket de range reprovado (RR/stop)" };
}

/**
 * TREND PULLBACK — em alta confirmada, não se compra o rompimento (caro):
 * espera-se o recuo até a EMA20 / suporte e compra-se ali, a favor da maré.
 * Se o preço está esticado muito acima da EMA20, fica de fora e espera o recuo.
 */
function trendPullback(ind: SymbolIndicators): StrategyDecision {
  const { symbol, price } = ind;
  if (price == null || !(price > 0)) return { symbol, playbook: "stand_aside", reason: "sem preço" };
  if (ind.ema20 == null || !(ind.ema20 > 0)) {
    return { symbol, playbook: "stand_aside", reason: "sem EMA20" };
  }

  // Esticado = comprar no topo do impulso. O recuo é o desconto; sem ele, fora.
  const stretchPct = ((price - ind.ema20) / ind.ema20) * 100;
  const atrPct = ind.atrPct ?? 1;
  if (stretchPct > atrPct * 1.5) {
    return { symbol, playbook: "stand_aside", reason: `esticado ${stretchPct.toFixed(1)}% acima da EMA20 — espera o pullback` };
  }

  const atrAbs = ind.atr14 != null && ind.atr14 > 0 ? ind.atr14 : price * 0.01;
  // Stop abaixo da estrutura: um ATR abaixo do suporte mais próximo (mesma
  // lógica do range — pavio é ruído, ATR inteiro é quebra), ou 1.5 ATR quando
  // não há suporte mapeado.
  const structural = ind.supports[0];
  const stop = structural != null && structural < price
    ? structural - atrAbs
    : price - atrAbs * 1.5;
  // Alvo: a resistência acima quando existe. Sem resistência no caminho, o
  // movimento medido tem espaço pra correr — 4 ATR. (A 3 ATR o playbook era
  // praticamente natimorto: contra um stop estrutural honesto o RR quase nunca
  // alcançava o mínimo, então ele nunca operaria caminho limpo, que é
  // justamente a melhor situação de uma tendência.)
  const target = ind.resistances[0] != null && ind.resistances[0] > price
    ? ind.resistances[0]
    : price + atrAbs * 4;

  return buildLongBracket(
    symbol, "trend_pullback", price, target, stop, ind.atrPct, 72,
    `alta confirmada (ADX ${ind.adx?.toFixed(0) ?? "?"}, ${ind.alignment}) com preço a ${stretchPct.toFixed(1)}% da EMA20 — compra o recuo`,
  ) ?? { symbol, playbook: "stand_aside", reason: "bracket de pullback reprovado (RR/stop)" };
}

/**
 * CAPITULATION REVERSAL — o único long permitido em tendência de BAIXA, e com
 * trava dupla: exige divergência de alta no RSI (vendedor perdendo força) E
 * preço no terço inferior do range de 1 ano. Sem as duas, comprar downtrend é
 * "faca caindo" — foi assim que a rodada antiga sangrou.
 */
function capitulationReversal(ind: SymbolIndicators): StrategyDecision {
  const { symbol, price } = ind;
  if (price == null || !(price > 0)) return { symbol, playbook: "stand_aside", reason: "sem preço" };
  if (ind.divergence !== "bullish_rsi") {
    return { symbol, playbook: "stand_aside", reason: "queda sem divergência de exaustão — faca caindo" };
  }
  if (ind.rangePct == null || ind.rangePct > 33) {
    return { symbol, playbook: "stand_aside", reason: "queda longe do fundo do ciclo" };
  }

  const atrAbs = ind.atr14 != null && ind.atr14 > 0 ? ind.atr14 : price * 0.01;
  const stop = price - atrAbs * 2;             // reversão precisa de folga
  const target = ind.resistances[0] != null && ind.resistances[0] > price
    ? ind.resistances[0]
    : price + atrAbs * 4;

  return buildLongBracket(
    symbol, "capitulation_reversal", price, target, stop, ind.atrPct, 96,
    `divergência de alta a ${ind.rangePct.toFixed(0)}% do range de 1 ano — vendedor sem força`,
  ) ?? { symbol, playbook: "stand_aside", reason: "bracket de reversão reprovado (RR/stop)" };
}

// ── O seletor ─────────────────────────────────────────────────────────────

/**
 * O CÉREBRO MECÂNICO: dado o retrato técnico de um símbolo, escolhe o playbook
 * que se adequa ao momento e devolve o bracket long — ou o motivo de ficar
 * fora. É determinístico de propósito: é o controle contra o qual a camada de
 * IA (S4) vai ser medida.
 */
export function selectPlaybook(ind: SymbolIndicators): StrategyDecision {
  const { symbol } = ind;
  if (ind.price == null || !(ind.price > 0)) {
    return { symbol, playbook: "stand_aside", reason: "sem preço" };
  }

  switch (ind.regime) {
    case "RANGING":
      return rangeReversion(ind);
    case "TRENDING_UP":
      return trendPullback(ind);
    case "TRENDING_DOWN":
      return capitulationReversal(ind);
    default:
      // TRANSITIONING: o regime ainda não se decidiu. Na v1 ficamos fora — não
      // trair a disciplina só pra ter volume de trades.
      return { symbol, playbook: "stand_aside", reason: "regime indefinido (transição)" };
  }
}

/** Roda o seletor sobre uma carteira de símbolos, devolvendo só os planos. */
export function selectPlans(indicators: SymbolIndicators[]): StrategyPlan[] {
  return indicators.map(selectPlaybook).filter(isPlan);
}
