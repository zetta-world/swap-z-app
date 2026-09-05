import { describe, it, expect } from "vitest";
import {
  duracaoDoIntervaloMs, velaFechada, ultimaVelaFechada,
  oQueFaltaBuscar, estenderCobertura, fatiar, ultimas, custoDaRodada,
  type Cobertura,
} from "./velas";

const DIA = 86_400_000;
/** 2026-09-05T12:00:00Z — meio de um dia, para a vela corrente estar ABERTA. */
const AGORA = Date.UTC(2026, 8, 5, 12, 0, 0);
/** O início do dia de hoje: a vela que está ABERTA agora. */
const HOJE = Date.UTC(2026, 8, 5);
const ONTEM = HOJE - DIA;

describe("duração e fronteira de fechamento", () => {
  it("os intervalos conhecidos têm duração", () => {
    expect(duracaoDoIntervaloMs("1d")).toBe(DIA);
    expect(duracaoDoIntervaloMs("1h")).toBe(3_600_000);
  });

  /**
   * ⚠️ Intervalo desconhecido devolve `null`, nunca `undefined` virando NaN —
   * com NaN, `t + d <= agora` é sempre falso e NENHUMA vela fecharia.
   */
  it("intervalo que não existe devolve null, não NaN", () => {
    expect(duracaoDoIntervaloMs("3d")).toBeNull();
    expect(duracaoDoIntervaloMs("")).toBeNull();
    expect(velaFechada(ONTEM, "3d", AGORA)).toBe(false);
    expect(ultimaVelaFechada("3d", AGORA)).toBeNull();
  });

  /**
   * ⚠️⚠️ A INVARIANTE QUE SUSTENTA O CACHE. A vela de hoje muda a cada negócio:
   * gravá-la serviria o preço do meio-dia para sempre.
   */
  it("⚠️ a vela de HOJE não fechou — ela não pode ser gravada", () => {
    expect(velaFechada(HOJE, "1d", AGORA)).toBe(false);
  });

  it("a de ontem fechou", () => {
    expect(velaFechada(ONTEM, "1d", AGORA)).toBe(true);
  });

  it("⚠️ a fronteira é exata: fecha no instante em que o período acaba", () => {
    const t = AGORA - DIA;
    expect(velaFechada(t, "1d", t + DIA - 1)).toBe(false);
    expect(velaFechada(t, "1d", t + DIA)).toBe(true);
  });

  it("a última fechada é a de ontem, não a de hoje", () => {
    expect(ultimaVelaFechada("1d", AGORA)).toBe(ONTEM);
  });
});

describe("oQueFaltaBuscar — sem cobertura, busca a janela inteira", () => {
  it("primeira vez: pede tudo", () => {
    const f = oQueFaltaBuscar(null, ONTEM - 10 * DIA, ONTEM, "1d", AGORA);
    expect(f).toEqual([{ de: ONTEM - 10 * DIA, ate: ONTEM }]);
  });

  /**
   * ⚠️ O TETO É A ÚLTIMA VELA FECHADA. Pedir até hoje traria a vela corrente,
   * que não pode ser gravada.
   */
  it("⚠️ o pedido é aparado na última vela FECHADA", () => {
    const f = oQueFaltaBuscar(null, ONTEM - 3 * DIA, HOJE + 5 * DIA, "1d", AGORA);
    expect(f).toEqual([{ de: ONTEM - 3 * DIA, ate: ONTEM }]);
  });

  it("janela inteiramente no futuro não pede nada", () => {
    expect(oQueFaltaBuscar(null, HOJE + DIA, HOJE + 5 * DIA, "1d", AGORA)).toEqual([]);
  });

  it("intervalo desconhecido não pede nada", () => {
    expect(oQueFaltaBuscar(null, ONTEM - DIA, ONTEM, "3d", AGORA)).toEqual([]);
  });
});

describe("oQueFaltaBuscar — com cobertura, pede só o buraco", () => {
  const cob = (de: number, ate: number, esgotou = false): Cobertura =>
    ({ cobertoDe: de, cobertoAte: ate, fonteEsgotou: esgotou });

  it("⚠️ janela DENTRO do já coberto não gera busca nenhuma", () => {
    const c = cob(ONTEM - 100 * DIA, ONTEM);
    expect(oQueFaltaBuscar(c, ONTEM - 50 * DIA, ONTEM - 10 * DIA, "1d", AGORA)).toEqual([]);
  });

  it("só o pedaço mais novo", () => {
    const c = cob(ONTEM - 100 * DIA, ONTEM - 10 * DIA);
    const f = oQueFaltaBuscar(c, ONTEM - 50 * DIA, ONTEM, "1d", AGORA);
    expect(f).toEqual([{ de: ONTEM - 10 * DIA + 1, ate: ONTEM }]);
  });

  it("só o pedaço mais antigo", () => {
    const c = cob(ONTEM - 50 * DIA, ONTEM);
    const f = oQueFaltaBuscar(c, ONTEM - 100 * DIA, ONTEM, "1d", AGORA);
    expect(f).toEqual([{ de: ONTEM - 100 * DIA, ate: ONTEM - 50 * DIA - 1 }]);
  });

  it("os dois pedaços, quando a cobertura está no meio", () => {
    const c = cob(ONTEM - 50 * DIA, ONTEM - 10 * DIA);
    const f = oQueFaltaBuscar(c, ONTEM - 100 * DIA, ONTEM, "1d", AGORA);
    expect(f).toHaveLength(2);
    expect(f[0]).toEqual({ de: ONTEM - 100 * DIA, ate: ONTEM - 50 * DIA - 1 });
    expect(f[1]).toEqual({ de: ONTEM - 10 * DIA + 1, ate: ONTEM });
  });

  /**
   * ⚠️⚠️ O CUSTO QUE ESTA MARCA ELIMINA. Um par listado há seis meses não tem
   * vela de dois anos atrás. Sem `fonteEsgotou`, TODO backtest pediria dois
   * anos, receberia seis meses, e tentaria de novo. Para sempre.
   */
  it("⚠️ fonte esgotada: o lado antigo NUNCA mais é buscado", () => {
    const c = cob(ONTEM - 180 * DIA, ONTEM, true);
    const f = oQueFaltaBuscar(c, ONTEM - 730 * DIA, ONTEM, "1d", AGORA);
    expect(f).toEqual([]);
  });

  it("⚠️ mas o lado NOVO continua abrindo — o tempo sempre avança", () => {
    const c = cob(ONTEM - 180 * DIA, ONTEM - 3 * DIA, true);
    const f = oQueFaltaBuscar(c, ONTEM - 730 * DIA, ONTEM, "1d", AGORA);
    expect(f).toEqual([{ de: ONTEM - 3 * DIA + 1, ate: ONTEM }]);
  });
});

describe("estenderCobertura — a falha parcial não vira buraco permanente", () => {
  /**
   * ⚠️⚠️ `fetchTimedCandles` faz `break` no primeiro erro e devolve o que já
   * juntou — parcial indistinguível de completo. Estender a cobertura até o
   * `ate` PEDIDO marcaria como coberta uma faixa que nunca chegou, e as velas
   * que faltaram nunca mais seriam buscadas.
   */
  it("⚠️ a cobertura anda até o que VEIO, não até o que foi pedido", () => {
    // Pedi 100 dias; a fonte entregou 10 e morreu.
    const vindas = Array.from({ length: 10 }, (_, i) => ({ t: ONTEM - i * DIA }));
    const c = estenderCobertura(null, vindas);
    expect(c!.cobertoDe).toBe(ONTEM - 9 * DIA);   // não ONTEM − 99×DIA
    expect(c!.cobertoAte).toBe(ONTEM);
  });

  it("nada veio: a cobertura antiga não anda", () => {
    const antes: Cobertura = { cobertoDe: 100, cobertoAte: 200, fonteEsgotou: false };
    expect(estenderCobertura(antes, [])).toEqual(antes);
  });

  it("nada veio e não havia cobertura: continua sem cobertura", () => {
    expect(estenderCobertura(null, [])).toBeNull();
  });

  it("estende as duas pontas quando o novo material é mais amplo", () => {
    const antes: Cobertura = { cobertoDe: 500, cobertoAte: 600, fonteEsgotou: false };
    const c = estenderCobertura(antes, [{ t: 300 }, { t: 900 }]);
    expect(c).toEqual({ cobertoDe: 300, cobertoAte: 900, fonteEsgotou: false });
  });

  /**
   * ⚠️ "A fonte acabou" e "a busca falhou" são estados diferentes. Confundi-los
   * congelaria o histórico no ponto do erro — para sempre.
   */
  it("⚠️ fonteEsgotou só é marcado quando passado, e nunca se desmarca", () => {
    const c1 = estenderCobertura(null, [{ t: 100 }], true);
    expect(c1!.fonteEsgotou).toBe(true);
    // Uma busca posterior sem esgotamento NÃO apaga a marca.
    const c2 = estenderCobertura(c1, [{ t: 200 }], false);
    expect(c2!.fonteEsgotou).toBe(true);
  });

  it("⚠️ e a marca sobrevive a uma rodada que não trouxe nada", () => {
    const antes: Cobertura = { cobertoDe: 100, cobertoAte: 200, fonteEsgotou: false };
    expect(estenderCobertura(antes, [], true)!.fonteEsgotou).toBe(true);
  });

  it("tempo inválido é descartado, não polui a faixa", () => {
    const c = estenderCobertura(null, [{ t: NaN }, { t: 500 }, { t: Infinity }]);
    expect(c).toEqual({ cobertoDe: 500, cobertoAte: 500, fonteEsgotou: false });
  });
});

describe("fatiar — a fatia canônica, e é ela que faz o cache valer", () => {
  const serie = Array.from({ length: 10 }, (_, i) => ({ t: i * DIA, close: i }));

  /**
   * ⚠️⚠️ Dois clientes com janelas diferentes leem o MESMO material e cortam
   * aqui. Se a busca acompanhasse o `limit` de cada um, cada janela viraria uma
   * chave de cache diferente — que é o defeito do cache de hoje.
   */
  it("⚠️ janelas diferentes saem da MESMA série, sem buscar de novo", () => {
    expect(fatiar(serie, 0, 2 * DIA).map((v) => v.close)).toEqual([0, 1, 2]);
    expect(fatiar(serie, 5 * DIA, 9 * DIA).map((v) => v.close)).toEqual([5, 6, 7, 8, 9]);
  });

  it("devolve em ordem cronológica mesmo com entrada bagunçada", () => {
    const fora = [{ t: 3 }, { t: 1 }, { t: 2 }];
    expect(fatiar(fora, 0, 10).map((v) => v.t)).toEqual([1, 2, 3]);
  });

  it("janela sem vela devolve vazio — e vazio aqui é ausência medida", () => {
    expect(fatiar(serie, 100 * DIA, 200 * DIA)).toEqual([]);
  });

  it("tempo inválido não entra na fatia", () => {
    expect(fatiar([{ t: NaN }, { t: 5 }], 0, 10)).toEqual([{ t: 5 }]);
  });
});

describe("ultimas — devolve o que tem, sem inventar", () => {
  const serie = Array.from({ length: 10 }, (_, i) => ({ t: i * DIA, close: i }));

  it("as N mais recentes até o limite", () => {
    expect(ultimas(serie, 3, 9 * DIA).map((v) => v.close)).toEqual([7, 8, 9]);
    expect(ultimas(serie, 3, 5 * DIA).map((v) => v.close)).toEqual([3, 4, 5]);
  });

  /**
   * ⚠️ Pedir mais do que existe devolve o que existe. Completar com vela
   * repetida criaria histórico que não aconteceu; devolver vazio esconderia
   * uma medição possível.
   */
  it("⚠️ pedir 50 tendo 10 devolve 10 — não inventa nem zera", () => {
    expect(ultimas(serie, 50, 9 * DIA)).toHaveLength(10);
  });

  it("n inválido devolve vazio", () => {
    for (const mau of [0, -3, NaN, Infinity]) {
      expect(ultimas(serie, mau, 9 * DIA)).toEqual([]);
    }
  });
});

describe("custoDaRodada — a régua da cota é TRABALHO, não contagem", () => {
  /**
   * ⚠️ "Dez testes por dia" sozinho deixa um free pedir 3 símbolos × 1 ano dez
   * vezes e consumir mais que um trader disciplinado.
   */
  it("símbolos × velas", () => {
    expect(custoDaRodada(3, 365)).toBe(1095);
    expect(custoDaRodada(1, 730)).toBe(730);
  });

  it("⚠️ três símbolos de um ano custam mais que um de dois anos", () => {
    expect(custoDaRodada(3, 365)).toBeGreaterThan(custoDaRodada(1, 730));
  });

  it("entrada inválida ou negativa é zero, nunca NaN", () => {
    expect(custoDaRodada(NaN, 100)).toBe(0);
    expect(custoDaRodada(-5, 100)).toBe(0);
    expect(custoDaRodada(3, -1)).toBe(0);
  });
});
