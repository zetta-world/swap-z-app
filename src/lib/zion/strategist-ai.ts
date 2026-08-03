/**
 * MÍMIR — a mesa de IA do Ragnarök. A pergunta do experimento, e só ela.
 *
 * Na formulação do dono:
 *
 *   "A questão não é IA adivinhar a direção do mercado, é IA analisar o mercado
 *    e seguir a ESTRATÉGIA que melhor se adequa àquele momento — stop, range,
 *    pullback, suporte/resistência."
 *
 * ⚠️ REESCRITA DE 01/08 — ANTES ISTO NÃO TESTAVA A TESE.
 *
 * A versão anterior recebia UM plano pronto do ferreiro mecânico e podia
 * aceitar, vetar ou ajustar. Isso é revisão de risco, não escolha de
 * estratégia: a estratégia já vinha decidida, e a IA no máximo mexia nos
 * números. Com três playbooks no repertório, nem escolha havia.
 *
 * Agora a IA recebe TODOS OS CANDIDATOS que a biblioteca validou para aquele
 * símbolo naquele tick — cada um com playbook, geometria e RR — e faz o que o
 * dono descreveu: ESCOLHE QUAL. Ou nenhum, que é resposta legítima e a que um
 * trader experiente dá na maior parte do tempo.
 *
 * O mecânico escolhe do MESMO cardápio, por prioridade fixa. O que difere entre
 * as duas mesas é só o escolhedor — e é isso que torna o duelo interpretável.
 *
 * TRÊS TRAVAS QUE NÃO DEPENDEM DE BOA VONTADE DO PROMPT:
 *
 *  1. A IA SÓ ESCOLHE ENTRE OS CANDIDATOS. Não inventa setup. Se ela responder
 *     um playbook que a biblioteca não validou para aquele símbolo, a escolha é
 *     descartada. Sem isso, ela poderia alucinar um "rompimento" onde não há
 *     canal e o duelo deixaria de comparar a mesma coisa.
 *
 *  2. AJUSTE DE NÍVEIS VOLTA PELO MESMO PORTÃO. Se ela refinar entrada/alvo/stop,
 *     o resultado passa por `buildLongBracket` igual ao do mecânico. O prompt
 *     pede; o código exige.
 *
 *  3. SEM CÉREBRO, SEM TRADE. Se o provedor não responder, esta mesa não grava
 *     NADA. A versão anterior gravava os planos do ferreiro sob o nome da IA —
 *     e foi exatamente o que aconteceu: os 4 trades que MÍMIR tinha no ledger
 *     eram do VÖLUNDR com outro nome, num experimento onde IA nenhuma
 *     participou. Uma mesa que não pensou não deve produzir trade; silêncio é
 *     honesto, ledger contaminado não é.
 *
 * Sem assento Anthropic (custo). Roda pelo seam OpenAI-compat, papel `brain`.
 */

import { openaiCompatChat } from "@/lib/ai/provider";
import { roleProvider } from "@/lib/ai/registry";
import { isTripped, recordResult } from "@/lib/ai/circuit";
import { recordEvent } from "@/lib/admin/track";
import type { SymbolIndicators } from "@/lib/api/market-indicators";
import { candidateAttempts, PLAYBOOKS } from "@/lib/zion/playbooks";
import { buildLongBracket, type StrategyPlan } from "@/lib/zion/bracket";
import { loadPlaybookRecord, formatRecord, isStale, type PlaybookRecord } from "@/lib/zion/playbook-record";

/** A mesa de IA — o par experimental do VÖLUNDR mecânico. */
export const STRAT_AI = "strat_ai";

/** A escolha da IA para um símbolo. */
export interface AiChoice {
  symbol: string;
  /** Id de um playbook candidato, ou "none" para ficar de fora. */
  pick: string;
  /** Refinamento opcional dos níveis. Se vier, passa pelo bracket de novo. */
  entry?: number;
  target?: number;
  stop?: number;
  /** Uma linha de justificativa — vira registro no evento e no painel. */
  why: string;
}

/**
 * O cardápio vira texto para o modelo. A biblioteca é a fonte: quando um
 * playbook novo entra, ele aparece aqui sozinho — sem isso o prompt envelhece
 * calado, que foi como a versão anterior ficou listando três estratégias muito
 * depois de existirem outras.
 */
function playbookGlossary(): string {
  return PLAYBOOKS.map((p) => `  • ${p.id} — ${p.thesis}. FALHA QUANDO: ${p.failsWhen}`).join("\n");
}

const SYSTEM = [
  "You are the head trader of a LONG-ONLY spot accumulation desk.",
  "The desk's ONLY goal is to grow its USDT balance: buy a token cheap, sell it higher, bank USDT.",
  "You NEVER short, never use leverage, never hold through a thesis break.",
  "",
  "You are NOT asked to predict direction. You are asked the craft question that",
  "separates an experienced trader from a bot: given this market's structure RIGHT NOW,",
  "WHICH of the pre-validated setups is the right one to take — if any?",
  "",
  "The full playbook library:",
  playbookGlossary(),
  "",
  "For each symbol you receive the market portrait and the CANDIDATE setups that",
  "already passed mechanical validation (geometry, risk/reward, volatility floor).",
  "Your job is to pick ONE of those candidates, or none.",
  "",
  "Answer with STRICT JSON, no prose, no markdown fence:",
  '{"choices":[{"symbol":"BTC","pick":"range_reversion","entry":0,"target":0,"stop":0,"why":"one short line"}]}',
  "",
  "Rules:",
  "  • pick MUST be one of the candidate playbook ids listed for that symbol, or \"none\".",
  "    Anything else is discarded — you cannot invent a setup that was not offered.",
  "  • \"none\" is a real answer. An experienced trader is flat most of the time.",
  "    Prefer none over a marginal trade.",
  "  • entry/target/stop are OPTIONAL. Omit them to take the candidate as-is.",
  "    If you give them: stop BELOW entry, target ABOVE entry, entry near the live price.",
  "  • Judge the MOMENT, not the average case: the same setup that pays in a quiet",
  "    range is a trap when a trend is starting. Use the FALHA QUANDO lines.",
  "  • Some candidates carry a measured TRACK RECORD in brackets. Weigh it, but:",
  "      – a record marked DESCONHECIDO means we have no evidence, NOT that the",
  "        setup is bad and NOT that it is neutral. Judge it on structure alone.",
  "      – the record is a backtest over a SHORT window. It is evidence, never proof.",
  "        A strong structure today outranks a weak record from a different market.",
  "  • Be terse. One line per symbol.",
].join("\n");

/** Retrato do símbolo + o cardápio de candidatos, cada um com seu HISTÓRICO. */
function describe(ind: SymbolIndicators, candidates: StrategyPlan[], record: PlaybookRecord | null): string {
  const f = (n: number | null | undefined) => (n == null ? "n/a" : n < 1 ? n.toFixed(6) : n.toFixed(4));
  const parts = [
    `${ind.symbol}: price=${f(ind.price)} regime=${ind.regime} ADX=${ind.adx?.toFixed(0) ?? "n/a"}`,
    `RSI=${ind.rsi14?.toFixed(1) ?? "n/a"}${ind.rsiTrajectory.length >= 2 ? ` (path ${ind.rsiTrajectory.join("→")})` : ""}`,
    `EMA20=${f(ind.ema20)} EMA50=${f(ind.ema50)} ATR%=${ind.atrPct?.toFixed(2) ?? "n/a"} relVol=${ind.relVol?.toFixed(2) ?? "n/a"} OBV=${ind.obvTrend ?? "n/a"}`,
    `MTF: 4h=${ind.htf4h?.trend ?? "n/a"} 1D=${ind.htf1d?.trend ?? "n/a"} align=${ind.alignment}`,
  ];
  if (ind.supports.length) parts.push(`supports=${ind.supports.map(f).join("/")}`);
  if (ind.resistances.length) parts.push(`resistances=${ind.resistances.map(f).join("/")}`);
  if (ind.rangePct != null) parts.push(`1Y-range=${ind.rangePct.toFixed(0)}%`);
  if (ind.divergence) parts.push(`divergence=${ind.divergence}`);
  // Cada candidato vem com o que a MEDIÇÃO diz sobre ele — de preferência no
  // regime atual, que é o terreno em jogo. Amostra pequena chega como AUSÊNCIA
  // declarada, nunca como número: um modelo que recebe "+2,1%" trata aquilo
  // como fato mesmo quando vem de três trades, e não tem como desconfiar.
  const menu = candidates
    .map((c) => {
      const geo = `${c.playbook}(entry=${f(c.entry)} target=${f(c.target)} stop=${f(c.stop)} RR=${c.rr.toFixed(2)})`;
      const hist = record ? formatRecord(record.entries.find((e) => e.playbook === c.playbook), ind.regime) : null;
      return hist ? `${geo} [${hist}]` : geo;
    })
    .join(" , ");
  parts.push(`CANDIDATES: ${menu}`);
  return parts.join(" | ");
}

/** Extrai o JSON com tolerância a cerca de markdown / prosa em volta. */
export function parseChoices(text: string): AiChoice[] {
  const tryParse = (s: string): AiChoice[] | null => {
    try {
      const o = JSON.parse(s) as { choices?: unknown };
      if (!Array.isArray(o.choices)) return null;
      return o.choices.filter((c): c is AiChoice =>
        !!c && typeof c === "object"
        && typeof (c as AiChoice).symbol === "string"
        && typeof (c as AiChoice).pick === "string",
      );
    } catch { return null; }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { const r = tryParse(fenced[1].trim()); if (r) return r; }
  const braced = text.match(/\{[\s\S]*\}/);
  if (braced) { const r = tryParse(braced[0]); if (r) return r; }
  return [];
}

/**
 * Aplica a escolha da IA ao cardápio e devolve o plano final — ou null quando
 * ela ficou de fora, escolheu algo que não estava na mesa, ou pediu um
 * refinamento inoperável.
 *
 * Pura: sem I/O, testável. É aqui que moram as travas 1 e 2.
 */
export function applyChoice(
  candidates: StrategyPlan[],
  choice: AiChoice | undefined,
  atrPct: number | null,
): StrategyPlan | null {
  if (!candidates.length) return null;
  // Sem escolha para este símbolo, a mesa fica de fora. NÃO cai no plano do
  // mecânico: herdar a decisão dele é exatamente a contaminação que esta
  // reescrita existe para acabar.
  if (!choice) return null;
  if (choice.pick === "none") return null;

  const chosen = candidates.find((c) => c.playbook === choice.pick);
  // Escolheu algo que não estava no cardápio: descarta. A IA opta entre setups
  // validados; ela não inventa. Sem esta trava, um "rompimento" alucinado onde
  // não há canal entraria no ledger e o duelo deixaria de comparar a mesma coisa.
  if (!chosen) return null;

  const wantsAdjust = [choice.entry, choice.target, choice.stop].every(
    (n) => n != null && Number.isFinite(Number(n)),
  );
  if (!wantsAdjust) return { ...chosen, rationale: `[IA] ${choice.why || "escolheu este playbook"}` };

  const entry = Number(choice.entry);
  const target = Number(choice.target);
  const stop = Number(choice.stop);
  // Âncora de escala: a entrada ajustada tem que morar perto do preço real.
  // Sem isso, um deslize de casa decimal (LINK a 7323 em vez de 7.32) entra no
  // ledger com geometria "coerente" e envenena a medição inteira.
  if (Math.abs(entry / chosen.entry - 1) > 0.1) return null;

  return buildLongBracket(
    chosen.symbol, chosen.playbook, entry, target, stop, atrPct, chosen.horizonHours,
    `[IA] ${choice.why || "ajustou os níveis"}`,
  );
}

export interface AiScanResult {
  /** Símbolos que tinham pelo menos um candidato para escolher. */
  offered: number;
  /** Total de candidatos apresentados (soma de todos os símbolos). */
  candidates: number;
  picked: number;
  adjusted: number;
  /** Escolheu ficar de fora, ou a escolha foi descartada pelas travas. */
  passed: number;
  plans: StrategyPlan[];
  /**
   * A IA REALMENTE decidiu neste tick?
   *
   * Quando `false`, `plans` vem VAZIO — a mesa não grava nada. Antes ela
   * gravava os planos do ferreiro sob o próprio nome, e os quatro trades que
   * MÍMIR tinha no ledger vieram daí: um "duelo" de VÖLUNDR contra
   * VÖLUNDR-com-outro-nome, com IA nenhuma envolvida.
   */
  brainRan: boolean;
  /** Por que não rodou, quando não rodou. */
  fallbackReason?: string;
  /**
   * A IA decidiu COM histórico medido, ou às cegas?
   *
   * Sem esta flag, duas rodadas com significados diferentes ficariam
   * indistinguíveis no ledger — e a conclusão sobre a tese sairia de uma mistura
   * de trades informados e trades no escuro.
   */
  usedRecord: boolean;
}

/**
 * Roda a mesa de IA. Best-effort em tudo — sem provedor, sem chave, breaker
 * aberto ou resposta ilegível, a mesa fica MUDA no tick. Ficar muda é o
 * comportamento correto: um agente que não pensou não tem o que registrar.
 */
export async function runStrategistAi(indicators: SymbolIndicators[]): Promise<AiScanResult> {
  const menus = indicators
    .map((ind) => ({
      ind,
      candidates: candidateAttempts(ind)
        .map((a) => a.plan)
        .filter((p): p is StrategyPlan => p !== null),
    }))
    .filter((m) => m.candidates.length > 0);

  const out: AiScanResult = {
    offered: menus.length,
    candidates: menus.reduce((n, m) => n + m.candidates.length, 0),
    picked: 0, adjusted: 0, passed: 0, plans: [], brainRan: false, usedRecord: false,
  };
  if (menus.length === 0) return out;

  const provider = roleProvider("brain");
  if (!provider?.apiKey) {
    out.fallbackReason = "nenhum provedor com chave no papel `brain`";
    return out;
  }
  // Breaker aberto (chave quebrada / endpoint morto): não queima chamada nem
  // dispara alerta a cada tick.
  if (await isTripped(provider.id)) {
    out.fallbackReason = `breaker aberto em ${provider.label}`;
    return out;
  }

  // O HISTÓRICO MEDIDO, quando existe e não está velho. Um registro antigo é
  // pior que nenhum: descreve um mercado que já passou e chega com a mesma
  // autoridade de um recente.
  let record = await loadPlaybookRecord();
  if (record && isStale(record, Date.now())) record = null;

  const user = [
    "Pick the right setup for each symbol, or none. Reply with the JSON object only.",
    record
      ? `Track records below come from a backtest over ~${record.windowDays} days. Evidence, not proof.`
      : "No measured track record is available — judge on structure alone.",
    "",
    ...menus.map((m) => describe(m.ind, m.candidates, record)),
  ].join("\n");

  let choices: AiChoice[] = [];
  try {
    const r = await openaiCompatChat(
      { model: provider.model, system: SYSTEM, user, maxTokens: 1100,
        timeoutMs: provider.timeoutMs ?? 30_000, temperature: provider.temperature },
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
    );
    await recordResult(provider.id, provider.label, true);
    choices = parseChoices(r.text);
    out.brainRan = true;
    out.usedRecord = record !== null;
    recordEvent("zion_analysis", { meta: { op: "strat_ai", model: r.model, source: STRAT_AI, ...r.usage } });
  } catch (e) {
    await recordResult(provider.id, provider.label, false, e instanceof Error ? e.message : String(e));
    out.fallbackReason = `${provider.label} indisponível`;
    return out;
  }

  const byChoice = new Map(choices.map((c) => [c.symbol.toUpperCase(), c]));
  for (const m of menus) {
    const c = byChoice.get(m.ind.symbol.toUpperCase());
    const final = applyChoice(m.candidates, c, m.ind.atrPct);
    if (!final) { out.passed++; continue; }
    if (c?.entry != null) out.adjusted++; else out.picked++;
    out.plans.push(final);
  }
  return out;
}
