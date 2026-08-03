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

/**
 * ⚠️ O ALVO CABE NO HORIZONTE? — a verificação que faltava (03/08).
 *
 * O DONO PERGUNTOU se nenhum agente estar positivo podia ser erro NOSSO. É, em
 * parte, e este é o erro.
 *
 * Os 17 trades fechados das mesas: alvo médio +4.96%, stop médio −2.20%, ZERO
 * alvos batidos, 12 stops. Não é azar de amostra pequena — é geometria.
 *
 * O alvo sempre veio da ESTRUTURA (a resistência, a altura da faixa, o pivô) e
 * o horizonte sempre foi uma CONSTANTE do playbook (12h, 48h, 96h). Os dois
 * nunca se falaram. Nada, em lugar nenhum, perguntava se o preço consegue
 * ANDAR até aquele alvo no tempo dado.
 *
 * O caso concreto: ADA, alvo a +5.87%, horizonte de 8 horas na SKAÐI. Com ATR
 * de 1h em ~0.5%, o movimento esperado em 8 horas é ~1.4%. O alvo pedia QUATRO
 * VEZES isso — e o stop, a 2.2%, estava a 1.6× do esperado, ou seja, dentro do
 * alcance do ruído normal.
 *
 * Um bracket assim perde por construção: o lado que mata é alcançável e o lado
 * que paga não é. A taxa de acerto fica baixa independentemente de a TESE estar
 * certa ou errada — e aí o experimento inteiro deixa de medir estratégia e passa
 * a medir a própria geometria.
 *
 * A CONTA: movimento esperado ≈ ATR% × √horas (difusão). É aproximação — ATR é
 * amplitude típica de barra, não desvio-padrão — e serve para separar "difícil"
 * de "impossível", que é o que interessa aqui.
 *
 * O múltiplo é declarado como PALPITE, igual à coluna `priority` era. 2.0 quer
 * dizer "aceito pedir o dobro do movimento típico". O backtest por playbook mede
 * `mfe/alvo` empiricamente e é ele que deve substituir este número — quando
 * houver amostra.
 */
export const MAX_TARGET_ATR_MULT = envNumber(process.env.RAGNAROK_MAX_TARGET_ATR_MULT, 2.0, { positive: true });

/**
 * O movimento que o símbolo tipicamente percorre no horizonte, em % do preço.
 *
 * Escala com a RAIZ do tempo, não com o tempo: preço não anda em linha reta,
 * ele vagueia. Dobrar o horizonte não dobra o alcance — multiplica por ~1.41.
 * Assumir escala linear faria um horizonte longo parecer capaz de alcançar
 * qualquer alvo, que é o erro oposto e igualmente caro.
 */
export function expectedMovePct(atrPct: number, horizonHours: number): number {
  if (!(atrPct > 0) || !(horizonHours > 0)) return 0;
  return atrPct * Math.sqrt(horizonHours);
}

/**
 * O alvo é alcançável no horizonte dado?
 *
 * Sem ATR devolve `true`: não medido não pode virar veto silencioso, e o piso de
 * volatilidade (`stopFloorPct`) já barra o caso sem dado por outro caminho.
 */
export function targetReachable(
  targetPct: number, atrPct: number | null, horizonHours: number,
  maxMultiple = MAX_TARGET_ATR_MULT,
): boolean {
  if (atrPct == null || !(atrPct > 0)) return true;
  const esperado = expectedMovePct(atrPct, horizonHours);
  if (!(esperado > 0)) return true;
  return targetPct <= esperado * maxMultiple;
}

/** Piso de stop para um símbolo: max(ATR% × mult, piso absoluto). */
export function stopFloorPct(atrPct: number | null, limits: BracketLimits = DEFAULT_LIMITS): number {
  const fromAtr = atrPct != null && atrPct > 0 ? atrPct * limits.minStopAtr : 0;
  return Math.max(fromAtr, limits.minStopPct);
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
/**
 * OS NÍVEIS DE CAUTELA, EM UM LUGAR SÓ — para poderem ser MEDIDOS.
 *
 * ⚠️ POR QUE ISTO VIROU PARÂMETRO (03/08).
 *
 * O dono disse: "focamos tanto em ser conservador que os níveis de pessimista e
 * otimista não estão bem calibrados". A frase é uma hipótese, e até agora não
 * havia como testá-la — cada trava era uma constante de módulo lida do ambiente
 * na importação, então mudar uma exigia deploy e comparar duas exigia memória.
 *
 * Discutir calibragem sem poder variar o parâmetro é chute com vocabulário
 * técnico. Com isto, o backtest roda a MESMA janela com níveis diferentes e a
 * pergunta passa a ter resposta em número: qual cautela custa caro, e qual está
 * pagando por si.
 *
 * Os valores de fábrica continuam os mesmos. Isto não afrouxa nada — só torna o
 * afrouxamento mensurável antes de ser adotado.
 */
export interface BracketLimits {
  minRr: number;
  minStopAtr: number;
  minStopPct: number;
  maxTargetPct: number;
  maxTargetAtrMult: number;
}

export const DEFAULT_LIMITS: BracketLimits = {
  minRr: MIN_RR,
  minStopAtr: MIN_STOP_ATR,
  minStopPct: MIN_STOP_PCT,
  maxTargetPct: MAX_TARGET_PCT,
  maxTargetAtrMult: MAX_TARGET_ATR_MULT,
};

export function buildLongBracket(
  symbol: string,
  playbook: ActivePlaybook,
  entry: number,
  target: number,
  stop: number,
  atrPct: number | null,
  horizonHours: number,
  rationale: string,
  limits: BracketLimits = DEFAULT_LIMITS,
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
  if (stopPct < stopFloorPct(atrPct, limits)) return null;   // dentro do ruído → morre de clima
  if (targetPct < 0.15 || targetPct > limits.maxTargetPct) return null;

  // ALVO FORA DE ALCANCE NO HORIZONTE. O par que faltava: o piso de stop
  // garantia que o stop não morresse de ruído, e NADA garantia que o alvo
  // pudesse ser alcançado. Um bracket com o lado que mata acessível e o lado
  // que paga inacessível perde por construção, não por a tese estar errada.
  if (!targetReachable(targetPct, atrPct, horizonHours, limits.maxTargetAtrMult)) return null;

  const rr = reward / risk;
  if (rr < limits.minRr) return null;

  return { symbol, playbook, side: "buy", entry, target, stop, rr, stopPct, horizonHours, rationale };
}
