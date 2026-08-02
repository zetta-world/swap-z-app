/**
 * BRACKET — a geometria de um trade long, e as cicatrizes que a governam.
 *
 * Separado do seletor de propósito: a biblioteca de playbooks
 * (`playbooks.ts`) precisa destas primitivas, e o seletor (`strategist.ts`)
 * precisa da biblioteca. Sem este arquivo no meio, os dois se importariam em
 * círculo.
 *
 * As três regras abaixo não são gosto pessoal — são coisas que os agentes da
 * rodada anterior escreveram sozinhos no Auto-Retro depois de sangrar:
 *
 *  · STOP FORA DO RUÍDO. "Stops under 1% are getting clipped almost instantly."
 *    Um stop dentro da banda de ruído do símbolo morre de clima, não de estar
 *    errado — e um trade que morre de clima ensina zero.
 *  · RR MÍNIMO. Abaixo de 1.8 o bracket não paga o custo de ida-e-volta, então
 *    acertar mais da metade das vezes ainda dá prejuízo.
 *  · ALVO DENTRO DA ESCALA. Alvo de 500% é card corrompido, não oportunidade —
 *    foi um bug real do Grok, e ele entrou no ledger como se fosse plano.
 */

import { envNumber } from "@/lib/env-number";

/** Os playbooks LONG que a biblioteca sabe operar. */
export type Playbook =
  // ── mercado lateral ──
  | "range_reversion"        // compra o suporte testado, realiza na resistência
  | "range_breakout"         // rompe a máxima da faixa com volume
  | "pivot_reversion"        // preço no S1/S2 do dia, volta pro ponto pivô
  // ── tendência de alta ──
  | "trend_pullback"         // compra o recuo até a EMA, a favor da maré
  | "trend_continuation"     // consolidação no meio da perna (bandeira)
  | "breakout_retest"        // rompeu, voltou testar por cima, segurou
  // ── reversão / fundo ──
  | "capitulation_reversal"  // exaustão + divergência perto do fundo do ciclo
  | "divergence_reversal"    // divergência de alta sem capitulação
  // ── fluxo / estrutura ──
  | "absorption"             // volume alto, preço parado, OBV subindo
  | "support_accumulation"   // suporte + fluxo comprador líquido
  // ── a posição de não ter posição ──
  | "stand_aside";

/** Um playbook que REALMENTE opera. Um plano nunca pode ser `stand_aside` —
 *  o tipo garante isso, em vez de deixar para uma checagem em runtime. */
export type ActivePlaybook = Exclude<Playbook, "stand_aside">;

export interface StrategyPlan {
  symbol: string;
  playbook: ActivePlaybook;
  /** Sempre "buy" — estas mesas só acumulam USDT comprando barato. */
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

// ── Parâmetros ────────────────────────────────────────────────────────────
export const MIN_STOP_ATR = envNumber(process.env.RAGNAROK_MIN_STOP_ATR, 1.5, { positive: true });
export const MIN_STOP_PCT = envNumber(process.env.RAGNAROK_MIN_STOP_PCT, 1.2, { positive: true });
/** RR mínimo. Abaixo disso o bracket não paga o custo de ida-e-volta. */
export const MIN_RR = envNumber(process.env.RAGNAROK_MIN_RR, 1.8, { positive: true });
/** Alvo absurdo = card corrompido (o bug dos alvos de 500% do Grok). */
export const MAX_TARGET_PCT = envNumber(process.env.RAGNAROK_MAX_TARGET_PCT, 30, { positive: true });

/** Piso de stop para um símbolo: max(ATR% × mult, piso absoluto). */
export function stopFloorPct(atrPct: number | null): number {
  const fromAtr = atrPct != null && atrPct > 0 ? atrPct * MIN_STOP_ATR : 0;
  return Math.max(fromAtr, MIN_STOP_PCT);
}

/** ATR em valor absoluto, com queda para 1% do preço quando falta o indicador. */
export function atrAbs(price: number, atr14: number | null): number {
  return atr14 != null && atr14 > 0 ? atr14 : price * 0.01;
}

/**
 * O stop ESTRUTURAL, empurrado para fora da banda de ruído quando ele cai perto
 * demais da entrada.
 *
 * POR QUE ISTO EXISTE: um nível de invalidação pode estar tecnicamente certo e
 * financeiramente inútil. Comprar o rompimento a 119 com o teto do canal em 120
 * dá um stop "correto" a meio ATR da entrada — que o piso de volatilidade
 * reprova, e com razão: esse trade morre de clima antes de morrer de estar
 * errado.
 *
 * A resposta certa não é afrouxar o piso (foi ele que salvou a rodada
 * anterior), nem fingir que o nível é outro. É afastar o stop até ele sair do
 * ruído, aceitando arriscar mais por trade — e deixar o RR mínimo decidir se,
 * com esse risco maior, o trade ainda paga. Quando não paga, o bracket recusa,
 * que é exatamente o comportamento desejado.
 *
 * `MIN_STOP_ATR` é o piso do bracket; aqui usamos uma folga um pouco maior para
 * que o stop não fique EXATAMENTE em cima da fronteira e seja reprovado por
 * arredondamento.
 */
export function floorAwareStop(entry: number, structural: number, atr: number): number {
  return Math.min(structural, entry - atr * (MIN_STOP_ATR + 0.1));
}

/**
 * Valida a geometria de um bracket LONG e devolve o plano, ou null se o setup
 * for inoperável. Um bracket só é tradeável quando:
 *   stop < entrada < alvo, RR >= MIN_RR, alvo dentro da escala, stop fora do ruído.
 */
export function buildLongBracket(
  symbol: string,
  playbook: ActivePlaybook,
  entry: number,
  target: number,
  stop: number,
  atrPct: number | null,
  horizonHours: number,
  rationale: string,
): StrategyPlan | null {
  if (!(entry > 0) || !(target > 0) || !(stop > 0)) return null;
  // Long: o stop fica ABAIXO da entrada e o alvo ACIMA. Sem exceção — é isso
  // que torna as mesas long-only por construção, não por boa vontade do prompt.
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
