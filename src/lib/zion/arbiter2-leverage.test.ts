import { describe, it, expect } from "vitest";
import {
  liquidationDistancePct, liquidationHit, liquidationLossUsd,
  ARBITER2_PROFILES, MAINTENANCE_PCT,
} from "@/lib/zion/arbiter2";

/**
 * OS GÊMEOS ALAVANCADOS — e o risco que a alavancagem CRIA, não amplia.
 *
 * A posição do JÖRMUNGANDR é delta-neutra: o que o spot ganha, o perp perde, e
 * vice-versa. SEM alavancagem isso é seguro por construção — um lado sempre
 * cobre o outro, e não existe preço que quebre a estrutura.
 *
 * COM alavancagem deixa de ser verdade, e essa é a coisa toda: se o preço
 * dispara, a perna VENDIDA no perp é liquidada ANTES de o ganho do spot ser
 * realizado. A margem vira zero, a proteção some, e sobra uma compra de spot
 * desprotegida que ninguém pediu.
 *
 * Um backtest de arbitragem alavancada que não modela liquidação produz uma
 * curva linda e mente com convicção: o lucro aparece e o evento que apagaria a
 * conta simplesmente não é contado. Estes testes existem para que ele seja.
 */

describe("a distância até a liquidação", () => {
  it("SEM alavancagem não existe liquidação — é outra coisa, não uma versão menor", () => {
    // É por isso que o gêmeo original continua sendo o controle: ele não tem
    // este risco em grau nenhum.
    expect(liquidationDistancePct(1)).toBe(Infinity);
    expect(liquidationHit(500, 1)).toBe(false);
  });

  it("3× liquida perto de +33% contra o short", () => {
    expect(liquidationDistancePct(3)).toBeCloseTo(100 / 3 - MAINTENANCE_PCT, 6);
    expect(liquidationHit(34, 3)).toBe(true);
    expect(liquidationHit(30, 3)).toBe(false);
  });

  it("5× liquida perto de +20% — e 20% num movimento ACONTECE em cripto", () => {
    expect(liquidationDistancePct(5)).toBeCloseTo(20 - MAINTENANCE_PCT, 6);
    expect(liquidationHit(20, 5)).toBe(true);
    expect(liquidationHit(18, 5)).toBe(false);
  });

  it("o gatilho vem ANTES do ponto teórico — ninguém é liquidado no 1/L exato", () => {
    expect(liquidationDistancePct(5)).toBeLessThan(20);
    expect(MAINTENANCE_PCT).toBeGreaterThan(0);
  });

  it("mais alavancagem = menos espaço, sempre", () => {
    expect(liquidationDistancePct(5)).toBeLessThan(liquidationDistancePct(3));
  });

  it("movimento a FAVOR do short nunca liquida", () => {
    expect(liquidationHit(-30, 5)).toBe(false);
  });
});

describe("o que se perde na liquidação", () => {
  it("a margem INTEIRA da perna de perp", () => {
    expect(liquidationLossUsd(50, 5)).toBeCloseTo(-10, 6);
    expect(liquidationLossUsd(50, 3)).toBeCloseTo(-50 / 3, 6);
  });

  it("é sempre perda, nunca ganho", () => {
    for (const l of [1, 3, 5, 10]) expect(liquidationLossUsd(50, l)).toBeLessThan(0);
  });

  it("alavanca maior perde MENOS por evento — e é justamente o que engana", () => {
    // A perda unitária é menor porque a margem é menor. Mas com margem menor a
    // mesa abre MAIS ciclos com o mesmo capital, então o número de eventos
    // sobe. Olhar só a perda por evento faz o 5× parecer mais seguro que o 3×,
    // quando é o contrário.
    expect(Math.abs(liquidationLossUsd(50, 5))).toBeLessThan(Math.abs(liquidationLossUsd(50, 3)));
  });
});

describe("os três perfis", () => {
  it("o original permanece SEM alavanca — é o controle da comparação", () => {
    const orig = ARBITER2_PROFILES.find((p) => p.source === "arbiter2")!;
    expect(orig.leverage).toBe(1);
  });

  it("os gêmeos são 3× e 5×, cada um com os $300 pedidos", () => {
    const tres = ARBITER2_PROFILES.find((p) => p.source === "arbiter2_3x")!;
    const cinco = ARBITER2_PROFILES.find((p) => p.source === "arbiter2_5x")!;
    expect(tres.leverage).toBe(3);
    expect(cinco.leverage).toBe(5);
    expect(tres.startingUsd).toBe(300);
    expect(cinco.startingUsd).toBe(300);
  });

  it("capital IGUAL nos três — senão a comparação mede o tamanho, não a alavanca", () => {
    const capitais = new Set(ARBITER2_PROFILES.map((p) => p.startingUsd));
    expect(capitais.size).toBe(1);
  });

  it("cada perfil tem `source` próprio — ledgers separados", () => {
    expect(new Set(ARBITER2_PROFILES.map((p) => p.source)).size).toBe(ARBITER2_PROFILES.length);
  });
});

describe("a margem por ciclo — de onde vem a eficiência", () => {
  // spot inteiro + perp/L. Não dá para alavancar a perna de spot aqui.
  const margem = (size: number, l: number) => size + size / l;

  it("sem alavanca, é o 2×SIZE de sempre", () => {
    expect(margem(50, 1)).toBe(100);
  });

  it("3× libera capital, mas menos que 3× — o spot continua inteiro", () => {
    // Erro fácil: achar que 3× de alavanca triplica os ciclos. Só a perna de
    // perp é alavancada, então a margem cai de 100 para ~67, não para 33.
    expect(margem(50, 3)).toBeCloseTo(66.67, 1);
    expect(margem(50, 3)).toBeGreaterThan(margem(50, 1) / 3);
  });

  it("5× libera um pouco mais, com retorno decrescente", () => {
    // De 3× para 5× a margem cai só ~7 dólares, enquanto a distância até a
    // liquidação encolhe de 33% para 20%. É esta a troca que o experimento vai
    // medir — e ela não é linear.
    const ganho3 = margem(50, 1) - margem(50, 3);
    const ganho5 = margem(50, 3) - margem(50, 5);
    expect(ganho5).toBeLessThan(ganho3);
  });
});
