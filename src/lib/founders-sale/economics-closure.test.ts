import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = process.cwd();
const base = JSON.parse(readFileSync(join(raiz, "scripts/cost/premissas-36-meses.json"), "utf8"));
const premissas = JSON.parse(readFileSync(join(raiz, "scripts/cost/premissas-founders-suporte-36m.json"), "utf8"));
const saida = JSON.parse(readFileSync(join(raiz, "scripts/cost/founders-support-economics-output.json"), "utf8"));

describe("Founders support economics — premissas autoritativas", () => {
  it("usa supply, reserva e preços provisórios exatos", () => {
    expect(Object.fromEntries(Object.entries(base.tiers).filter(([k]) => !k.startsWith("_")).map(([k, x]: [string, any]) => [k, {
      pago: x.supplyPago, reserva: x.reserva, preco: x.preco,
    }]))).toEqual({
      pro: { pago: 2000, reserva: 30, preco: 149 },
      trader: { pago: 750, reserva: 10, preco: 399 },
      pilot: { pago: 100, reserva: 0, preco: 1990 },
    });
  });

  it("substitui US$35/h por staffing brasileiro carregado, treinamento e ramp-up", () => {
    expect(premissas.trabalho.salarioBaseL1BrlMes).toBe(3000);
    expect(premissas.trabalho.beneficiosBrlMesPessoa).toBeGreaterThan(0);
    expect(premissas.trabalho.ferramentasBrlMesPessoa).toBeGreaterThan(0);
    expect(premissas.trabalho.treinamentoHorasL1).toBeGreaterThan(0);
    expect(premissas.trabalho.rampProdutividadeTresMeses).toEqual([0.45, 0.65, 0.8]);
    expect(Object.keys(premissas.trabalho.encargos)).toEqual(expect.arrayContaining([
      "decimoTerceiro", "tercoFerias", "fgts", "previdenciaPatronal", "rat", "terceiros",
    ]));
    expect(premissas.staffing.S1_LEAN.pessoas).toHaveLength(2);
    expect(premissas.staffing.S2_CEO_PLAN.pessoas).toHaveLength(3);
    expect(premissas.staffing.S3_MATURE.pessoas.map((p: any) => p.papel)).toEqual(["L1", "L1", "LEAD"]);
  });

  it("modela deflexão ZION, escalação CEO e operação sem 24/7", () => {
    expect(premissas.operacao.deflexaoSensibilidade).toEqual([0.3, 0.5, 0.7, 0.85]);
    expect(premissas.operacao.escalacaoSensibilidade).toEqual([0.005, 0.01, 0.02, 0.05]);
    expect(premissas.operacao.humano24x7).toBe(false);
    expect(premissas.operacao.dias).toBe("segunda a sábado");
    expect(premissas.operacao.gatilhoTerceiraPessoa.utilizacao).toBe(0.7);
  });
});

describe("Founders support economics — saída reproduzível e completa", () => {
  it("separa todas as categorias econômicas por tier e cenário", () => {
    expect(saida.lines).toHaveLength(9);
    for (const linha of saida.lines) {
      for (const campo of ["compute", "ai", "databaseCloud", "support", "ceoExpert", "training", "fixed", "otherOps", "total"]) {
        expect(linha[campo], `${linha.cenario}/${linha.tier}/${campo}`).toBeGreaterThanOrEqual(0);
      }
      const soma = linha.compute + linha.ai + linha.databaseCloud + linha.support + linha.ceoExpert
        + linha.training + linha.fixed + linha.otherOps;
      expect(linha.total).toBeCloseTo(soma, 10);
    }
  });

  it("não embeleza cenários: expected cabe; heavy e stress revelam perdas", () => {
    const linha = (cenario: string, tier: string) => saida.lines.find((x: any) => x.cenario === cenario && x.tier === tier);
    expect(linha("EXPECTED", "pro").total).toBeLessThan(149);
    expect(linha("EXPECTED", "trader").total).toBeLessThan(399);
    expect(linha("EXPECTED", "pilot").total).toBeLessThan(1990);
    expect(linha("HEAVY", "pro").total).toBeGreaterThan(149);
    expect(linha("HEAVY", "trader").total).toBeGreaterThan(399);
    expect(linha("STRESS", "pilot").total).toBeLessThan(1990);
    expect(1990 * 0.9 - linha("STRESS", "pilot").total).toBeLessThan(0);
  });

  it("a reserva de serviço é passivo expected remanescente mais buffer, sem misturar outras reservas", () => {
    expect(premissas.prudentialServiceReserveBuffer).toBe(0.25);
    const camposProibidos = ["tax", "emergency", "runway", "growth"];
    expect(camposProibidos.some((k) => k in premissas)).toBe(false);
    const pro = saida.lines.find((x: any) => x.cenario === "EXPECTED" && x.tier === "pro");
    expect(pro.total * (1 + premissas.prudentialServiceReserveBuffer)).toBeCloseTo(79.148767, 5);
  });
});
