/**
 * RAGNARÖK S4 — a camada de IA do seletor de estratégia.
 *
 * ESTA é a pergunta do experimento, na formulação do dono:
 *
 *   "A questão não é IA adivinhar a direção do mercado, é IA analisar o mercado
 *    e seguir a estratégia que melhor se adequa àquele momento — stop, range,
 *    pullback, suporte/resistência."
 *
 * Então a IA aqui NÃO é perguntada "pra onde vai o preço?". Ela recebe o
 * retrato técnico + o plano que o ferreiro mecânico (VÖLUNDR) montou, e responde
 * uma pergunta de OFÍCIO: este é o playbook certo para este momento, e a
 * geometria está bem colocada? Pode ACEITAR, VETAR ou AJUSTAR.
 *
 * DUAS TRAVAS QUE NÃO DEPENDEM DE BOA VONTADE DO PROMPT:
 *
 *  1. Tudo que a IA devolve passa PELA MESMA validação mecânica
 *     (`buildLongBracket`). Se ela inventar um alvo de 500% (o bug do Grok) ou
 *     apertar o stop pra dentro do ruído, o plano morre em código. O prompt
 *     pede; o código exige.
 *
 *  2. Long-only por construção. A IA não tem como emitir short: não existe
 *     campo pra isso, e o bracket é reprovado se o stop não ficar abaixo da
 *     entrada. Acumular USDT é comprar barato e realizar — só isso.
 *
 * Sem assento Anthropic (custo). Roda pelo seam OpenAI-compat, no papel
 * `brain` do registry.
 */

import { openaiCompatChat } from "@/lib/ai/provider";
import { roleProvider } from "@/lib/ai/registry";
import { isTripped, recordResult } from "@/lib/ai/circuit";
import { recordEvent } from "@/lib/admin/track";
import type { SymbolIndicators } from "@/lib/api/market-indicators";
import {
  selectPlaybook, isPlan, buildLongBracket,
  type StrategyPlan, type ActivePlaybook,
} from "@/lib/zion/strategist";

/** A mesa de IA — o par experimental do VÖLUNDR mecânico. */
export const STRAT_AI = "strat_ai";

/** O veredito da IA sobre um plano mecânico. */
export interface AiVerdict {
  symbol: string;
  action: "accept" | "veto" | "adjust";
  /** Preenchidos só quando `adjust`. */
  entry?: number;
  target?: number;
  stop?: number;
  /** Playbook alternativo, quando a IA discorda da leitura de regime. */
  playbook?: ActivePlaybook;
  /** Uma linha de justificativa — vira registro no evento. */
  why: string;
}

const SYSTEM = [
  "You are the risk officer of a LONG-ONLY spot accumulation desk.",
  "The desk's ONLY goal is to grow its USDT balance: buy a token cheap, sell it higher, bank USDT.",
  "You NEVER short, never use leverage, never hold through a thesis break.",
  "",
  "You are NOT asked to predict direction. You are asked a CRAFT question:",
  "given this market's structure, is the proposed playbook the right one for THIS",
  "moment, and is the geometry (entry / target / stop) placed where a disciplined",
  "trader would place it?",
  "",
  "The playbooks:",
  "  • range_reversion — choppy/ranging market: buy near support, sell near resistance.",
  "  • trend_pullback — confirmed uptrend: buy the pullback, never the extended breakout.",
  "  • capitulation_reversal — downtrend, ONLY with exhaustion divergence near a cycle low.",
  "",
  "Answer with STRICT JSON, no prose, no markdown fence:",
  '{"verdicts":[{"symbol":"BTC","action":"accept|veto|adjust","entry":0,"target":0,"stop":0,"playbook":"range_reversion","why":"one short line"}]}',
  "",
  "Rules:",
  "  • accept — the plan is sound as-is. Omit entry/target/stop.",
  "  • veto   — this is not a setup worth risking USDT on. Say why in one line.",
  "  • adjust — same idea, better levels. You MUST give entry, target and stop.",
  "  • On adjust: stop BELOW entry, target ABOVE entry. Anything else is discarded.",
  "  • Prefer veto over a marginal trade. Not trading IS a position.",
  "  • Be terse. One line per symbol.",
].join("\n");

/** Retrato compacto do símbolo — só o que importa para a decisão de ofício. */
function describe(ind: SymbolIndicators, plan: StrategyPlan): string {
  const f = (n: number | null | undefined) => (n == null ? "n/a" : n < 1 ? n.toFixed(6) : n.toFixed(4));
  const parts = [
    `${ind.symbol}: price=${f(ind.price)} regime=${ind.regime} ADX=${ind.adx?.toFixed(0) ?? "n/a"}`,
    `RSI=${ind.rsi14?.toFixed(1) ?? "n/a"}${ind.rsiTrajectory.length >= 2 ? ` (path ${ind.rsiTrajectory.join("→")})` : ""}`,
    `EMA20=${f(ind.ema20)} EMA50=${f(ind.ema50)} ATR%=${ind.atrPct?.toFixed(2) ?? "n/a"}`,
    `MTF: 4h=${ind.htf4h?.trend ?? "n/a"} 1D=${ind.htf1d?.trend ?? "n/a"} align=${ind.alignment}`,
  ];
  if (ind.supports.length) parts.push(`supports=${ind.supports.map(f).join("/")}`);
  if (ind.resistances.length) parts.push(`resistances=${ind.resistances.map(f).join("/")}`);
  if (ind.rangePct != null) parts.push(`1Y-range=${ind.rangePct.toFixed(0)}%`);
  if (ind.divergence) parts.push(`divergence=${ind.divergence}`);
  parts.push(
    `PROPOSED[${plan.playbook}]: entry=${f(plan.entry)} target=${f(plan.target)} stop=${f(plan.stop)} RR=${plan.rr.toFixed(2)} stop%=${plan.stopPct.toFixed(2)}`,
  );
  return parts.join(" | ");
}

/** Extrai o JSON do veredito com tolerância a cerca de markdown / prosa em volta. */
export function parseVerdicts(text: string): AiVerdict[] {
  const tryParse = (s: string): AiVerdict[] | null => {
    try {
      const o = JSON.parse(s) as { verdicts?: unknown };
      if (!Array.isArray(o.verdicts)) return null;
      return o.verdicts.filter((v): v is AiVerdict =>
        !!v && typeof v === "object"
        && typeof (v as AiVerdict).symbol === "string"
        && ["accept", "veto", "adjust"].includes((v as AiVerdict).action),
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
 * Aplica um veredito ao plano mecânico e devolve o plano FINAL da mesa de IA —
 * ou null quando ela vetou (ou quando o ajuste que ela pediu é inoperável).
 *
 * Pura: sem I/O, testável. É aqui que mora a trava — o ajuste da IA volta pelo
 * `buildLongBracket`, o mesmo portão do mecânico. Nada entra no ledger sem
 * passar por ele.
 */
export function applyVerdict(
  plan: StrategyPlan,
  verdict: AiVerdict | undefined,
  atrPct: number | null,
): StrategyPlan | null {
  if (!verdict) return plan;               // sem veredito → segue o mecânico
  if (verdict.action === "veto") return null;
  if (verdict.action === "accept") return plan;

  const entry = Number(verdict.entry);
  const target = Number(verdict.target);
  const stop = Number(verdict.stop);
  if (!Number.isFinite(entry) || !Number.isFinite(target) || !Number.isFinite(stop)) return null;

  // Âncora de escala: a entrada ajustada tem que morar perto do preço real.
  // Sem isso, um deslize de casa decimal (LINK a 7323 em vez de 7.32) entra no
  // ledger com a geometria "coerente" e envenena a medição inteira.
  if (Math.abs(entry / plan.entry - 1) > 0.1) return null;

  return buildLongBracket(
    plan.symbol,
    verdict.playbook ?? plan.playbook,
    entry, target, stop, atrPct, plan.horizonHours,
    `[IA] ${verdict.why || "ajustado pela mesa"}`,
  );
}

export interface AiScanResult {
  proposed: number;   // planos que o mecânico ofereceu
  accepted: number;
  adjusted: number;
  vetoed: number;
  plans: StrategyPlan[];
  /**
   * A IA REALMENTE decidiu neste tick?
   *
   * Sem isto, a degradação é INVISÍVEL e destrói o experimento em silêncio: sem
   * chave (ou com o breaker aberto), esta mesa grava os planos do ferreiro sob
   * o próprio nome, e o "duelo" vira VÖLUNDR contra VÖLUNDR-com-outro-nome. Os
   * dois números batem, ninguém desconfia, e a conclusão sobre IA sai de um
   * experimento onde IA nenhuma participou.
   *
   * `accepted` sozinho não distingue "a IA olhou e aprovou tudo" de "a IA nunca
   * rodou" — por isso a flag existe separada.
   */
  brainRan: boolean;
  /** Por que não rodou, quando não rodou. */
  fallbackReason?: string;
}

/**
 * Roda a mesa de IA sobre os planos do mecânico. Best-effort em tudo: sem
 * provider, sem chave, breaker aberto ou resposta ilegível → devolve os planos
 * MECÂNICOS intactos, para a mesa nunca ficar muda por causa de um LLM. (A
 * separação entre as duas mesas continua honesta porque cada uma grava no seu
 * próprio `source`.)
 */
export async function runStrategistAi(indicators: SymbolIndicators[]): Promise<AiScanResult> {
  const mech = indicators.map(selectPlaybook).filter(isPlan);
  const out: AiScanResult = { proposed: mech.length, accepted: 0, adjusted: 0, vetoed: 0, plans: [], brainRan: false };
  if (mech.length === 0) return out;

  const provider = roleProvider("brain");
  if (!provider?.apiKey) {
    out.plans = mech; out.accepted = mech.length;
    out.fallbackReason = "nenhum provedor com chave no papel `brain`";
    return out;
  }
  // Breaker aberto (chave quebrada / endpoint morto): não queima chamada nem
  // dispara alerta a cada tick — a mesa opera com o plano do ferreiro.
  if (await isTripped(provider.id)) {
    out.plans = mech; out.accepted = mech.length;
    out.fallbackReason = `breaker aberto em ${provider.label}`;
    return out;
  }

  const bySymbol = new Map(indicators.map((i) => [i.symbol.toUpperCase(), i]));
  const user = [
    "Review each proposed LONG accumulation setup. Reply with the JSON verdict object only.",
    "",
    ...mech.map((p) => {
      const ind = bySymbol.get(p.symbol.toUpperCase());
      return ind ? describe(ind, p) : "";
    }).filter(Boolean),
  ].join("\n");

  let verdicts: AiVerdict[] = [];
  try {
    const r = await openaiCompatChat(
      { model: provider.model, system: SYSTEM, user, maxTokens: 900,
        timeoutMs: provider.timeoutMs ?? 30_000, temperature: provider.temperature },
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
    );
    await recordResult(provider.id, provider.label, true);
    verdicts = parseVerdicts(r.text);
    out.brainRan = true;
    recordEvent("zion_analysis", { meta: { op: "strat_ai", model: r.model, source: STRAT_AI, ...r.usage } });
  } catch (e) {
    await recordResult(provider.id, provider.label, false, e instanceof Error ? e.message : String(e));
    // LLM fora do ar: a mesa de IA opera com o plano mecânico do dia. Isso é
    // registrado no evento acima só quando a chamada volta — um tick sem
    // veredito simplesmente segue o ferreiro.
    out.plans = mech; out.accepted = mech.length;
    out.fallbackReason = `${provider.label} indisponível`;
    return out;
  }

  const byVerdict = new Map(verdicts.map((v) => [v.symbol.toUpperCase(), v]));
  for (const plan of mech) {
    const v = byVerdict.get(plan.symbol.toUpperCase());
    const final = applyVerdict(plan, v, bySymbol.get(plan.symbol.toUpperCase())?.atrPct ?? null);
    if (!final) { out.vetoed++; continue; }
    if (v?.action === "adjust") out.adjusted++; else out.accepted++;
    out.plans.push(final);
  }
  return out;
}
