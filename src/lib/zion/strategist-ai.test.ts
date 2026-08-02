import { describe, it, expect } from "vitest";
import { parseChoices, applyChoice, type AiChoice } from "@/lib/zion/strategist-ai";
import type { StrategyPlan } from "@/lib/zion/bracket";

/**
 * MÍMIR — a mesa que TESTA A TESE, e que antes não testava.
 *
 * A versão anterior recebia UM plano pronto e podia aceitar, vetar ou ajustar.
 * Isso é revisão de risco: a estratégia já vinha decidida. Agora ela recebe o
 * cardápio inteiro de candidatos validados e ESCOLHE qual — que é literalmente
 * a pergunta do dono.
 *
 * Estes testes guardam as três travas. As duas primeiras impedem a IA de
 * inventar setup ou geometria; a terceira é a que mais importa:
 *
 *   SEM CÉREBRO, SEM TRADE.
 *
 * Os quatro trades que MÍMIR tinha no ledger eram planos do VÖLUNDR gravados
 * sob o nome dela, porque a versão antiga caía no plano mecânico quando o
 * modelo não respondia. O "duelo" era VÖLUNDR contra VÖLUNDR-com-outro-nome —
 * e a conclusão sobre IA teria saído de um experimento sem IA.
 */

function plan(over: Partial<StrategyPlan> = {}): StrategyPlan {
  return {
    symbol: "BTC", playbook: "range_reversion", side: "buy",
    entry: 100, target: 112, stop: 94, rr: 2, stopPct: 6, horizonHours: 48,
    rationale: "mecânico", ...over,
  };
}

const menu = [
  plan({ playbook: "range_reversion", target: 112, stop: 94 }),
  plan({ playbook: "absorption", target: 110, stop: 93 }),
];

describe("parseChoices — o modelo não escolhe o formato da resposta", () => {
  it("lê JSON puro", () => {
    const c = parseChoices('{"choices":[{"symbol":"BTC","pick":"absorption","why":"ok"}]}');
    expect(c).toHaveLength(1);
    expect(c[0].pick).toBe("absorption");
  });

  it("lê dentro de cerca de markdown", () => {
    const c = parseChoices('```json\n{"choices":[{"symbol":"BTC","pick":"none","why":"x"}]}\n```');
    expect(c[0].pick).toBe("none");
  });

  it("lê com prosa em volta", () => {
    const c = parseChoices('Here you go: {"choices":[{"symbol":"ETH","pick":"absorption","why":"y"}]} hope it helps');
    expect(c[0].symbol).toBe("ETH");
  });

  it("lixo devolve lista vazia, não explode", () => {
    expect(parseChoices("desculpe, não posso ajudar")).toEqual([]);
    expect(parseChoices("")).toEqual([]);
  });

  it("descarta item sem os campos obrigatórios", () => {
    const c = parseChoices('{"choices":[{"symbol":"BTC"},{"symbol":"ETH","pick":"absorption","why":"z"}]}');
    expect(c).toHaveLength(1);
  });
});

describe("trava 1 — a IA escolhe ENTRE os candidatos, não inventa", () => {
  it("escolhe um do cardápio", () => {
    const r = applyChoice(menu, { symbol: "BTC", pick: "absorption", why: "fluxo entrando" }, 2);
    expect(r?.playbook).toBe("absorption");
    expect(r?.rationale).toContain("[IA]");
    expect(r?.rationale).toContain("fluxo entrando");
  });

  it("DESCARTA playbook que não estava na mesa", () => {
    // Sem esta trava, um "rompimento" alucinado onde não existe canal entraria
    // no ledger, e o duelo deixaria de comparar a mesma coisa.
    expect(applyChoice(menu, { symbol: "BTC", pick: "range_breakout", why: "inventei" }, 2)).toBeNull();
  });

  it("DESCARTA playbook inexistente", () => {
    expect(applyChoice(menu, { symbol: "BTC", pick: "scalp_lunar", why: "?" }, 2)).toBeNull();
  });

  it("'none' é resposta legítima — ficar de fora é posição", () => {
    expect(applyChoice(menu, { symbol: "BTC", pick: "none", why: "nada claro" }, 2)).toBeNull();
  });
});

describe("trava 2 — ajuste de níveis passa pelo MESMO portão do mecânico", () => {
  it("aceita refinamento com geometria sã", () => {
    const r = applyChoice(menu, { symbol: "BTC", pick: "range_reversion", entry: 100, target: 115, stop: 93, why: "melhor stop" }, 2);
    expect(r).not.toBeNull();
    expect(r!.target).toBe(115);
    expect(r!.stop).toBe(93);
  });

  it("REJEITA stop acima da entrada — isso seria um short", () => {
    expect(applyChoice(menu, { symbol: "BTC", pick: "range_reversion", entry: 100, target: 115, stop: 105, why: "x" }, 2)).toBeNull();
  });

  it("REJEITA RR abaixo do mínimo, mesmo com a IA insistindo", () => {
    expect(applyChoice(menu, { symbol: "BTC", pick: "range_reversion", entry: 100, target: 102, stop: 94, why: "x" }, 2)).toBeNull();
  });

  it("REJEITA stop dentro do ruído (morre de clima)", () => {
    // ATR 4% → piso 6%. Um stop de 1% não passa nem com alvo generoso.
    expect(applyChoice(menu, { symbol: "BTC", pick: "range_reversion", entry: 100, target: 130, stop: 99, why: "x" }, 4)).toBeNull();
  });

  it("REJEITA deslize de casa decimal — a âncora de escala", () => {
    // LINK a 7323 em vez de 7.32: geometria "coerente", ledger envenenado.
    expect(applyChoice(menu, { symbol: "BTC", pick: "range_reversion", entry: 7323, target: 8000, stop: 7000, why: "x" }, 2)).toBeNull();
  });

  it("níveis parciais são ignorados — usa o candidato como veio", () => {
    // Metade de um ajuste não é um ajuste. Sem isto, um `target` solto seria
    // combinado com o stop antigo e produziria uma geometria que ninguém pediu.
    const r = applyChoice(menu, { symbol: "BTC", pick: "range_reversion", target: 999, why: "x" } as AiChoice, 2);
    expect(r?.target).toBe(112);
  });
});

describe("trava 3 — sem escolha, a mesa fica MUDA", () => {
  it("sem veredito para o símbolo, NÃO herda o plano do mecânico", () => {
    // Este é o teste que impede a contaminação de voltar. A versão anterior
    // devolvia o plano do ferreiro aqui, e foi assim que MÍMIR acumulou quatro
    // trades num experimento onde IA nenhuma participou.
    expect(applyChoice(menu, undefined, 2)).toBeNull();
  });

  it("cardápio vazio não vira trade", () => {
    expect(applyChoice([], { symbol: "BTC", pick: "range_reversion", why: "x" }, 2)).toBeNull();
  });
});
