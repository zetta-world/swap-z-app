import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { POLITICA_CAPITAL_V1 } from "./capital";

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

  it("substitui US$35/h por staffing brasileiro carregado, treinamento sem dupla contagem e ramp-up", () => {
    expect(premissas.trabalho.salarioBaseL1BrlMes).toBe(3000);
    expect(premissas.trabalho.beneficiosBrlMesPessoa).toBeGreaterThan(0);
    expect(premissas.trabalho.ferramentasBrlMesPessoa).toBeGreaterThan(0);
    expect(premissas.trabalho.treinamentoHorasCobertasPelaFolhaL1).toBe(120);
    expect(premissas.trabalho.treinamentoHorasCobertasPelaFolhaLead).toBe(80);
    expect(premissas.trabalho.rampProdutividadeTresMeses).toEqual([0.45, 0.65, 0.8]);
    expect(Object.keys(premissas.trabalho.encargos)).toEqual(expect.arrayContaining([
      "decimoTerceiro", "tercoFerias", "fgts", "previdenciaPatronal", "rat", "terceiros",
    ]));
    expect(premissas.staffing.S1_LEAN.pessoas).toHaveLength(2);
    expect(premissas.staffing.S2_CEO_PLAN.pessoas).toHaveLength(3);
    expect(premissas.staffing.S3_MATURE.pessoas.map((p: any) => p.papel)).toEqual(["L1", "L1", "LEAD"]);

    const extraL1 = premissas.trabalho.recrutamentoBrlPorContratacao
      + premissas.trabalho.treinamentoCursoBrlPorL1
      + premissas.trabalho.supervisaoInicialHorasPorContratacao * premissas.trabalho.custoCeoEspecialistaBrlHora;
    expect(saida.staffingModels.S1_LEAN.treinamentoBrl).toBe(extraL1 * 2);
    expect(saida.staffingModels.S1_LEAN.horasTreinamentoNaFolha).toBe(240);
    expect(saida.staffingModels.S1_LEAN.suporteBrl).toBeGreaterThan(0);
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

  it("a obrigação dinâmica separa front-loaded, recurring e variable sem usar 1/36 cego", () => {
    expect(saida.serviceLiability.definition).toBe("DYNAMIC_REMAINING_SERVICE_LIABILITY");
    expect(saida.serviceLiability.reserveIsAdditionalCost).toBe(false);
    expect(saida.serviceLiability.buffers).toEqual([0.1, 0.25, 0.5]);
    expect(saida.serviceLiability.hybridP90Observed.status).toBe("UNAVAILABLE_WITHOUT_OBSERVED_TELEMETRY");
    const cp = Object.fromEntries(saida.serviceLiability.checkpoints.map((x: any) => [x.mesesPrestados, x]));
    expect(Object.keys(cp[0].tiers.pro)).toEqual(expect.arrayContaining(["frontLoaded", "recurring", "variable", "total"]));
    expect(cp[0].tiers.pro.frontLoaded).toBeGreaterThan(0);
    expect(cp[1].tiers.pro.frontLoaded).toBe(0);
    expect(cp[36].portfolioExpected).toBe(0);
    for (const [a, b] of [[0, 1], [1, 3], [3, 12], [12, 24], [24, 36]]) {
      expect(cp[a].portfolioExpected).toBeGreaterThan(cp[b].portfolioExpected);
    }
    const dbInicial = cp[0].tiers.pro.variable.databaseCloud;
    const dbMes12 = cp[12].tiers.pro.variable.databaseCloud;
    expect(dbMes12).not.toBeCloseTo(dbInicial * (24 / 36), 8);
    expect(dbMes12).toBeGreaterThan(dbInicial * (24 / 36));
    for (const ponto of saida.serviceLiability.checkpoints) {
      expect(ponto.reserveSensitivity["0.1"]).toBeCloseTo(ponto.portfolioExpected * 1.1, 8);
      expect(ponto.reserveSensitivity["0.25"]).toBeCloseTo(ponto.portfolioExpected * 1.25, 8);
      expect(ponto.reserveSensitivity["0.5"]).toBeCloseTo(ponto.portfolioExpected * 1.5, 8);
    }
  });

  it("reconcilia a reserva dentro dos 100% da capital policy, sem criar 141,5%", () => {
    expect(premissas.capitalPolicyV1Reference.totalBrl).toBe(POLITICA_CAPITAL_V1.referencia.totalBrl);
    expect(premissas.capitalPolicyV1Reference.grossUsd).toBe(POLITICA_CAPITAL_V1.referencia.brutoUsd);
    expect(premissas.capitalPolicyV1Reference.bucketsBrl).toEqual(Object.fromEntries(
      Object.entries(POLITICA_CAPITAL_V1.metas).map(([k, v]) => [k, v.referenciaBrl]),
    ));
    for (const r of saida.capitalReconciliation) {
      expect(r.reconciledTotalBrl).toBeCloseTo(r.grossProceedsBrl, 6);
      expect(r.exceedsGross).toBe(false);
      expect(r.taxRegulatoryBrl + r.serviceReserveBrl + r.emergencyRunwayBrl + r.deployableCorporateCapitalBrl)
        .toBeCloseTo(r.grossProceedsBrl, 6);
    }
  });

  it("regenera JSON e Markdown de forma determinística", () => {
    const jsonPath = join(raiz, "scripts/cost/founders-support-economics-output.json");
    const mdPath = join(raiz, "docs/FOUNDERS-SUPPORT-ECONOMICS-MODEL.md");
    const antes = [readFileSync(jsonPath, "utf8"), readFileSync(mdPath, "utf8")];
    const p = spawnSync(process.execPath, ["scripts/cost/modelo-founders-suporte-36m.mjs"], { cwd: raiz, encoding: "utf8" });
    expect(p.status, p.stderr).toBe(0);
    expect([readFileSync(jsonPath, "utf8"), readFileSync(mdPath, "utf8")]).toEqual(antes);
  });
});
