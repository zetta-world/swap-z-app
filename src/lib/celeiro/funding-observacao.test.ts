import { describe, expect, it, vi } from "vitest";
import { observarColheitaDeFunding } from "./funding-observacao";
import type { PeriodoDeFunding } from "./funding-colheita";

const config = {
  simbolos: ["BTC"], genomaVersao: 7, controleAnualPct: 3,
  margem: 2, janelaDias: 30, limiteDeSerie: 200,
};
const serie = (taxaPct: number): PeriodoDeFunding[] => Array.from({ length: 90 }, (_, i) => ({
  taxaPct, emMs: i * 8 * 3_600_000,
}));

describe("funding observado enquanto a contabilidade aguarda reconciliação", () => {
  it("oportunidade elegível continua sem entrada, taxa ou crédito em ticks repetidos", async () => {
    // A única capacidade fornecida é leitura. Não há banco, escritor, saldo
    // nem marcador de extrato que transforme a aprovação em lançamento.
    const ler = vi.fn().mockResolvedValue(serie(0.01));
    const primeira = await observarColheitaDeFunding(config, ler);
    const segunda = await observarColheitaDeFunding(config, ler);

    expect(primeira).toMatchObject({
      estado: "pendente_reconciliacao", entradasHabilitadas: false, creditosHabilitados: false,
      creditou: 0, escreveu: false, genomaVersao: 7, controleAnualPct: 3, margem: 2,
    });
    expect(primeira.exames).toHaveLength(1);
    expect(primeira.exames[0]).toMatchObject({
      simbolo: "BTC", candidatoElegivel: true, julgado: true, entra: false,
      periodos: 90, fatiaNegativa: 0,
    });
    expect(primeira.exames[0].anualPct).toBeGreaterThan(5);
    expect(primeira.exames[0].porqueCandidato).toContain("depois das 4 pernas");
    expect(primeira.exames[0].porque).toContain("reconciliar posições por símbolo");
    expect(segunda).toEqual(primeira);
    expect(ler.mock.calls).toEqual([["BTC", 200], ["BTC", 200]]);
  });

  it("funding negativo conserva a reprovação e as métricas sem criar débito", async () => {
    const relato = await observarColheitaDeFunding(config, async () => serie(-0.01));

    expect(relato.exames[0]).toMatchObject({
      candidatoElegivel: false, julgado: true, entra: false, periodos: 90,
      fatiaNegativa: 1, equilibrioEmDias: null,
    });
    expect(relato.exames[0].anualPct).toBeLessThan(0);
    expect(relato.exames[0].porqueCandidato).toContain("funding médio não é positivo");
    expect(relato.exames[0].porque).toBe(relato.exames[0].porqueCandidato);
    expect(relato).toMatchObject({ creditou: 0, escreveu: false, creditosHabilitados: false });
  });

  it.each([
    { caso: "série ausente", dados: null },
    { caso: "série vazia", dados: [] },
  ])("$caso é não julgada, sem inventar taxa zero ou reprovação econômica", async ({ dados }) => {
    const relato = await observarColheitaDeFunding(config, async () => dados);

    expect(relato.exames[0]).toMatchObject({ entra: false, candidatoElegivel: null, julgado: false });
    expect(relato.exames[0].porque).toContain("série não lida");
    expect(relato.exames[0]).not.toHaveProperty("anualPct");
    expect(relato.exames[0]).not.toHaveProperty("periodos");
  });

  it.each([null, Number.NaN])("controle não disponível (%s) não vira piso zero", async (controleAnualPct) => {
    const relato = await observarColheitaDeFunding({ ...config, controleAnualPct }, async () => serie(0.05));

    expect(relato.controleAnualPct).toBeNull();
    expect(relato.exames[0]).toMatchObject({ candidatoElegivel: null, julgado: false, entra: false });
    expect(relato.exames[0].porqueCandidato).toContain("sem a taxa do controle");
  });

  it("examina símbolos independentemente e conserva o custo de oportunidade do controle", async () => {
    const ler = vi.fn(async (simbolo: string) => simbolo === "BTC" ? serie(0.01) : serie(0.003));
    const relato = await observarColheitaDeFunding({ ...config, simbolos: ["BTC", "ETH"] }, ler);

    expect(relato.exames.map(({ simbolo, candidatoElegivel, entra }) => ({ simbolo, candidatoElegivel, entra })))
      .toEqual([
        { simbolo: "BTC", candidatoElegivel: true, entra: false },
        { simbolo: "ETH", candidatoElegivel: false, entra: false },
      ]);
    expect(relato.exames[1].anualPct).toBeGreaterThan(0);
    expect(relato.exames[1].porqueCandidato).toContain("Aluguel de Ocioso");
    expect(ler.mock.calls).toEqual([["BTC", 200], ["ETH", 200]]);
  });

  it("janela inválida permanece não julgada, sem aprovação por NaN", async () => {
    const relato = await observarColheitaDeFunding({ ...config, janelaDias: Number.NaN }, async () => serie(0.05));
    expect(relato.exames[0]).toMatchObject({ candidatoElegivel: null, julgado: false, entra: false });
    expect(relato.exames[0].porqueCandidato).toContain("parâmetros de comparação inválidos");
  });
});
