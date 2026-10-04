import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  BALDES, POLITICA_CAPITAL_V1, alocarCapital, cenarioBrlCentavos, converterParaBrl, limiarNucleoBrlCentavos, relatorioCapital, validarPolitica,
  type Alocacao, type Balde, type PoliticaCapital,
} from "./capital";

/**
 * Política de capital (planejamento): a cascata nunca aloca mais do que entrou, protege o runway antes da expansão
 * e falha fechada em entrada/política inválida. Com FOUNDERS_CAPITAL_OUT grava o relatório JSON da evidência.
 */
const P = POLITICA_CAPITAL_V1;
const R = (brl: number) => brl * 100;
const ok = (x: ReturnType<typeof alocarCapital>): Alocacao => { if (!x.ok) throw new Error(`esperava ok: ${x.erro} ${x.detalhe ?? ""}`); return x; };
const soma = (a: Alocacao) => BALDES.reduce((s, b) => s + a.porBalde[b], 0) + a.naoAlocadoBrlCentavos;

describe("política de capital v1 — aritmética do dono", () => {
  it("metas somam R$ 4.149.100 e os percentuais declarados (18,0 … 3,4) conferem e somam 100,0", () => {
    expect(validarPolitica(P)).toEqual([]);
    expect(BALDES.reduce((s, b) => s + P.metas[b].referenciaBrl, 0)).toBe(4_149_100);
    expect(BALDES.reduce((s, b) => s + Math.round(P.metas[b].percentualDeclarado * 10), 0)).toBe(1000);
    expect(P.metas.CEO.mensalBrl! * 24).toBe(360_000);
    expect(P.metas.IA.mensalBrl! * 24).toBe(300_000);
    expect(P.metas.INFRA.mensalBrl! * 24).toBe(360_000);
    expect(P.metas.EQUIPE.mensalBrl! * 24).toBe(720_000);
  });
  it("venda total (100 %) reproduz exatamente a referência, sem sobra nem falta", () => {
    const a = ok(alocarCapital(cenarioBrlCentavos(P, 10_000)));
    for (const b of BALDES) expect(a.porBalde[b], b).toBe(R(P.metas[b].referenciaBrl));
    expect(a.naoAlocadoBrlCentavos).toBe(0);
    expect(a).toMatchObject({ RUNWAY_STATUS: "PROTECTED_24M", patamar: "COMPLETO", TEAM_EXPANSION_STATUS: "FULL_REFERENCE_CONTROLLED_RELEASE",
      GROWTH_UNLOCK_STATUS: "FULL_REFERENCE_CONTROLLED_RELEASE", OFFICE_UNLOCK_STATUS: "PREPARATION_ONLY_GATE_PENDING", runwayMesesCobertos: { CEO: 24, IA: 24, INFRA: 24 } });
  });
  it("núcleo protegido fecha em ≈ R$ 2,106 mi (patamar de sobrevivência ≈ R$ 2,1 mi do dono)", () => {
    const lim = limiarNucleoBrlCentavos();
    expect(lim).toBeGreaterThan(R(2_100_000)); expect(lim).toBeLessThan(R(2_110_000));
    expect(ok(alocarCapital(lim)).nucleoProtegidoCompleto).toBe(true);
    expect(ok(alocarCapital(lim - 1)).nucleoProtegidoCompleto).toBe(false);
  });
});

describe("cascata: runway primeiro, expansão depois — nunca mais do que entrou", () => {
  const casos: Array<[string, number]> = [
    ["zero", 0], ["baixo custom (R$ 300 mil)", R(300_000)], ["25 %", cenarioBrlCentavos(P, 2500)], ["50 %", cenarioBrlCentavos(P, 5000)],
    ["75 %", cenarioBrlCentavos(P, 7500)], ["100 %", cenarioBrlCentavos(P, 10_000)], ["acima da referência", R(6_000_000)], ["centavo ímpar", 123_456_789],
  ];
  for (const [nome, c] of casos) {
    it(`${nome}: soma exata, nenhum balde negativo nem acima da meta`, () => {
      const a = ok(alocarCapital(c));
      expect(soma(a)).toBe(c);
      for (const b of BALDES) {
        expect(a.porBalde[b]).toBeGreaterThanOrEqual(0);
        if (b !== "IMPOSTOS") expect(a.porBalde[b]).toBeLessThanOrEqual(R(P.metas[b].referenciaBrl));
      }
      expect(a.aviso).toBe("PLANEJAMENTO_NAO_CONTABILIDADE");
    });
  }
  it("zero: nada alocado, tudo travado", () => {
    expect(ok(alocarCapital(0))).toMatchObject({ RUNWAY_STATUS: "NO_CAPITAL", patamar: "ZERO", TEAM_EXPANSION_STATUS: "LOCKED", GROWTH_UNLOCK_STATUS: "LOCKED", OFFICE_UNLOCK_STATUS: "LOCKED", naoAlocadoBrlCentavos: 0 });
  });
  it("25 %: impostos proporcionais, depois emergência e CEO; IA/infra/expansão ficam sem nada (ordem do dono)", () => {
    const c = cenarioBrlCentavos(P, 2500);
    const a = ok(alocarCapital(c));
    expect(a.porBalde.IMPOSTOS).toBe(Math.floor((c * 747_000) / 4_149_100));
    expect(a.porBalde.EMERGENCIA).toBe(R(502_100));
    expect(a.porBalde.CEO).toBeGreaterThan(0);
    for (const b of ["EQUIPE", "CRESCIMENTO", "ESCRITORIO", "OPERACOES"] as Balde[]) expect(a.porBalde[b]).toBe(0);
    expect(a).toMatchObject({ RUNWAY_STATUS: "AT_RISK", patamar: "SOBREVIVENCIA_NUCLEO_INCOMPLETO", TEAM_EXPANSION_STATUS: "LOCKED", OFFICE_UNLOCK_STATUS: "LOCKED" });
  });
  it("50 % (≈ R$ 2,07 mi): runway de 24 meses protegido, núcleo ainda incompleto (estação parcial), sem expansão", () => {
    const a = ok(alocarCapital(cenarioBrlCentavos(P, 5000)));
    expect(a.RUNWAY_STATUS).toBe("PROTECTED_24M");
    expect(a.nucleoProtegidoCompleto).toBe(false);
    expect(a.porBalde.ESTACAO).toBeLessThan(R(80_000));
    expect(a.porBalde.EQUIPE + a.porBalde.CRESCIMENTO + a.porBalde.ESCRITORIO).toBe(0);
  });
  it("75 % (≈ R$ 3,11 mi): expansão pro rata; escritório ainda TRAVADO (abaixo de R$ 3,2 mi)", () => {
    const a = ok(alocarCapital(cenarioBrlCentavos(P, 7500)));
    expect(a).toMatchObject({ patamar: "AQUISICAO", TEAM_EXPANSION_STATUS: "SELECTED_SPECIALISTS", GROWTH_UNLOCK_STATUS: "EXPANDED_ACQUISITION", OFFICE_UNLOCK_STATUS: "LOCKED" });
    expect(a.porBalde.ESCRITORIO).toBe(0);
    expect(a.naoAlocadoBrlCentavos).toBeGreaterThan(0); // a cota do escritório fica em reserva, não vai para outro balde
    expect(a.porBalde.EQUIPE).toBeGreaterThan(0);
    expect(a.porBalde.CRESCIMENTO).toBeLessThan(R(450_000)); // nada é gasto "inteiro" só porque entrou dinheiro
  });
  it("R$ 3,2 mi: equipe maior e preparação do escritório — portão só com fatos operacionais", () => {
    expect(ok(alocarCapital(R(3_200_000)))).toMatchObject({ patamar: "EQUIPE", TEAM_EXPANSION_STATUS: "LARGER_TEAM", OFFICE_UNLOCK_STATUS: "PREPARATION_ONLY_GATE_PENDING" });
    const fatos = { plataformaOperacional: true, razaoDeNegocioDemonstrada: true, mesesRunwayRestantesAposCompromisso: 18 };
    expect(ok(alocarCapital(R(3_200_000), P, fatos)).OFFICE_UNLOCK_STATUS).toBe("GATE_SATISFIED");
    expect(ok(alocarCapital(R(3_200_000), P, { ...fatos, mesesRunwayRestantesAposCompromisso: 17 })).OFFICE_UNLOCK_STATUS).toBe("PREPARATION_ONLY_GATE_PENDING");
    expect(ok(alocarCapital(R(3_200_000), P, { ...fatos, plataformaOperacional: false })).OFFICE_UNLOCK_STATUS).toBe("PREPARATION_ONLY_GATE_PENDING");
    expect(ok(alocarCapital(R(2_500_000), P, fatos)).OFFICE_UNLOCK_STATUS).toBe("LOCKED"); // capital não destrava escritório sozinho
  });
  it("acima da referência: o excedente fica NÃO ALOCADO (reserva), nenhum orçamento passa da meta", () => {
    const a = ok(alocarCapital(R(6_000_000)));
    expect(a.naoAlocadoBrlCentavos).toBeGreaterThan(0);
    for (const b of BALDES.filter((x) => x !== "IMPOSTOS")) expect(a.porBalde[b]).toBe(R(P.metas[b].referenciaBrl));
  });
  it("monotônico: captar mais nunca reduz NENHUM balde (nem ao destravar o escritório)", () => {
    let antes = ok(alocarCapital(0));
    for (let brl = 50_000; brl <= 4_500_000; brl += 50_000) {
      const a = ok(alocarCapital(R(brl)));
      for (const b of BALDES) expect(a.porBalde[b], `${b} em R$ ${brl}`).toBeGreaterThanOrEqual(antes.porBalde[b]);
      antes = a;
    }
  });
});

describe("falha fechada", () => {
  it("captado negativo, NaN, infinito, fracionário", () => {
    expect(alocarCapital(-1)).toEqual({ ok: false, erro: "captado_negativo" });
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) expect(alocarCapital(v)).toEqual({ ok: false, erro: "captado_invalido" });
  });
  it("câmbio inválido e conversão USD→BRL arredondando para baixo", () => {
    for (const fx of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(converterParaBrl(1000, fx)).toEqual({ ok: false, erro: "cambio_invalido" });
    expect(converterParaBrl(-1, 5)).toEqual({ ok: false, erro: "captado_negativo" });
    expect(converterParaBrl(Number.NaN, 5)).toEqual({ ok: false, erro: "captado_invalido" });
    expect(converterParaBrl(796_250, 5.2)).toEqual({ ok: true, centavos: 414_050_000 });
    expect(converterParaBrl(0.01, 5.123456)).toEqual({ ok: true, centavos: 5 });
  });
  it("percentuais inválidos, metas que não somam, níveis fora de ordem, balde sem lugar", () => {
    const mexer = (f: (p: PoliticaCapital) => void) => { const p = structuredClone(P) as PoliticaCapital; f(p); return alocarCapital(R(1_000_000), p); };
    expect(mexer((p) => { p.metas.EQUIPE.percentualDeclarado = 20; })).toMatchObject({ ok: false, erro: "politica_invalida" });
    expect(mexer((p) => { p.metas.CRESCIMENTO.referenciaBrl += 1; })).toMatchObject({ ok: false, erro: "politica_invalida" });
    expect(mexer((p) => { p.metas.IA.referenciaBrl = -1; })).toMatchObject({ ok: false, erro: "politica_invalida" });
    expect(mexer((p) => { p.niveis.aquisicao = 1; })).toMatchObject({ ok: false, erro: "politica_invalida" });
    expect(mexer((p) => { (p as unknown as { expansao: Balde[] }).expansao = ["SEGURANCA", "EQUIPE"]; })).toMatchObject({ ok: false, erro: "politica_invalida" });
    expect(mexer((p) => { p.segurancaMinimaBrl = 300_000; })).toMatchObject({ ok: false, erro: "politica_invalida" });
  });
});

describe("relatório do painel de planejamento (local)", () => {
  it("25/50/75/100 % + custom, determinístico, sem saldo bancário", () => {
    const r = relatorioCapital(P, [R(1_500_000)]);
    expect(r.linhas.map((l) => l.nome)).toEqual(["25%", "50%", "75%", "100%", "custom-1"]);
    expect(r.linhas.map((l) => l.captadoBrlCentavos)).toEqual([R(1_037_275), R(2_074_550), R(3_111_825), R(4_149_100), R(1_500_000)]);
    expect(JSON.stringify(relatorioCapital(P, [R(1_500_000)]))).toBe(JSON.stringify(r));
    expect(JSON.stringify(r)).not.toMatch(/saldo|balance|banco|bank/i);
    const out = process.env.FOUNDERS_CAPITAL_OUT;
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "capital-relatorio.json"), JSON.stringify(r, null, 2)); }
  });
});
