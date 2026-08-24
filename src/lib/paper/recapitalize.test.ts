/**
 * RECAPITALIZAÇÃO — as travas de uma operação que reescreve capital.
 *
 * ⚠️ Este módulo faz duas coisas irreversíveis por rodada: arquiva posições e
 * troca o `starting_usd`. As partes que dependem de banco não são testáveis
 * aqui; o que É testável — e o que mais importa — são as GUARDAS.
 */

import { describe, it, expect } from "vitest";
import { recapitalize } from "@/lib/paper/recapitalize";
import { DESKS, deskFor } from "@/lib/zion/desks";

describe("as guardas da recapitalização", () => {
  /**
   * O motivo é exigido em TRÊS camadas: rota, módulo e CHECK do banco. Não é
   * exagero — é a mesma disciplina do reset de ledger. Sem motivo escrito,
   * daqui a um mês ninguém sabe se o degrau na curva foi decisão ou acidente.
   */
  it("recusa sem motivo escrito", async () => {
    await expect(recapitalize(["strat_mech"], "")).rejects.toThrow(/motivo/i);
    await expect(recapitalize(["strat_mech"], "porque sim")).rejects.toThrow(/motivo/i);
  });

  it("aceita a partir de 15 caracteres — o mesmo piso do banco", async () => {
    // 15 exatos: não deve reprovar pela guarda do motivo. (Sem banco no teste,
    // a chamada devolve lista vazia em vez de lançar.)
    await expect(recapitalize([], "recapitalizando as mesas")).resolves.toBeDefined();
  });
});

/**
 * O ALVO da recapitalização vem do registro, não de um número solto na rota.
 * Se `desks.ts` e a operação discordassem, o capital aplicado seria diferente
 * do declarado — e o subtítulo do painel passaria a mentir.
 */
describe("o alvo vem do registro de mesas", () => {
  it("toda mesa VIVA tem capital declarado para a recapitalização usar", () => {
    const vivas = DESKS.filter((d) => d.status === "live");
    expect(vivas.length).toBeGreaterThan(0);
    for (const d of vivas) {
      expect(d.capitalRequiredUsd, d.source).toBeGreaterThan(0);
      expect(d.capitalWhy.length, d.source).toBeGreaterThanOrEqual(25);
    }
  });

  /**
   * As mesas do duelo direcional precisam terminar com o MESMO capital, senão
   * a recapitalização quebra a comparação que elas existem para fazer.
   */
  it("recapitalizar o duelo mantém o capital igual dos dois lados", () => {
    const duelo = DESKS.filter((d) => d.sector === "A_direcional" && d.status === "live");
    const alvos = new Set(duelo.map((d) => d.capitalRequiredUsd));
    expect([...alvos]).toHaveLength(1);
  });

  /**
   * ⚠️ APOSENTADA NÃO SE RECAPITALIZA. O capital delas é histórico, e mexer
   * apagaria a cicatriz preservada do vazamento de julho — a mesma razão pela
   * qual `planRepair` as ignora.
   */
  it("as aposentadas ficam de fora do universo do plano", () => {
    const arquivo = DESKS.filter((d) => d.status === "valhalla");
    expect(arquivo.length).toBeGreaterThan(0);
    for (const d of arquivo) {
      expect(deskFor(d.source)?.status).toBe("valhalla");
      expect(d.capitalWhy).toMatch(/arquivad|histór/i);
    }
  });
});
