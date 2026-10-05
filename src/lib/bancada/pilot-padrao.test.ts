/**
 * RM-10 — PROVA: um Pilot consegue rodar 5.000 "backtests padrão" por 24h dentro do orçamento 1/16?
 *
 * Definição proposta (CEO + auditor, NÃO aprovada): até 3 ativos × 1 ano × velas de 4h, estratégia
 * própria. A prova é pela FÓRMULA da rota (`custoDoPedido` → `unidadesDoPedido` → orçamento), com
 * o custo unitário CONGELADO aqui (se a fórmula mudar, este teste quebra e a conclusão tem de ser
 * refeita), casos de borda, e a reserva REAL no banco em `bench/integracao/pilot-padrao.integration.ts`
 * (5.000 reservas aceitas, a 5.001ª recusada por COTA, não por orçamento).
 *
 *   STANDARD_5000_FITS = YES (estratégia própria) · modo mesa com a mesma definição = NO.
 */
import { describe, it, expect } from "vitest";
import {
  BACKTEST_PADRAO, unidadesDe, backtestsPorDiaDe, orcamentoDiarioDeUnidades, FRACAO_DO_TETO_NO_ORCAMENTO,
  validarPedido, custoDoPedido, unidadesDoPedido,
} from "@/lib/bancada/cotas";
import { BANCADA_COTAS } from "@/lib/tier/types";

const DIA = 86_400_000;

describe("RM-10 · a fórmula e o custo unitário, congelados", () => {
  it("o orçamento do Pilot é 5.000 × (10 × 730 × 24) × 1/16 = 54.750.000 unidades — e a fração NÃO mudou", () => {
    expect(FRACAO_DO_TETO_NO_ORCAMENTO.pilot).toBe(1 / 16);
    expect(orcamentoDiarioDeUnidades("pilot")).toBe(54_750_000);
    expect(BANCADA_COTAS.pilot.backtestsPorDia).toBe(5000);
  });

  it("backtest padrão = 3 × ⌈365 d / 4 h⌉ = 3 × 2.190 = 6.570 unidades", () => {
    expect(BACKTEST_PADRAO).toMatchObject({ simbolos: 3, dias: 365, intervalo: "4h", mesa: false, status: "PROPOSTA_NAO_APROVADA" });
    expect(unidadesDe(3, 365, "4h")).toBe(6570);
  });

  it("⚠️ a fórmula é a da ROTA: o pedido real de 3 × 365 d × 4h passa a validação e custa o mesmo", () => {
    const fim = 1_790_000_000_000 - (1_790_000_000_000 % (4 * 3_600_000));
    const pedido = { simbolos: ["BTC", "ETH", "SOL"], intervalo: "4h", janelaDe: fim - 365 * DIA, janelaAte: fim, capitalUsd: 10_000 };
    const v = validarPedido("pilot", pedido);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.unidades).toBe(6570);
    expect(unidadesDoPedido(pedido, custoDoPedido(pedido)!)).toBe(6570);
  });
});

describe("⚠️⚠️ STANDARD_5000_FITS", () => {
  it("YES — 5.000 × 6.570 = 32.850.000 ≤ 54.750.000 (folga de 1,67×); cabem 8.333 por orçamento, a cota limita em 5.000", () => {
    const u = unidadesDe(3, 365, "4h")!;
    expect(5000 * u).toBe(32_850_000);
    expect(5000 * u).toBeLessThanOrEqual(orcamentoDiarioDeUnidades("pilot"));
    expect(Math.floor(orcamentoDiarioDeUnidades("pilot") / u)).toBe(8333);
    expect(backtestsPorDiaDe("pilot", u)).toBe(5000);
    expect(orcamentoDiarioDeUnidades("pilot") / (5000 * u)).toBeCloseTo(1.667, 3);
  });

  it("bordas: QUALQUER pedido dentro da definição (≤ 3 ativos, ≤ 365 d, intervalo ≥ 4h) também cabe 5.000×", () => {
    for (const s of [1, 2, 3]) for (const d of [1, 30, 90, 180, 364, 365]) for (const iv of ["4h", "1d"]) {
      const u = unidadesDe(s, d, iv)!;
      expect(backtestsPorDiaDe("pilot", u), `${s}×${d}d×${iv}`).toBe(5000);
    }
  });

  it("e o limite exato: a rodada média pode ir até 10.950 unidades; 10.951 já não cabe 5.000×", () => {
    expect(backtestsPorDiaDe("pilot", 10_950)).toBe(5000);
    expect(backtestsPorDiaDe("pilot", 10_951)).toBe(4999);
  });

  it("⚠️ NO para o MODO MESA com a mesma definição: 3 × 1 ano custa 67.890 unidades → 806/dia", () => {
    const u = unidadesDe(3, 365, "4h", true)!;
    expect(u).toBe(67_890);   // (8.760 + 2.190 + 365) × 3 × 2
    expect(backtestsPorDiaDe("pilot", u)).toBe(806);
    // o que cabe 5.000× no modo mesa: 1 ativo × 90 dias (5.580)
    expect(backtestsPorDiaDe("pilot", unidadesDe(1, 90, "1h", true)!)).toBe(5000);
    expect(backtestsPorDiaDe("pilot", unidadesDe(3, 90, "1h", true)!)).toBeLessThan(5000);
  });
});

describe("RM-10/§13 · a tabela do mandato, por plano (unidades, rodadas/dia alcançáveis, saldo após uma)", () => {
  const CASOS: Array<[string, number, number, string, number, { pro: number; trader: number; pilot: number }]> = [
    // nome, ativos, dias, intervalo, unidades, rodadas/dia alcançáveis
    ["1 × 30 d × 1d",    1,  30, "1d",     30, { pro: 100, trader: 500, pilot: 5000 }],
    ["3 × 365 d × 4h",   3, 365, "4h",   6570, { pro: 100, trader: 500, pilot: 5000 }],
    ["10 × 90 d × 1h",  10,  90, "1h",  21600, { pro: 100, trader: 500, pilot: 2534 }],
    ["10 × 365 d × 1h", 10, 365, "1h",  87600, { pro: 50,  trader: 250, pilot: 625 }],
    ["10 × 730 d × 1h", 10, 730, "1h", 175200, { pro: 25,  trader: 125, pilot: 312 }],
  ];
  for (const [nome, s, d, iv, unidades, alcancaveis] of CASOS) {
    it(nome, () => {
      expect(unidadesDe(s, d, iv)).toBe(unidades);
      for (const tier of ["pro", "trader", "pilot"] as const) {
        expect(backtestsPorDiaDe(tier, unidades), `${nome} ${tier}`).toBe(alcancaveis[tier]);
        // saldo depois de UMA rodada destas, começando do zero
        expect(orcamentoDiarioDeUnidades(tier) - unidades).toBeGreaterThanOrEqual(0);
      }
    });
  }
});
