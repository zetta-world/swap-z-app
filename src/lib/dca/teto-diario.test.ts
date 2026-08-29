import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tetoDoCiclo } from "@/lib/dca/relogio";

/**
 * ⚠️⚠️ O TETO DIÁRIO É DA CARTEIRA, NÃO DO PLANO — e a chamada dizia outra coisa.
 *
 * `gastoHojeDaCarteira` existe, segundo o próprio cabeçalho dela, porque:
 *
 *   "sem sessão para herdar limite, dez planos de US$ 100/dia na mesma carteira
 *    seriam US$ 1.000/dia com nada olhando o conjunto"
 *
 * E o único chamador passava `[p.id]` — o plano CORRENTE, sozinho. O teto que
 * a função promete para a carteira era, na prática, um teto POR PLANO: dez
 * planos na mesma carteira davam dez vezes o limite, que é exatamente o
 * cenário nomeado como motivo da função existir.
 *
 * Este arquivo tem duas metades porque o defeito tinha duas metades: a
 * aritmética (que sempre esteve certa) e QUEM entra nela (que estava errado).
 */

describe("a aritmética do teto sempre esteve certa", () => {
  const base = {
    porCicloUsd: 100, gastoAcumuladoUsd: 0, orcamentoTotalUsd: 10_000,
    tetoPlataformaUsd: 500, minimoUsd: 5,
  };

  it("com o gasto do dia INTEIRO da carteira, o teto barra", () => {
    // Nove planos de $100 já compraram hoje: $900 de $1.000.
    const r = tetoDoCiclo({ ...base, gastoHojeCarteiraUsd: 900, tetoDiarioCarteiraUsd: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valorUsd).toBeCloseTo(100, 10); // cabe justo

    const estourou = tetoDoCiclo({ ...base, gastoHojeCarteiraUsd: 1000, tetoDiarioCarteiraUsd: 1000 });
    expect(estourou.ok).toBe(false);
    if (!estourou.ok) expect(estourou.motivo).toBe("teto_diario_carteira");
  });

  it("⚠️ com o gasto de UM plano só, o mesmo estado passa — o furo", () => {
    // Mesmo instante do caso acima: a carteira já gastou $1.000 hoje. Mas se
    // quem pergunta só olha o plano corrente (que ainda não comprou hoje), o
    // gasto lido é 0 e o ciclo é LIBERADO.
    const r = tetoDoCiclo({ ...base, gastoHojeCarteiraUsd: 0, tetoDiarioCarteiraUsd: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valorUsd).toBeCloseTo(100, 10);
  });
});

/**
 * ⚠️ ESTE TESTE LÊ O CÓDIGO-FONTE, e isso é deliberado.
 *
 * O defeito não estava numa função — estava no ARGUMENTO de uma chamada. Não há
 * valor de retorno para checar: `gastoHojeDaCarteira([p.id])` tem exatamente o
 * mesmo tipo de `gastoHojeDaCarteira(idsDaCarteira)`, e o TypeScript aprova os
 * dois. Um teste de comportamento só pegaria isto com um banco de verdade e
 * dois planos na mesma carteira.
 *
 * Então a trava é textual: proibir a forma que estava errada. É frágil a
 * renomeação, e mesmo assim vale mais que nada — a alternativa era não ter
 * guarda nenhuma sobre o argumento de um teto de dinheiro.
 */
describe("o chamador passa os planos DA CARTEIRA, não o plano corrente", () => {
  const fonte = readFileSync(
    join(process.cwd(), "src/app/api/dca/cron/route.ts"), "utf8",
  );

  it("⚠️ NUNCA `gastoHojeDaCarteira([p.id])` — isso é teto por plano", () => {
    expect(fonte).not.toMatch(/gastoHojeDaCarteira\(\s*\[\s*p\.id\s*\]\s*\)/);
  });

  it("o cron pergunta pela carteira do plano", () => {
    expect(fonte).toMatch(/gastoHojeDaCarteira\(/);
    // O argumento tem de vir de algo derivado da CARTEIRA, não do plano.
    expect(fonte).toMatch(/planosDaCarteira\(|idsDaCarteira|wallet_address/);
  });
});
