import { describe, it, expect } from "vitest";
import { portaoDeSobrevivencia } from "@/lib/celeiro/pool-novo";

/**
 * ⚠️⚠️ "NÃO MEDI" E "MEDI E NÃO ESTÁ TRAVADA" REPROVAM IGUAL — mas dizem coisas
 * diferentes (07/09).
 *
 * Em 18 dias o `pool_novo` examinou 5.004 pools e aprovou ZERO. Dos 2.804 que
 * chegaram ao portão, 2.591 (92,4%) caíram nesta linha — com UMA frase só para
 * os dois casos. Não havia como decidir entre "o mercado da Base é assim mesmo"
 * (nada a fazer) e "a GoPlus não indexa LP nesta chain" (trocar de fonte ou de
 * chain). Instrumento que não separa as duas manda ajustar às cegas.
 */
describe("a recusa da trava distingue não-medido de medido-e-solto", () => {
  const base = {
    liquidezUsd: 50_000, concentracaoTop10: 0.2,
    vendaTestePassou: true, idadeMinutos: 60,
  };

  it("não medido: a recusa DIZ que não foi medido", () => {
    const p = portaoDeSobrevivencia({ ...base, liquidezTravada: null } as never);
    expect(p.entra).toBe(false);
    expect(p.recusas.join(" ")).toContain("NÃO MEDIDA");
  });

  it("medido e solto: a recusa é sobre o POOL, não sobre a leitura", () => {
    const p = portaoDeSobrevivencia({ ...base, liquidezTravada: false } as never);
    expect(p.entra).toBe(false);
    expect(p.recusas.join(" ")).toContain("quem criou pode retirá-la");
    expect(p.recusas.join(" ")).not.toContain("NÃO MEDIDA");
  });

  /** ⚠️ A DECISÃO NÃO MUDOU: os dois reprovam. Só o diagnóstico melhorou. */
  it("travada de verdade continua sendo o único caminho para entrar", () => {
    expect(portaoDeSobrevivencia({ ...base, liquidezTravada: true } as never).entra).toBe(true);
  });
});
