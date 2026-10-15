/**
 * LIFI-UPSTREAM-01 (ativação, 15/10) — reconhecer a taxa da Z-SWAP na resposta do LI.FI.
 *
 * Medido na API real com o integrator `zswap` cadastrado (`__fixtures__/lifi-taxa-zswap-20261015.json`):
 * o LI.FI NÃO separa a taxa do integrador — ele a SOMA à dele numa linha só, "LIFI Fixed Fee":
 *   · sem `fee`        → 0,0025  (só o LI.FI)
 *   · `fee=0.01` (free) → 0,0125  (1% nosso + 0,25% dele)
 *   · `fee=0.001` (pilot) → 0,0035
 * A busca antiga por nome (`integrator|z-swap|referrer`) não achava nada, e a rota disparava o
 * alerta "TAXA NÃO RETIDA" e gravava `taxaAceita: []` em toda cotação com taxa — falso.
 */
import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/lifi-taxa-zswap-20261015.json";
import { taxaDoIntegradorNaCotacao, type LfQuote } from "@/lib/api/lifi";

const r = fixture.respostas as unknown as Record<string, LfQuote>;

describe("taxaDoIntegradorNaCotacao · a parte da Z-SWAP = total − taxa própria do LI.FI", () => {
  it("free (1%): reconhecida, ~1%, no token enviado", () => {
    const t = taxaDoIntegradorNaCotacao(r["eth-arb-free"], 0.01);
    expect(t).not.toBeNull();
    expect(t!.pct).toBeCloseTo(0.01, 6);
    expect(t!.pctTotal).toBeCloseTo(0.0125, 6);
    expect(t!.token).toBe("ETH");
    // 250000000000000 × (0,01 / 0,0125) = 200000000000000
    expect(t!.amount).toBe("200000000000000");
  });

  it("pilot (0,10%): reconhecida mesmo sendo MENOR que a taxa do LI.FI", () => {
    const t = taxaDoIntegradorNaCotacao(r["eth-op-pilot"], 0.001);
    expect(t!.pct).toBeCloseTo(0.001, 6);
  });

  it("stablecoin (USDC): no token USDC", () => {
    const t = taxaDoIntegradorNaCotacao(r["usdc-eth-base-free"], 0.01);
    expect(t!.token).toBe("USDC");
    expect(t!.amount).toBe("500000");
  });

  it("⚠️ gêmea: pedimos 0,10% e a resposta só tem os 0,25% do LI.FI → NÃO retida (0,25 ≥ 0,10 não basta)", () => {
    expect(taxaDoIntegradorNaCotacao(r["eth-arb-SEM-taxa"], 0.001)).toBeNull();
    expect(taxaDoIntegradorNaCotacao(r["eth-arb-SEM-taxa"], 0.01)).toBeNull();
  });

  it("nada pedido → nada a reconhecer", () => {
    expect(taxaDoIntegradorNaCotacao(r["eth-arb-free"], 0)).toBeNull();
  });

  it("se um dia o LI.FI separar a linha do integrador, ela é aceita como está", () => {
    const q = { estimate: { feeCosts: [
      { name: "LIFI Fixed Fee", percentage: "0.0025", amount: "50", token: { symbol: "ETH" } },
      { name: "Integrator Fee", percentage: "0.01", amount: "200", token: { symbol: "ETH" } },
    ] } } as unknown as LfQuote;
    expect(taxaDoIntegradorNaCotacao(q, 0.01)).toMatchObject({ pct: 0.01, amount: "200", token: "ETH" });
  });

  it("resposta sem custos ou torta → null (o alerta dispara: melhor alarme falso do que receita fingida)", () => {
    expect(taxaDoIntegradorNaCotacao({ estimate: {} } as unknown as LfQuote, 0.01)).toBeNull();
    expect(taxaDoIntegradorNaCotacao({ estimate: { feeCosts: [{ name: "LIFI Fixed Fee", percentage: "abc", amount: "1" }] } } as unknown as LfQuote, 0.01)).toBeNull();
  });
});
