import { describe, it, expect } from "vitest";
import { parseVerdicts, applyVerdict, type AiVerdict } from "@/lib/zion/strategist-ai";
import type { StrategyPlan } from "@/lib/zion/strategist";

const plan: StrategyPlan = {
  symbol: "BTC", playbook: "range_reversion", side: "buy",
  entry: 100, target: 112, stop: 95, rr: 2.4, stopPct: 5,
  horizonHours: 48, rationale: "mecânico",
};

const v = (o: Partial<AiVerdict>): AiVerdict =>
  ({ symbol: "BTC", action: "accept", why: "", ...o }) as AiVerdict;

describe("parseVerdicts — o modelo nem sempre devolve JSON limpo", () => {
  it("lê JSON direto", () => {
    const r = parseVerdicts('{"verdicts":[{"symbol":"BTC","action":"veto","why":"caro"}]}');
    expect(r).toHaveLength(1);
    expect(r[0].action).toBe("veto");
  });

  it("lê JSON dentro de cerca markdown", () => {
    const r = parseVerdicts('```json\n{"verdicts":[{"symbol":"ETH","action":"accept","why":"ok"}]}\n```');
    expect(r[0].symbol).toBe("ETH");
  });

  it("lê JSON com prosa em volta", () => {
    const r = parseVerdicts('Sure! Here you go:\n{"verdicts":[{"symbol":"SOL","action":"accept","why":"ok"}]}\nHope this helps.');
    expect(r[0].symbol).toBe("SOL");
  });

  it("descarta itens com action inválida em vez de aceitar lixo", () => {
    const r = parseVerdicts('{"verdicts":[{"symbol":"BTC","action":"short","why":"x"},{"symbol":"ETH","action":"accept","why":"y"}]}');
    expect(r).toHaveLength(1);
    expect(r[0].symbol).toBe("ETH");
  });

  it("devolve vazio em texto ilegível (nunca lança)", () => {
    expect(parseVerdicts("desculpa, não consegui analisar")).toEqual([]);
    expect(parseVerdicts("")).toEqual([]);
  });
});

describe("applyVerdict — a IA propõe, o código dispõe", () => {
  it("sem veredito, segue o plano mecânico", () => {
    expect(applyVerdict(plan, undefined, 2)).toEqual(plan);
  });

  it("accept mantém o plano intacto", () => {
    expect(applyVerdict(plan, v({ action: "accept" }), 2)).toEqual(plan);
  });

  it("veto mata o trade", () => {
    expect(applyVerdict(plan, v({ action: "veto", why: "range esticado" }), 2)).toBeNull();
  });

  it("adjust válido passa e registra a justificativa da IA", () => {
    const r = applyVerdict(plan, v({ action: "adjust", entry: 99, target: 115, stop: 93, why: "suporte real é 94" }), 2);
    expect(r).not.toBeNull();
    expect(r!.entry).toBe(99);
    expect(r!.stop).toBe(93);
    expect(r!.rationale).toContain("[IA]");
    expect(r!.rationale).toContain("suporte real");
  });

  it("REJEITA ajuste que inverte o bracket (short disfarçado)", () => {
    // stop ACIMA da entrada = venda a descoberto. Não existe caminho pra isso.
    expect(applyVerdict(plan, v({ action: "adjust", entry: 100, target: 90, stop: 105 }), 2)).toBeNull();
  });

  it("REJEITA ajuste com stop dentro do ruído (a cicatriz do Auto-Retro)", () => {
    // ATR 4% → piso 6%. Um stop de 1% morre de clima, não de estar errado.
    expect(applyVerdict(plan, v({ action: "adjust", entry: 100, target: 130, stop: 99 }), 4)).toBeNull();
  });

  it("REJEITA ajuste com alvo absurdo (o bug dos 500% do Grok)", () => {
    expect(applyVerdict(plan, v({ action: "adjust", entry: 100, target: 600, stop: 94 }), 2)).toBeNull();
  });

  it("REJEITA ajuste com RR abaixo do mínimo", () => {
    expect(applyVerdict(plan, v({ action: "adjust", entry: 100, target: 104, stop: 96 }), 2)).toBeNull();
  });

  it("REJEITA entrada deslocada de escala (o deslize de casa decimal)", () => {
    // LINK a 7323 em vez de 7.32: a geometria fica coerente entre si e passaria
    // no RR, mas resolveria contra um nível de fantasia.
    expect(applyVerdict(plan, v({ action: "adjust", entry: 10_000, target: 11_500, stop: 9_400 }), 2)).toBeNull();
  });

  it("REJEITA adjust sem os níveis (a IA disse 'ajusta' e não ajustou)", () => {
    expect(applyVerdict(plan, v({ action: "adjust" }), 2)).toBeNull();
  });

  it("aceita troca de playbook mantendo a geometria válida", () => {
    const r = applyVerdict(plan, v({ action: "adjust", entry: 100, target: 115, stop: 93, playbook: "trend_pullback", why: "é pullback, não range" }), 2);
    expect(r!.playbook).toBe("trend_pullback");
  });

  it("todo plano que sobrevive continua long-only", () => {
    const casos: AiVerdict[] = [
      v({ action: "accept" }),
      v({ action: "adjust", entry: 99, target: 115, stop: 93 }),
      v({ action: "adjust", entry: 101, target: 120, stop: 94, playbook: "capitulation_reversal" }),
    ];
    for (const c of casos) {
      const r = applyVerdict(plan, c, 2);
      if (!r) continue;
      expect(r.side).toBe("buy");
      expect(r.stop).toBeLessThan(r.entry);
      expect(r.target).toBeGreaterThan(r.entry);
    }
  });
});
