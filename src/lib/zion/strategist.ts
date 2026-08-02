/**
 * RAGNARÖK — o seletor de estratégia (docs/PLANO-RAGNAROK.md,
 * docs/PLANO-ESCOLA-DE-TRADERS.md).
 *
 * O experimento anterior (rodada direcional, arquivada em Valhalla) testou UMA
 * pergunta: "a IA acerta a próxima direção?". A resposta foi não. Mas nunca
 * testou a pergunta do dono: "a IA escolhe a ESTRATÉGIA que melhor se adequa ao
 * momento?".
 *
 * Duas diferenças de fundo em relação ao scanner antigo:
 *
 *  1. LONG-ONLY. O objetivo é ACUMULAR USDT: comprar barato e vender mais caro.
 *     Nada de short — `side` é sempre "buy", por construção do bracket.
 *
 *  2. RANGE É ALVO, NÃO LIXO. O funil antigo (`extractSuggestion`) rejeitava
 *     `regime === "RANGING"` — descartava o mercado lateral, que é onde
 *     mean-reversion vive.
 *
 * ⚠️ MUDANÇA DE 01/08 — DE TRÊS PLAYBOOKS PARA DEZ.
 *
 * Este seletor nasceu com três estratégias, que eram literalmente as que o dono
 * citou como EXEMPLO. Com três opções, a mesa de IA não estava sendo testada —
 * estava sendo enfeitada, porque escolher entre três mal chega a ser escolher.
 *
 * As estratégias saíram daqui para `playbooks.ts`, onde cada uma declara em que
 * regime vale, quando falha e de que dado depende. Este arquivo virou só o
 * ESCOLHEDOR — e é essa separação que torna o duelo limpo: o mecânico e a IA
 * recebem o MESMO cardápio de candidatos, e o que muda entre eles é só quem
 * escolhe.
 *
 * Continua PURO: sem I/O, sem LLM, sem DB.
 */

import type { SymbolIndicators } from "@/lib/api/market-indicators";
import { candidateAttempts } from "@/lib/zion/playbooks";
import { isPlan, type StrategyDecision, type StrategyPlan } from "@/lib/zion/bracket";

// Reexportado para não quebrar quem já importava daqui (ragnarok.ts,
// ragnarok-dex.ts, strategist-ai.ts, testes).
export {
  isPlan, buildLongBracket, stopFloorPct, atrAbs,
  MIN_STOP_ATR, MIN_STOP_PCT, MIN_RR, MAX_TARGET_PCT,
} from "@/lib/zion/bracket";
export type {
  Playbook, ActivePlaybook, StrategyPlan, StandAside, StrategyDecision,
} from "@/lib/zion/bracket";
export { PLAYBOOKS, PLAYBOOK_GAPS, playbooksFor, candidatePlans, candidateAttempts } from "@/lib/zion/playbooks";
export type { PlaybookDef, PlaybookAttempt, PlaybookGap } from "@/lib/zion/playbooks";

/**
 * O que o seletor viu, não só o que ele escolheu.
 *
 * `candidates` existe porque medir apenas o plano escolhido não distingue um
 * agente que escolhe mal entre bons candidatos de um que escolhe bem entre
 * ruins. O caminho não tomado é metade da informação.
 */
export interface SelectionResult {
  decision: StrategyDecision;
  candidates: StrategyPlan[];
}

/**
 * O CÉREBRO MECÂNICO: dado o retrato técnico de um símbolo, escolhe o playbook
 * do momento e devolve o bracket long — ou o motivo de ficar fora.
 *
 * A regra de escolha é a PRIORIDADE DECLARADA na biblioteca, que é um palpite
 * clássico (setup mais específico vence o mais genérico), não um fato medido.
 * Está assim de propósito enquanto não existe histórico por playbook — e é
 * justamente esse histórico, alimentado por `candidates`, que vai substituí-la.
 *
 * Determinístico de propósito: é o controle contra o qual a mesa de IA é medida.
 */
export function selectWithCandidates(ind: SymbolIndicators): SelectionResult {
  const { symbol } = ind;
  if (ind.price == null || !(ind.price > 0)) {
    return { decision: { symbol, playbook: "stand_aside", reason: "sem preço" }, candidates: [] };
  }
  const attempts = candidateAttempts(ind);
  const candidates = attempts.map((a) => a.plan).filter((p): p is StrategyPlan => p !== null);
  if (candidates.length === 0) {
    // Nenhum playbook do regime encontrou condições. Isso é DISCIPLINA, não
    // falha: trader experiente passa a maior parte do tempo fora do mercado.
    //
    // Mas ficar de fora SEM MOTIVO é indistinguível de estar quebrado, então o
    // motivo vem do playbook de MAIOR prioridade do regime — o que mais tinha
    // chance de operar. Quando não há playbook nenhum para o regime, o próprio
    // regime é a resposta.
    const first = attempts[0];
    return {
      decision: {
        symbol, playbook: "stand_aside",
        reason: first
          ? `${first.def.label}: ${first.reason}`
          : `regime indefinido (transição) — nenhum playbook opera aqui`,
      },
      candidates: [],
    };
  }
  return { decision: candidates[0], candidates };
}

/** A forma antiga, para quem só quer a decisão. */
export function selectPlaybook(ind: SymbolIndicators): StrategyDecision {
  return selectWithCandidates(ind).decision;
}

/** Roda o seletor sobre uma carteira de símbolos, devolvendo só os planos. */
export function selectPlans(indicators: SymbolIndicators[]): StrategyPlan[] {
  return indicators.map(selectPlaybook).filter(isPlan);
}
