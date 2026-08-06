/**
 * AS TRAVAS DO RENDIMENTO INTEGRADO.
 *
 * ⚠️ CADA UMA É CICATRIZ, E ELAS SÃO AS MESMAS DE SEMPRE.
 *
 * A auditoria de 05/08 achou que as 23 mesas antigas recebiam $1.000
 * independentemente da estratégia. Esta fase existe porque o custo FIXO é o que
 * decide num rendimento de dígito único — e a única forma de provar isso é uma
 * tabela por faixa de capital, com o gás dentro.
 */

import { describe, it, expect } from "vitest";
import {
  ALVOS, TVL_MINIMO_USD, MIN_PRODUTOS,
  escolherApy, casaAlvo, custoDaFaixa, liquidoPrimeiroAnoPct, produtosDistintos,
  equilibrioDias, vereditoRendimento, type PiscinaMedida,
} from "@/lib/lab/rendimento";
import { BY_SLUG } from "@/lib/lab/registry";

describe("a lista declarada", () => {
  it("toda estratégia alvo existe no registro do laboratório", () => {
    const orfas = ALVOS.filter((a) => !BY_SLUG.has(a.slug));
    expect(orfas.map((a) => a.slug)).toEqual([]);
  });

  it("as quatro do C1-C4 estão cobertas", () => {
    const slugs = ALVOS.map((a) => a.slug);
    for (const s of ["stablecoin_lending", "tokenized_treasury", "liquid_staking", "restaking"]) {
      expect(slugs, `faltou ${s}`).toContain(s);
    }
  });

  /**
   * Ordenar por APY seleciona token de fazenda e sobrevivente ao mesmo tempo.
   * Se a lista algum dia ficar vazia, é porque alguém trocou a curadoria por
   * um ranking — e o teste tem que pegar isso, não a revisão de código.
   */
  it("todo alvo declara projeto, símbolo e cadeia — nada de curinga", () => {
    for (const a of ALVOS) {
      expect(a.projetos.length, a.slug).toBeGreaterThan(0);
      expect(a.simbolos.length, a.slug).toBeGreaterThan(0);
      expect(a.cadeias.length, a.slug).toBeGreaterThan(0);
    }
  });

  /**
   * Quem entra em empréstimo de stablecoin já tem stablecoin: o custo dele é
   * gás, não troca. Se alguém marcar `precisaTroca` nele, a conta passa a
   * cobrar um impacto que não existe e o C1 morre por engano.
   */
  it("só o empréstimo de stablecoin dispensa a troca, e ele cobra gás", () => {
    const c1 = ALVOS.find((a) => a.slug === "stablecoin_lending")!;
    expect(c1.precisaTroca).toBe(false);
    expect(c1.gasUnidadesExtras).toBeGreaterThan(0);
    for (const outro of ALVOS.filter((a) => a.slug !== "stablecoin_lending")) {
      expect(outro.precisaTroca, outro.slug).toBe(true);
    }
  });
});

describe("de onde vem o APY — a ausência não pode virar o à vista em silêncio", () => {
  it("a média de 30 dias ganha do juro base, que ganha do total", () => {
    expect(escolherApy({ apyMean30d: 4, apyBase: 9, apy: 12 }))
      .toEqual({ apyPct: 4, apyDe: "media30d" });
    expect(escolherApy({ apyBase: 9, apy: 12 }))
      .toEqual({ apyPct: 9, apyDe: "base" });
    expect(escolherApy({ apy: 12 }))
      .toEqual({ apyPct: 12, apyDe: "total" });
  });

  it("sem nenhum dos três devolve null — não vira zero", () => {
    expect(escolherApy({})).toBeNull();
    expect(escolherApy({ apyMean30d: null, apyBase: null, apy: null })).toBeNull();
  });

  /**
   * `apyReward` é pago num token de incentivo que pode cair 80% antes de você
   * vender. Se ele entrasse no titular, o C1 e o C4 apareceriam com o dobro do
   * rendimento que existe. É a mesma regra do "quando houver dúvida, o menor".
   */
  it("a recompensa NUNCA entra no número escolhido", () => {
    const r = escolherApy({ apyBase: 3, apyReward: 40 } as never);
    expect(r).toEqual({ apyPct: 3, apyDe: "base" });
  });
});

describe("casar com o alvo declarado", () => {
  const alvo = ALVOS.find((a) => a.slug === "stablecoin_lending")!;
  const boa = { project: "aave-v3", symbol: "USDC", chain: "Base", tvlUsd: TVL_MINIMO_USD };

  it("aceita a que bate em projeto, símbolo, cadeia e tamanho", () => {
    expect(casaAlvo(boa, alvo)).toBe(true);
  });

  it("recusa projeto, símbolo ou cadeia fora da lista", () => {
    expect(casaAlvo({ ...boa, project: "protocolo-qualquer" }, alvo)).toBe(false);
    expect(casaAlvo({ ...boa, symbol: "PEPE" }, alvo)).toBe(false);
    expect(casaAlvo({ ...boa, chain: "Fantom" }, alvo)).toBe(false);
  });

  /**
   * Piscina pequena tem APY de ruído: uma tomada grande move a taxa e ela volta
   * em horas. O piso é palpite declarado — mas tem que estar em vigor.
   */
  it("recusa piscina abaixo do piso de tamanho", () => {
    expect(casaAlvo({ ...boa, tvlUsd: TVL_MINIMO_USD - 1 }, alvo)).toBe(false);
  });

  it("não se importa com maiúscula no projeto nem no símbolo", () => {
    expect(casaAlvo({ ...boa, project: "AAVE-V3", symbol: "usdc" }, alvo)).toBe(true);
  });
});

describe("o custo por faixa — a variável que esta fase existe para medir", () => {
  /**
   * ⚠️ O NÚMERO QUE JUSTIFICA A FASE INTEIRA.
   *
   * O MESMO gás, em dólares, é um custo diferente conforme o capital. Se esta
   * conta estiver errada, o peixe pequeno recebe um produto que perde dinheiro
   * e o gráfico diz que está ganhando.
   */
  it("o gás encolhe em % quando o capital cresce, e a troca NÃO", () => {
    const pequeno = custoDaFaixa(500, 0.1, 12);
    const grande = custoDaFaixa(50_000, 0.1, 12);
    // Gás: $12 é 2,4% de $500 e 0,024% de $50.000 — cem vezes menor.
    expect(pequeno.gasPct).toBeCloseTo(2.4, 4);
    expect(grande.gasPct).toBeCloseTo(0.024, 4);
    // Troca: percentual, então idêntica nas duas.
    expect(pequeno.trocaPct).toBeCloseTo(grande.trocaPct, 6);
  });

  it("a ida e volta cobra as DUAS pernas da troca, como o funding", () => {
    const c = custoDaFaixa(1000, 0.25, 0);
    expect(c.trocaPct).toBeCloseTo(0.5, 6);
    expect(c.idaEVoltaPct).toBeCloseTo(0.5, 6);
  });

  it("sem gás extra o custo é só a troca — o C1 é o inverso disso", () => {
    expect(custoDaFaixa(1000, 0, 8).trocaPct).toBe(0);
    expect(custoDaFaixa(1000, 0, 8).gasPct).toBeCloseTo(0.8, 4);
  });
});

describe("o líquido do 1º ano e o equilíbrio", () => {
  it("um ano de rendimento menos UMA ida e volta", () => {
    expect(liquidoPrimeiroAnoPct(5, 2.4)).toBeCloseTo(2.6, 4);
  });

  /**
   * ⚠️ O CASO QUE DECIDE O PRODUTO PARA O PEIXE PEQUENO.
   *
   * `approve` + `supply` + `withdraw` ≈ 526 mil unidades. Na Ethereum a 20 gwei
   * com ETH a $3.000 isso dá ~$31. Sobre $500 são 6,3% — 4,5% ao ano ali não é
   * "rendimento baixo", é PREJUÍZO no primeiro ano.
   *
   * ⚠️ E A PRIMEIRA VERSÃO DESTE TESTE ESTAVA ERRADA NO MEU LADO: eu usei $20 de
   * gás, que dá 4,3% de custo contra 4,5% de rendimento, e afirmei negativo. O
   * código devolveu +0,2% e estava certo. Ficou registrado porque um teste que
   * eu ajusto até passar é decoração — o número tem que sair de uma conta que
   * dá para conferir.
   */
  it("rendimento bom com faixa pequena fecha NEGATIVO — o gás de L1 come", () => {
    const gasL1Usd = 526_000 * 20e-9 * 3000;    // ~$31,56
    const c = custoDaFaixa(500, 0, gasL1Usd);
    expect(c.gasPct).toBeGreaterThan(6);
    expect(liquidoPrimeiroAnoPct(4.5, c.idaEVoltaPct)).toBeLessThan(0);
    // E a MESMA piscina, com $50.000, fecha bem positiva.
    const grande = custoDaFaixa(50_000, 0, gasL1Usd);
    expect(liquidoPrimeiroAnoPct(4.5, grande.idaEVoltaPct)).toBeGreaterThan(4.4);
  });

  it("sem rendimento positivo NÃO existe equilíbrio — null, não um número enorme", () => {
    expect(equilibrioDias(0, 2)).toBeNull();
    expect(equilibrioDias(-1, 2)).toBeNull();
  });

  it("o equilíbrio diz quantos dias só para pagar a entrada", () => {
    // 5%/ano contra 2,5% de custo = metade do ano.
    expect(equilibrioDias(5, 2.5)).toBeCloseTo(182.5, 1);
  });
});

/**
 * Uma piscina de teste.
 *
 * ⚠️ CADA UMA COM PROJETO PRÓPRIO — senão viram UM produto e o piso reprova.
 * É exatamente a correção de 06/08: ver `produtosDistintos`.
 */
const p = (apy: number, de: PiscinaMedida["apyDe"] = "media30d"): PiscinaMedida => ({
  slug: "stablecoin_lending", poolId: `x${apy}`, projeto: `protocolo-${apy}`,
  cadeia: "Base", simbolo: "USDC", tvlUsd: 1e8,
  apyPct: apy, apyDe: de, apyRecompensaPct: null,
});

describe("o veredito", () => {

  it("nenhuma piscina é INCONCLUSIVO, nunca reprovado", () => {
    const v = vereditoRendimento([], 3, 1000);
    expect(v.readable).toBe(false);
    expect(v.status).toBe("cinza");
    expect(v.verdict).toContain("inconclusivo");
  });

  /**
   * Mesma trava do `MIN_ROBUSTOS` do funding: uma piscina é a taxa de um
   * protocolo num dia. Aprovar com n=1 é a forma do portão de lançamento que
   * aprovava com n=0.
   */
  it("abaixo do piso de produtos é INCONCLUSIVO, com o número na frente", () => {
    const v = vereditoRendimento([p(5)], 3, 1000);
    expect(v.status).toBe("cinza");
    expect(v.verdict).toContain("INCONCLUSIVO");
    expect(v.verdict).toContain(`piso de ${MIN_PRODUTOS}`);
  });

  /**
   * Rendimento bruto sem o custo NÃO é veredito — é a metade da conta que a
   * fonte já publica de graça. Se isso aprovasse, a fase inteira seria enfeite.
   */
  it("sem o custo medido não há veredito, mesmo com piscinas de sobra", () => {
    const v = vereditoRendimento([p(5), p(6), p(7)], null, 1000);
    expect(v.readable).toBe(false);
    expect(v.status).toBe("cinza");
    expect(v.verdict).toContain("custo de entrada não");
  });

  it("líquido negativo REPROVA, e diz que foi a entrada que comeu", () => {
    const v = vereditoRendimento([p(4), p(5), p(6)], -1.2, 500);
    expect(v.status).toBe("morta");
    expect(v.verdict).toContain("a entrada come tudo");
  });

  it("líquido positivo aprova, com bruto e líquido na mesma frase", () => {
    const v = vereditoRendimento([p(4), p(5), p(6)], 3.1, 1000);
    expect(v.status).toBe("verde");
    expect(v.verdict).toContain("5.00%");   // a mediana de 4,5,6
    expect(v.verdict).toContain("3.10%");
  });

  /**
   * ⚠️ A MEDIANA TEM QUE SER MEDIANA (06/08).
   *
   * A primeira versão deste arquivo tinha `s[Math.floor(n/2)]` — a MESMA linha
   * que causou a discordância de onze pontos entre duas rotas e que fez
   * `stats.ts` existir. Com `n` par ela devolve o superior do meio, e o erro
   * tem SINAL: sempre para cima, sempre a favor do número bonito.
   */
  it("com amostra PAR a mediana é a média dos dois do meio, não o de cima", () => {
    const v = vereditoRendimento([p(2), p(4), p(6), p(8)], 1, 1000);
    expect(v.verdict).toContain("5.00%");   // (4+6)/2, não 6
    expect(v.verdict).not.toContain("6.00%");
  });

  /**
   * APY à vista de piscina de empréstimo dispara com uma alavancada e volta em
   * horas. Se a média de 30 dias faltou, quem lê tem que saber ANTES de tratar
   * o número como estável.
   */
  it("APY à vista carrega a ressalva na própria frase do veredito", () => {
    const v = vereditoRendimento([p(4), p(5, "base"), p(6, "total")], 3, 1000);
    expect(v.verdict).toContain("sem média de 30 dias");
    expect(v.verdict).toContain("2 de 3");
  });

  it("com todas em média de 30 dias NÃO há ressalva pendurada", () => {
    const v = vereditoRendimento([p(4), p(5), p(6)], 3, 1000);
    expect(v.verdict).not.toContain("sem média de 30 dias");
  });
});

/**
 * ⚠️⚠️ OS QUATRO DEFEITOS DA RODADA DE 06/08.
 *
 * O dono rodou o 🏦 e o resultado trouxe, de uma vez: custo negativo, líquido
 * maior que bruto, equilíbrio de −58 dias, amostra inflada e um veredito VERDE
 * em cima de tudo isso. Cada `it` abaixo é um deles, com o número que apareceu
 * na tela.
 */
describe("custo negativo — a cotação que te PAGA para entrar e sair", () => {
  /**
   * O que apareceu: restaking com custo −0,40% em todas as cinco faixas. A
   * causa é o `priceUSD` dos dois lados da troca discordarem ~0,4% na fonte.
   */
  it("custo negativo é achatado em zero E levanta a bandeira", () => {
    const c = custoDaFaixa(2000, -0.2, 0);
    expect(c.trocaPct).toBe(0);
    expect(c.idaEVoltaPct).toBe(0);
    expect(c.precoIncoerente).toBe(true);
  });

  it("custo normal NÃO levanta bandeira nenhuma", () => {
    expect(custoDaFaixa(2000, 0.2, 5).precoIncoerente).toBe(false);
  });

  /**
   * Achatar sozinho seria pior que o defeito: o líquido subiria por causa de
   * uma FALHA DE MEDIÇÃO e a tela mostraria o número bonito. Tem que reprovar.
   */
  it("preço incoerente derruba o veredito para INCONCLUSIVO, não VERDE", () => {
    const ps = [p(4), p(5), p(6)];
    expect(vereditoRendimento(ps, 3.1, 1000).status).toBe("verde");
    const v = vereditoRendimento(ps, 3.1, 1000, { precoIncoerente: true });
    expect(v.status).toBe("cinza");
    expect(v.readable).toBe(false);
    expect(v.verdict).toContain("NEGATIVO");
    expect(v.verdict).toContain("inflado");
  });

  it("o líquido NUNCA passa do bruto, nem chamado direto", () => {
    expect(liquidoPrimeiroAnoPct(2.49, -0.4)).toBe(2.49);
  });

  /** "Equilíbrio −58 dias" é frase sem significado que passa por ter unidade. */
  it("custo negativo não tem ponto de equilíbrio — null, não −58", () => {
    expect(equilibrioDias(2.49, -0.4034)).toBeNull();
  });
});

describe("gás não lido não pode parecer gás barato", () => {
  /**
   * `gasDaCotacao` devolve null quando `gasCosts` vem vazio, e o `gasUsd`
   * virava zero em silêncio. O custo então mal se mexia entre $500 e $50.000 —
   * que se lê como "o gás deixou de ser barreira", a hipótese central da fase.
   * As duas leituras davam a MESMA tela.
   */
  it("sem gás lido o veredito é INCONCLUSIVO e diz por quê", () => {
    const v = vereditoRendimento([p(4), p(5), p(6)], 3.1, 1000, { gasLido: false });
    expect(v.status).toBe("cinza");
    expect(v.verdict).toContain("não trouxe");
    expect(v.verdict).toContain("SEM gás");
  });

  it("com gás lido segue o veredito normal", () => {
    expect(vereditoRendimento([p(4), p(5), p(6)], 3.1, 1000, { gasLido: true }).status)
      .toBe("verde");
  });

  /** Sem informação sobre gás (nenhuma cotação) não é o mesmo que "não veio". */
  it("ausência de informação não reprova sozinha", () => {
    expect(vereditoRendimento([p(4), p(5), p(6)], 3.1, 1000, {}).status).toBe("verde");
  });
});

describe("o mesmo produto em N cadeias não é N observações", () => {
  const buidl = (cadeia: string, tvl: number): PiscinaMedida => ({
    slug: "tokenized_treasury", poolId: `b-${cadeia}`, projeto: "blackrock-buidl",
    cadeia, simbolo: "BUIDL", tvlUsd: tvl, apyPct: 3.51, apyDe: "media30d",
    apyRecompensaPct: null,
  });

  /**
   * O que apareceu: "12 piscinas" no Tesouro tokenizado, das quais SEIS eram
   * BUIDL em seis cadeias com o mesmo 3,5%.
   */
  it("BUIDL em seis cadeias é UM produto, e fica a de maior depósito", () => {
    const seis = [
      buidl("Ethereum", 964e6), buidl("Polygon", 13e6), buidl("Solana", 685e6),
      buidl("Avalanche", 631e6), buidl("Arbitrum", 24e6), buidl("Ethereum", 224e6),
    ];
    const d = produtosDistintos(seis);
    expect(d).toHaveLength(1);
    expect(d[0].tvlUsd).toBe(964e6);
  });

  it("emissores diferentes continuam sendo produtos diferentes", () => {
    expect(produtosDistintos([p(4), p(5), p(6)])).toHaveLength(3);
  });

  /**
   * O caso real do restaking: 3 piscinas, das quais duas eram o MESMO
   * `ether.fi-stake` em duas cadeias. Duas taxas passando por um piso de três.
   */
  it("o piso conta PRODUTOS, então 3 implantações de 2 emissores reprovam", () => {
    const etherfi = (c: string, tvl: number): PiscinaMedida => ({
      slug: "restaking", poolId: `e-${c}`, projeto: "ether.fi-stake", cadeia: c,
      simbolo: "WEETH", tvlUsd: tvl, apyPct: 2.49, apyDe: "media30d", apyRecompensaPct: null,
    });
    const renzo: PiscinaMedida = {
      slug: "restaking", poolId: "r", projeto: "renzo", cadeia: "Ethereum",
      simbolo: "EZETH", tvlUsd: 88e6, apyPct: 2.13, apyDe: "media30d", apyRecompensaPct: null,
    };
    const tres = [etherfi("Ethereum", 3628e6), etherfi("Base", 34e6), renzo];

    expect(tres).toHaveLength(3);
    expect(produtosDistintos(tres)).toHaveLength(2);

    const v = vereditoRendimento(tres, 2.89, 2000);
    expect(v.status).toBe("cinza");
    expect(v.verdict).toContain("INCONCLUSIVO");
    // E a tela mostra as duas contagens, para ninguém achar que sumiu dado.
    expect(v.verdict).toContain("3 implantações");
  });

  /**
   * Com BUIDL repetido seis vezes, a mediana de "12 piscinas" é a taxa da
   * BlackRock com seis votos. A mediana tem que correr sobre produtos.
   */
  it("a mediana não deixa um emissor votar seis vezes", () => {
    const seis = Array.from({ length: 6 }, (_, i) => buidl(`C${i}`, 1e8 - i));
    // Seis cópias de 3,51% mais dois emissores em 10% — a mediana de produtos
    // é 10%, não 3,51%, porque são três produtos e não oito piscinas.
    const v = vereditoRendimento([...seis, p(10), p(10.5)], 3, 1000);
    expect(v.verdict).toContain("10.00%");
    expect(v.verdict).not.toContain("3.51%");
  });
});
