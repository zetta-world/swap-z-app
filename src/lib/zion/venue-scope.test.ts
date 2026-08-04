/**
 * O ESCOPO DAS VENUES: quem MEDE e quem OPERA não olham a mesma lista.
 *
 * ⚠️ DE ONDE ISTO VEIO (04/08).
 *
 * O dono trouxe prints de um app de terceiros (Coingapp) onde a Kucoin aparecia
 * em quase toda linha de spread, e pediu que ela entrasse na MEDIÇÃO de
 * dispersão. A lacuna era real: os nossos 0.052% foram medidos numa matriz de
 * seis venues, e o app usa onze.
 *
 * Só que a matriz é COMPARTILHADA. Adicionar a Kucoin ao fetch a colocaria
 * também na matriz das mesas — caminho de dinheiro — sem ninguém ter medido o
 * que ela faz lá. Uma venue nova muda quem é a ponta barata de cada par, que é
 * precisamente a ponta onde a mesa compra.
 *
 * Mesma regra da mediana do corte de outlier, no dia anterior: mede primeiro,
 * troca depois, e a troca é decisão declarada. Estes testes fixam essa
 * separação — sem eles, a promoção acontece por descuido em vez de por decisão.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXCLUDE_VENUES } from "@/lib/zion/arbiter";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("escopo de venues", () => {
  it("a Kucoin está FORA da matriz das mesas até ser medida", () => {
    expect(EXCLUDE_VENUES).toContain("kucoin");
  });

  it("a coinbase segue fora — cota USD, e a base USD/USDT vira spread falso", () => {
    expect(EXCLUDE_VENUES).toContain("coinbase");
  });

  /**
   * As duas mesas TÊM que ler a mesma lista. O literal `"coinbase"` estava
   * copiado em três arquivos, e mudar só um teria deixado a Kucoin entrar na
   * arbiter2 pela porta dos fundos — com a arbiter1 protegida, o que é pior que
   * as duas abertas, porque parece resolvido.
   */
  it("arbiter2 IMPORTA a lista, não redefine o literal", () => {
    const fonte = ler("src/lib/zion/arbiter2.ts");
    expect(fonte).toContain('import { EXCLUDE_VENUES } from "@/lib/zion/arbiter"');
    expect(fonte).not.toMatch(/EXCLUDE_VENUES\s*=\s*\(process\.env/);
  });

  it("a rota de medição da mediana também — ela mede o que as MESAS fazem", () => {
    const fonte = ler("src/app/admin/api/arbiter-median/route.ts");
    expect(fonte).toContain("EXCLUDE_VENUES");
    expect(fonte).not.toMatch(/EXCLUDE_VENUES\s*=\s*\(process\.env/);
  });

  /**
   * E a medição de dispersão precisa do OPOSTO: ela tem que enxergar a Kucoin,
   * senão o número que vai decidir a promoção nunca existe. Por isso ela tem
   * variável própria.
   */
  it("venue-truth tem exclusão PRÓPRIA e enxerga a Kucoin", () => {
    const fonte = ler("src/app/admin/api/venue-truth/route.ts");
    expect(fonte).toContain("VENUE_TRUTH_EXCLUDE");
    // Não pode herdar a das mesas — herdar esconderia a Kucoin da medição.
    expect(fonte).not.toContain("process.env.ARB_EXCLUDE_VENUES");
    // E o padrão dela não exclui kucoin.
    expect(fonte).toMatch(/VENUE_TRUTH_EXCLUDE \?\? "coinbase"/);
  });

  it("a Kucoin É buscada — excluí-la das mesas não pode virar excluí-la da casa", () => {
    const fonte = ler("src/lib/api/cex-spot.ts");
    expect(fonte).toContain("fetchKucoin");
    expect(fonte).toContain("api.kucoin.com/api/v1/market/allTickers");
    expect(fonte).toMatch(/\|\s*"kucoin"/);
  });
});
