/**
 * ⚠️⚠️ A VITRINE E A PORTA DIZEM A MESMA COISA — a trava da fase 7.
 *
 * A cicatriz literal: o card do plano Free anunciava "5 análises/dia" em quatro
 * idiomas enquanto `FEATURE_TIER` exigia `pro`. Com os gates ligados o usuário
 * recebia **402 — zero análises, não cinco**. Duas fontes diziam cinco, uma
 * dizia nenhuma, e a que dizia nenhuma era a que valia.
 *
 * ⚠️ Cada lado, SOZINHO, estava coerente — e é por isso que teste nenhum pegava.
 * Este aqui só existe porque compara os dois.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { varsDaBancada, capitalCurto } from "@/lib/bancada/vitrine";
import { BANCADA_COTAS, FEATURE_TIER, ALL_TIERS, tierSatisfies, type Tier } from "@/lib/tier/types";

const RAIZ = path.join(process.cwd(), "src");
const PAGOS: Tier[] = ["pro", "trader", "pilot"];

function fonte(rel: string): string {
  return fs.readFileSync(path.join(RAIZ, rel), "utf8");
}

describe("os números da bancada na vitrine vêm da COTA", () => {
  it.each(ALL_TIERS)("%s: o que o card mostra é o que a cota dá", (tier) => {
    const v = varsDaBancada(tier);
    const c = BANCADA_COTAS[tier];
    expect(v.backtests).toBe(c.backtestsPorDia);
    expect(v.mesas).toBe(c.mesasDePapel);
    expect(`$${v.capital}`).toBe(capitalCurto(c.capitalMaxUsd));
  });

  it("⚠️ o capital é formatado de forma DETERMINÍSTICA", () => {
    // `toLocaleString` formata conforme o ambiente, e servidor e navegador podem
    // discordar — hidratação quebrada por um separador decimal só aparece em
    // produção.
    expect(capitalCurto(1_000)).toBe("$1k");
    expect(capitalCurto(25_000)).toBe("$25k");
    expect(capitalCurto(250_000)).toBe("$250k");
    expect(capitalCurto(100_000_000)).toBe("$100M");
    expect(capitalCurto(0)).toBe("$0");
    expect(capitalCurto(NaN)).toBe("$0");
  });

  it("⚠️ nenhuma tela de venda digita um número de cota à mão", () => {
    // Um "10 testes/dia" escrito no card sobrevive à mudança da cota, e volta a
    // ser a cicatriz do Free/ZION.
    for (const rel of ["components/pricing/PricingView.tsx", "components/pricing/NormalPlansView.tsx"]) {
      const src = fonte(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src, rel).not.toMatch(/backtests?\s*\/\s*dia|testes\s*\/\s*dia|backtests?\/day/i);
    }
  });
});

describe("⚠️ o papel adiante só é anunciado a quem o portão deixa entrar", () => {
  it("quem tem mesa no plano satisfaz o portão, e quem não tem, não", () => {
    for (const tier of ALL_TIERS) {
      const temMesa = BANCADA_COTAS[tier].mesasDePapel > 0;
      const passaNoPortao = tierSatisfies(tier, FEATURE_TIER.bancadaPapelAdiante as Tier);
      // ⚠️ As duas fontes têm de concordar EM AMBAS as direções: anunciar mesa
      // a quem o portão barra é o Free/ZION; barrar quem tem mesa é o mesmo
      // defeito com o sinal trocado.
      expect(temMesa, `tier ${tier}`).toBe(passaNoPortao);
    }
  });

  it("o card só lista `featPapelAdiante` para quem tem mesa", () => {
    const src = fonte("components/pricing/NormalPlansView.tsx");
    for (const tier of PAGOS) {
      const linha = src.split("\n").find((l) => l.trim().startsWith(`${tier}:`)) ?? "";
      const anuncia = linha.includes("featPapelAdiante");
      expect(anuncia, `tier ${tier}`).toBe(BANCADA_COTAS[tier].mesasDePapel > 0);
    }
  });

  it("⚠️ todo plano pago anuncia a bancada — ela abre no `free`", () => {
    // `FEATURE_TIER.bancadaBacktest` é `free`: quem separa os planos é a COTA.
    // Um card pago que não mencionasse a bancada esconderia o que já está pago.
    expect(FEATURE_TIER.bancadaBacktest).toBe("free");
    const src = fonte("components/pricing/NormalPlansView.tsx");
    for (const tier of PAGOS) {
      const linha = src.split("\n").find((l) => l.trim().startsWith(`${tier}:`)) ?? "";
      expect(linha, `tier ${tier}`).toContain("featBancada");
    }
  });
});
