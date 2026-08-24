import { describe, it, expect } from "vitest";
import { decideCull, type SourceStat, EM_PROVA } from "@/lib/zion/cull";

const stat = (source: string, decided: number, expectancyNet: number | null): SourceStat =>
  ({ source, decided, resolved: decided, expectancyNet });

describe("decideCull — tournament cut factory (alavanca 3)", () => {
  it("culls only agents at minimum sample with negative net expectancy", () => {
    const { cull } = decideCull([
      stat("grok_scan", 120, -0.8),   // judged, negative → cull
      stat("kimi_scan", 40, -2.5),    // sub-sample: a bad streak is not a verdict
      stat("mistral_scan", 150, 0.3), // judged, positive → survives
    ], 100);
    expect(cull).toEqual(["grok_scan"]);
  });

  it("champion = best POSITIVE net expectancy at minimum sample", () => {
    const { champion } = decideCull([
      stat("mistral_scan", 150, 0.3),
      stat("self_scan", 200, 0.9),
      stat("deepseek_scan", 90, 5.0),  // sub-sample: lucky streak, not a champion
    ], 100);
    expect(champion).toBe("self_scan");
  });

  it("no champion when nobody is net-positive at sample (honesty over hope)", () => {
    const { champion, cull } = decideCull([
      stat("grok_scan", 120, -0.8),
      stat("self_scan", 110, -0.1),
    ], 100);
    expect(champion).toBeNull();
    expect(cull).toEqual(expect.arrayContaining(["grok_scan", "self_scan"]));
  });

  it("null expectancy (nothing resolved) is never judged", () => {
    const { cull, champion } = decideCull([stat("kimi_scan", 150, null)], 100);
    expect(cull).toEqual([]);
    expect(champion).toBeNull();
  });
});

/**
 * ⚠️ A ISENÇÃO DA MESA EM PROVA (16/08).
 *
 * O `decideCull` corta por NÍVEL, e foi esse critério que mandou a GERI para
 * Valhalla em 27/07 — no exato trecho em que os cards por tick dela caíam de
 * 4,00 para 1,29 e a confiança subia de 59,7 para 64,3. Mediu certo o número
 * errado.
 *
 * Ela voltou com `retireWhen` próprio, que fala da tendência. Sem esta isenção
 * aquele campo seria mentira: a ficha diria uma coisa e o cron faria outra ao
 * centésimo trade.
 */
describe("mesa EM PROVA — o machado que não cai", () => {
  const geri = { source: "mistral_scan", decided: 120, resolved: 120, expectancyNet: -0.5 };
  const outra = { source: "grok_scan", decided: 120, resolved: 120, expectancyNet: -0.5 };

  it("a mesa em prova é poupada; a de ao lado, com o MESMO número, não", () => {
    const v = decideCull([geri, outra], 100, ["mistral_scan"]);
    expect(v.cull).toEqual(["grok_scan"]);
    expect(v.poupadas).toEqual(["mistral_scan"]);
  });

  it("poupada aparece com NOME — isenção silenciosa é o defeito, não o conserto", () => {
    // Se `poupadas` viesse vazio, a GERI existiria num estado que nenhuma tela
    // mostra: reprovada pelo automático e viva mesmo assim.
    expect(decideCull([geri], 100, ["mistral_scan"]).poupadas).toContain("mistral_scan");
  });

  it("a isenção é do MACHADO, não do placar: em prova ainda concorre a campeã", () => {
    const boa = { source: "mistral_scan", decided: 120, resolved: 120, expectancyNet: 1.2 };
    expect(decideCull([boa, outra], 100, ["mistral_scan"]).champion).toBe("mistral_scan");
  });

  it("abaixo da amostra ninguém é poupado, porque ninguém foi julgado", () => {
    const cedo = { source: "mistral_scan", decided: 40, resolved: 40, expectancyNet: -0.5 };
    const v = decideCull([cedo], 100, ["mistral_scan"]);
    expect(v.cull).toEqual([]);
    expect(v.poupadas).toEqual([]);   // não é isenção, é falta de veredito
  });

  it("lista vazia devolve o comportamento antigo, inteiro", () => {
    expect(decideCull([geri, outra], 100, []).cull.sort()).toEqual(["grok_scan", "mistral_scan"]);
  });

  /** A GERI é a ÚNICA. Lista que cresce vira "ninguém é cortado". */
  it("EM_PROVA tem exatamente uma mesa", () => {
    expect([...EM_PROVA]).toEqual(["mistral_scan"]);
  });
});
