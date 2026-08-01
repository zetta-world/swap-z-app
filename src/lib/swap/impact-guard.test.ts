import { describe, it, expect } from "vitest";
import { assessImpact, impactBlocks, IMPACT_WARN_PCT, IMPACT_BLOCK_PCT } from "@/lib/swap/impact-guard";

describe("assessImpact — a perda que o usuário assina sem perceber", () => {
  it("impacto pequeno segue sem atrito", () => {
    expect(assessImpact(-0.3, 1000).level).toBe("ok");
  });

  it("acima do aviso exige confirmação, e fala em DINHEIRO", () => {
    const v = assessImpact(-3, 1000);
    expect(v.level).toBe("warn");
    expect(v.lossUsd).toBeCloseTo(30, 6);
    // "3%" não dói; "$30.00" dói — e é a mesma informação.
    expect(v.message).toContain("$30.00");
  });

  it("impacto catastrófico BLOQUEIA — não basta ficar vermelho", () => {
    const v = assessImpact(-40, 100);
    expect(v.level).toBe("block");
    expect(v.lossUsd).toBeCloseTo(40, 6);
    expect(v.message).toContain("bloqueada");
    expect(impactBlocks(-40)).toBe(true);
  });

  it("impacto A FAVOR do usuário nunca alarma", () => {
    // Ganho inesperado não é risco para quem está trocando.
    expect(assessImpact(5, 1000).level).toBe("ok");
    expect(assessImpact(50, 1000).level).toBe("ok");
  });

  it("sem impacto conhecido não inventa alarme nem falsa segurança", () => {
    const v = assessImpact(null, 1000);
    expect(v.level).toBe("ok");
    expect(v.lossUsd).toBeNull();
    expect(v.message).toBe("");
  });

  it("sem notional, cai para porcentagem em vez de mentir um valor", () => {
    const v = assessImpact(-3, null);
    expect(v.lossUsd).toBeNull();
    expect(v.message).toContain("3.0%");
    expect(v.message).not.toContain("$");
  });

  it("as fronteiras são inclusivas — nada escapa por um décimo", () => {
    expect(assessImpact(-IMPACT_WARN_PCT, 100).level).toBe("warn");
    expect(assessImpact(-IMPACT_BLOCK_PCT, 100).level).toBe("block");
  });

  it("o caso que motivou a guarda: $100 com 40% de impacto", () => {
    // Antes: texto vermelho e o swap seguia com um clique.
    const v = assessImpact(-40, 100);
    expect(v.level).toBe("block");
    expect(v.message).toContain("$40.00");
  });
});
