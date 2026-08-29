import { describe, it, expect } from "vitest";
import { medirFrescor, sinalFresco, MAX_FRACAO_DO_HORIZONTE } from "@/lib/paper/frescor";

/**
 * ⚠️ CADA CASO AQUI SAIU DE UMA LINHA DO LEDGER (`docs/PLANO-ATRASO-DE-EXECUCAO.md`).
 *
 * Os números não são inventados: 94,5h de atraso é o pior caso real medido, e a
 * posição que "nasceu expirada" existiu cinco vezes. O bloco de falha aberta é
 * o mais importante do arquivo — se alguém "consertar" o portão para falhar
 * fechado, uma data ilegível desliga o laboratório em silêncio.
 */

const AGORA = Date.parse("2026-08-29T12:00:00.000Z");
const horasAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString();

describe("o portão barra o que é errado por aritmética", () => {
  it("⚠️ a posição que NASCEU EXPIRADA não abre — caso real de 94,5h", () => {
    const f = medirFrescor(horasAtras(94.5), 72, AGORA);
    expect(f.fresca).toBe(false);
    expect(f.atrasoHoras).toBeCloseTo(94.5, 6);
    expect(f.fracaoGasta).toBeCloseTo(94.5 / 72, 6);
  });

  it("metade do horizonte gasto barra — é a faixa que expira 52%", () => {
    // Exatamente no teto: 36h de um horizonte de 72h.
    expect(medirFrescor(horasAtras(36), 72, AGORA).fresca).toBe(false);
    // Um cabelo abaixo passa.
    expect(medirFrescor(horasAtras(35.9), 72, AGORA).fresca).toBe(true);
  });

  it("a entrada imediata passa — é a faixa de expectativa +1,38", () => {
    const f = medirFrescor(horasAtras(0.2), 72, AGORA);
    expect(f.fresca).toBe(true);
    expect(f.fracaoGasta).toBeLessThan(0.01);
  });

  it("o teto é relativo ao horizonte, não em horas absolutas", () => {
    // 8h num horizonte curto de 12h já é 67% — barra.
    expect(medirFrescor(horasAtras(8), 12, AGORA).fresca).toBe(false);
    // As MESMAS 8h num horizonte de 72h são 11% — passa.
    expect(medirFrescor(horasAtras(8), 72, AGORA).fresca).toBe(true);
  });

  it("o teto vigente é o que o módulo exporta", () => {
    expect(MAX_FRACAO_DO_HORIZONTE).toBeGreaterThan(0);
    const noTeto = MAX_FRACAO_DO_HORIZONTE * 72;
    expect(medirFrescor(horasAtras(noTeto), 72, AGORA).fresca).toBe(false);
    expect(medirFrescor(horasAtras(noTeto * 0.99), 72, AGORA).fresca).toBe(true);
  });
});

describe("⚠️⚠️ FALHA ABERTA — sem sinal, a mesa opera", () => {
  it("sem data de criação, passa", () => {
    for (const v of [null, undefined, "", "não é data", "2026-13-45"]) {
      const f = medirFrescor(v, 72, AGORA);
      expect(f.fresca, String(v)).toBe(true);
      expect(f.fracaoGasta, String(v)).toBeNull();
    }
  });

  it("⚠️ sem horizonte, passa — e NÃO inventa 72h", () => {
    for (const h of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const f = medirFrescor(horasAtras(500), h, AGORA);
      expect(f.fresca, String(h)).toBe(true);
      // O atraso É conhecido e sai no relatório; só falta régua para julgá-lo.
      expect(f.fracaoGasta, String(h)).toBeNull();
      expect(f.atrasoHoras, String(h)).toBeCloseTo(500, 6);
    }
  });

  it("relógio torto (sugestão 'do futuro') não barra", () => {
    const futuro = new Date(AGORA + 3_600_000).toISOString();
    const f = medirFrescor(futuro, 72, AGORA);
    expect(f.fresca).toBe(true);
    expect(f.atrasoHoras).toBe(0);
  });

  it("`agora` ilegível não barra", () => {
    expect(medirFrescor(horasAtras(500), 72, Number.NaN).fresca).toBe(true);
  });
});

describe("sinalFresco concorda com medirFrescor", () => {
  it("os dois dizem a mesma coisa em todos os casos acima", () => {
    const casos: Array<[string | null, number | null]> = [
      [horasAtras(0.2), 72], [horasAtras(94.5), 72], [horasAtras(36), 72],
      [horasAtras(8), 12], [null, 72], [horasAtras(500), null],
    ];
    for (const [criada, hz] of casos) {
      expect(sinalFresco(criada, hz, AGORA), `${criada} / ${hz}`)
        .toBe(medirFrescor(criada, hz, AGORA).fresca);
    }
  });
});
