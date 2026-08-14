/**
 * MOTOR DE TENDÊNCIA — as convenções que decidem o resultado.
 *
 * Um seguidor de tendência é fácil de escrever e fácil de escrever ERRADO de um
 * jeito que só produz números bonitos: entrar no fechamento que gerou o sinal,
 * supor que o alvo veio antes do stop, esquecer o pedágio de uma das pernas,
 * deixar o peso explodir num ativo calmo. Cada teste abaixo tranca uma dessas.
 */

import { describe, it, expect } from "vitest";
import {
  rodarTendencia, escolherRisco, PARAMS_PADRAO, TETO_PESO_PCT, TETO_EXPOSICAO_PCT,
  RISCOS_CANDIDATOS, montarSerie, EMA_LONGA, ATR_PERIODO,
  type DiaMercado, type ParamsTendencia, type VelaBruta,
} from "@/lib/lab/tendencia";
import { rodarWalkForward, vereditoWalkForward, MIN_DOBRAS } from "@/lib/lab/walk-forward";

/** Um dia com um símbolo só, tudo explícito — nada de indicador implícito. */
function dia(
  d: string,
  p: { fecha: number; alta?: number; baixa?: number; emaCurta?: number | null; emaLonga?: number | null; atr?: number | null },
  simbolo = "BTC",
): DiaMercado {
  return {
    dia: d,
    porSimbolo: new Map([[simbolo, {
      alta: p.alta ?? p.fecha, baixa: p.baixa ?? p.fecha, fecha: p.fecha,
      emaCurta: p.emaCurta === undefined ? p.fecha - 1 : p.emaCurta,
      emaLonga: p.emaLonga === undefined ? p.fecha - 2 : p.emaLonga,
      atr: p.atr === undefined ? 1 : p.atr,
    }]]),
  };
}

/** Sinal ligado (EMA50 > EMA200 e preço acima da curta) em todos os dias. */
const alta = (d: string, fecha: number, extra: Parameters<typeof dia>[1] = { fecha }) =>
  dia(d, { ...extra, fecha });

const semCusto: ParamsTendencia = { ...PARAMS_PADRAO, custoPct: 0 };

describe("o sinal de hoje entra AMANHÃ", () => {
  /**
   * ⚠️ Entrar no mesmo fechamento que gerou o sinal é o lookahead clássico — é
   * o que faz qualquer seguidor de tendência parecer genial. A mesma regra que
   * `rodarRotacao` já segue.
   */
  it("o primeiro dia nunca produz posição", () => {
    const r = rodarTendencia([alta("d1", 100)], semCusto);
    expect(r.trades).toHaveLength(0);
    expect(r.retornoPct).toBe(0);
  });

  it("entra no fechamento do dia SEGUINTE ao sinal", () => {
    const r = rodarTendencia([alta("d1", 100), alta("d2", 110), alta("d3", 120)], semCusto);
    expect(r.trades[0].diaEntrada).toBe("d2");
    expect(r.trades[0].precoEntrada).toBe(110);   // não 100
  });
});

describe("o stop vem antes do cruzamento", () => {
  /**
   * ⚠️ A VELA DIÁRIA NÃO MOSTRA A ORDEM. Se a mínima furou o stop E as médias
   * cruzaram no mesmo dia, supor que a saída boa veio primeiro é escolher o
   * resultado. Pessimismo primeiro, como no resto do laboratório.
   */
  it("mínima furando o stop registra STOP mesmo com cruzamento no mesmo dia", () => {
    const dias = [
      alta("d1", 100, { fecha: 100, atr: 1 }),                       // sinal ligado
      // Entra a 100 (stop 98) E cruza para baixo — então não há entrada nova em
      // d3, e a saída por cruzamento disputa com o stop no MESMO dia.
      dia("d2", { fecha: 100, emaCurta: 1, emaLonga: 9, atr: 1 }),
      dia("d3", { fecha: 99, baixa: 90, emaCurta: 1, emaLonga: 9 }), // furou E cruzou
    ];
    const r = rodarTendencia(dias, semCusto);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].motivo).toBe("stop");
    expect(r.trades[0].precoSaida).toBeCloseTo(98, 6);   // preço do stop, não a mínima
  });

  it("sem furar o stop, o cruzamento fecha no fechamento do dia seguinte", () => {
    const dias = [
      alta("d1", 100), alta("d2", 100),
      dia("d3", { fecha: 105, emaCurta: 1, emaLonga: 9 }),  // cruzou para baixo
      dia("d4", { fecha: 106, emaCurta: 1, emaLonga: 9 }),
    ];
    const r = rodarTendencia(dias, semCusto);
    expect(r.trades[0].motivo).toBe("cruzamento");
    expect(r.trades[0].precoSaida).toBe(106);
  });
});

describe("o pedágio", () => {
  /** ⚠️ DUAS PERNAS. Cobrar só a entrada subestima o custo pela metade — e o
   *  custo é a variável que este motor existe para testar. */
  it("cobra entrada E saída", () => {
    const dias = [alta("d1", 100), alta("d2", 100), alta("d3", 100)];
    const r = rodarTendencia(dias, { ...PARAMS_PADRAO, custoPct: 0.2 });
    const t = r.trades[0];
    expect(t.custoPct).toBeCloseTo(t.pesoPct * 0.002 * 2, 9);
  });

  it("preço parado com pedágio dá resultado NEGATIVO", () => {
    const dias = [alta("d1", 100), alta("d2", 100), alta("d3", 100)];
    expect(rodarTendencia(dias, { ...PARAMS_PADRAO, custoPct: 0.2 }).retornoPct).toBeLessThan(0);
  });

  it("bruto e líquido viajam juntos — nunca só o bruto", () => {
    const dias = [alta("d1", 100), alta("d2", 100), alta("d3", 120)];
    const r = rodarTendencia(dias, { ...PARAMS_PADRAO, custoPct: 0.2 });
    expect(r.brutoPct).toBeGreaterThan(r.retornoPct);
    expect(r.custoPct).toBeGreaterThan(0);
  });
});

describe("os tetos — a alavancagem que aparece sozinha", () => {
  /**
   * ⚠️ O peso sai de `risco ÷ distância do stop`. Num ativo calmo a distância
   * encolhe e o peso EXPLODE: risco 0,5% com stop a 0,1% pede 500% do
   * patrimônio. A conta está certa; o resultado é ficção.
   */
  it("ATR minúsculo NÃO produz posição alavancada", () => {
    // ⚠️ O ATR do stop vem de ONTEM (o dia do SINAL), não do dia da entrada.
    // A primeira versão deste teste punha o valor minúsculo em `d2` e o teto
    // nunca era exercido — passava com o teto REMOVIDO. Ver o comentário do
    // bloco abaixo sobre assertiva vazia.
    const dias = [
      alta("d1", 100, { fecha: 100, atr: 0.001 }), alta("d2", 100), alta("d3", 101),
    ];
    const r = rodarTendencia(dias, semCusto);
    expect(r.trades.length).toBeGreaterThan(0);
    // Sem teto o peso pediria 2.500% do patrimônio. Igual ao teto, não só menor.
    expect(r.trades[0].pesoPct).toBeCloseTo(TETO_PESO_PCT, 6);
  });

  it("a exposição somada nunca passa do teto", () => {
    const simbolos = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const mk = (d: string): DiaMercado => ({
      dia: d,
      porSimbolo: new Map(simbolos.map((s) => [s, {
        alta: 100, baixa: 100, fecha: 100, emaCurta: 99, emaLonga: 98, atr: 0.01,
      }])),
    });
    const r = rodarTendencia([mk("d1"), mk("d2"), mk("d3")], semCusto);
    /**
     * ⚠️ ESTA LINHA NÃO É DECORAÇÃO. Sem ela, o teste passa com ZERO trades —
     * e foi exatamente o que aconteceu ao remover o teto de peso por mutação:
     * o peso pedido virou 2.500%, TODA entrada foi recusada por exposição, a
     * lista ficou vazia, e `soma = 0 <= 100` aprovou. Assertiva sobre coleção
     * vazia é sempre verdadeira; é a mesma família da nº 27 (teste verde que
     * não observou nada).
     */
    expect(r.trades.length).toBeGreaterThan(0);
    const soma = r.trades.reduce((s, t) => s + t.pesoPct, 0);
    expect(soma).toBeLessThanOrEqual(TETO_EXPOSICAO_PCT);
  });

  /** ⚠️ Sinal além do teto é IGNORADO, não encolhido: encolher mudaria a
   *  estratégia em silêncio num dia de muitos sinais. */
  it("ignora o sinal excedente em vez de redimensionar todo mundo", () => {
    const simbolos = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const mk = (d: string): DiaMercado => ({
      dia: d,
      porSimbolo: new Map(simbolos.map((s) => [s, {
        alta: 100, baixa: 100, fecha: 100, emaCurta: 99, emaLonga: 98, atr: 0.01,
      }])),
    });
    const r = rodarTendencia([mk("d1"), mk("d2"), mk("d3")], semCusto);
    // Todos os que entraram entraram no teto CHEIO de peso, nenhum encolhido.
    expect(r.trades.length).toBeGreaterThan(0);   // ver o aviso do teste acima
    for (const t of r.trades) expect(t.pesoPct).toBeCloseTo(TETO_PESO_PCT, 6);
    expect(r.trades.length).toBeLessThan(simbolos.length);
  });
});

describe("não opera o que não dá para medir", () => {
  it("indicador ainda aquecendo (null) não gera entrada", () => {
    const dias = [
      dia("d1", { fecha: 100, emaCurta: null, emaLonga: null, atr: null }),
      dia("d2", { fecha: 110, emaCurta: null, emaLonga: null, atr: null }),
    ];
    expect(rodarTendencia(dias, semCusto).trades).toHaveLength(0);
  });

  it("sinal desligado (EMA curta abaixo da longa) não entra", () => {
    const dias = [
      dia("d1", { fecha: 100, emaCurta: 90, emaLonga: 95 }),
      dia("d2", { fecha: 110, emaCurta: 90, emaLonga: 95 }),
    ];
    expect(rodarTendencia(dias, semCusto).trades).toHaveLength(0);
  });

  it("preço abaixo da EMA curta não entra, mesmo com as médias cruzadas", () => {
    const dias = [
      dia("d1", { fecha: 100, emaCurta: 105, emaLonga: 95 }),
      dia("d2", { fecha: 110, emaCurta: 105, emaLonga: 95 }),
    ];
    expect(rodarTendencia(dias, semCusto).trades).toHaveLength(0);
  });

  it("ATR degenerado (zero) não opera em vez de virar stop colado", () => {
    const dias = [alta("d1", 100, { fecha: 100, atr: 0 }), alta("d2", 100, { fecha: 100, atr: 0 })];
    expect(rodarTendencia(dias, semCusto).trades).toHaveLength(0);
  });
});

describe("o que sobra aberto no fim", () => {
  /** ⚠️ Deixar de fora esconderia perda não realizada; fingir stop inventaria
   *  uma saída que não houve. Fecha no último preço, e o motivo diz isso. */
  it("fecha no último preço com motivo próprio", () => {
    const r = rodarTendencia([alta("d1", 100), alta("d2", 100), alta("d3", 130)], semCusto);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].motivo).toBe("fim_da_janela");
    expect(r.trades[0].precoSaida).toBe(130);
    expect(r.retornoPct).toBeGreaterThan(0);
  });
});

describe("tombo e exposição", () => {
  it("mede a maior queda da curva, em magnitude positiva", () => {
    const dias = [
      alta("d1", 100), alta("d2", 100, { fecha: 100, atr: 1 }),
      dia("d3", { fecha: 99, baixa: 90 }),         // stop a 98
      alta("d4", 99), alta("d5", 99),
    ];
    const r = rodarTendencia(dias, semCusto);
    expect(r.tomboMaxPct).toBeGreaterThanOrEqual(0);
  });

  it("sem sinal nenhum, exposição é zero e não há divisão por zero", () => {
    const dias = [
      dia("d1", { fecha: 100, emaCurta: 90, emaLonga: 95 }),
      dia("d2", { fecha: 100, emaCurta: 90, emaLonga: 95 }),
    ];
    const r = rodarTendencia(dias, semCusto);
    expect(r.exposicaoPct).toBe(0);
    expect(Number.isFinite(r.exposicaoPct)).toBe(true);
  });

  it("série de um dia ou vazia devolve resultado neutro sem explodir", () => {
    expect(rodarTendencia([], semCusto).trades).toHaveLength(0);
    expect(rodarTendencia([alta("d1", 100)], semCusto).curva).toEqual([]);
  });
});

describe("escolherRisco — o critério é a RAZÃO, não o retorno", () => {
  /**
   * ⚠️ Escolher pelo retorno elegeria SEMPRE o maior risco, porque risco maior
   * multiplica o resultado no treino — e o treino é justamente onde o número é
   * otimista. Um ganho que só aparece dobrando a exposição não é descoberta
   * sobre a regra.
   */
  it("devolve um risco da lista de candidatos", () => {
    const dias = [alta("d1", 100), alta("d2", 100), alta("d3", 120), alta("d4", 90)];
    const e = escolherRisco(dias, semCusto);
    expect(RISCOS_CANDIDATOS).toContain(e.params.riscoPct as 0.5 | 0.75 | 1);
  });

  it("sem trade nenhum não explode e devolve resultado zero", () => {
    const dias = [
      dia("d1", { fecha: 100, emaCurta: 90, emaLonga: 95 }),
      dia("d2", { fecha: 100, emaCurta: 90, emaLonga: 95 }),
    ];
    expect(escolherRisco(dias, semCusto).resultadoPct).toBe(0);
  });
});

/**
 * ⚠️ MONTAGEM DA SÉRIE — onde um erro de alinhamento se esconde sem aparecer.
 *
 * Se a EMA de 200 ficar deslocada em um dia, nada quebra: o motor opera um
 * indicador levemente errado por toda a janela e devolve um número plausível.
 * Erro de alinhamento não produz exceção, produz RESULTADO — que é a pior
 * forma de errar num laboratório.
 */
describe("montarSerie", () => {
  const velas = (n: number, base = 100) => Array.from({ length: n }, (_, i) => ({
    dia: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    alta: base + i + 1, baixa: base + i - 1, fecha: base + i,
  }));

  it("símbolo sem velas para aquecer fica INTEIRO de fora", () => {
    const s = montarSerie(new Map([["CURTO", velas(EMA_LONGA + ATR_PERIODO - 1)]]));
    expect(s).toHaveLength(0);
  });

  it("antes do aquecimento os indicadores são null, não zero", () => {
    const s = montarSerie(new Map([["BTC", velas(400)]]));
    const cedo = s[10].porSimbolo.get("BTC")!;
    expect(cedo.emaCurta).toBeNull();
    expect(cedo.emaLonga).toBeNull();
    expect(cedo.atr).toBeNull();
    // E o preço continua lá: o dia existe, só não é operável.
    expect(cedo.fecha).toBeGreaterThan(0);
  });

  it("depois do aquecimento os três indicadores existem", () => {
    const s = montarSerie(new Map([["BTC", velas(400)]]));
    const tarde = s[350].porSimbolo.get("BTC")!;
    expect(typeof tarde.emaCurta).toBe("number");
    expect(typeof tarde.emaLonga).toBe("number");
    expect(typeof tarde.atr).toBe("number");
  });

  /** Numa série que só sobe, a média curta fica ACIMA da longa. Se o
   *  alinhamento estiver trocado, esta relação inverte. */
  it("em série que só sobe, EMA curta > EMA longa depois do aquecimento", () => {
    const s = montarSerie(new Map([["BTC", velas(400)]]));
    const p = s[380].porSimbolo.get("BTC")!;
    expect(p.emaCurta!).toBeGreaterThan(p.emaLonga!);
  });

  /**
   * ⚠️ O CALENDÁRIO É A UNIÃO. Forçar a interseção jogaria fora anos de BTC
   * para acomodar um símbolo que nasceu ontem.
   */
  it("símbolo listado depois entra só nos dias que tem", () => {
    const antigo = velas(400);
    const novo = velas(300).map((v, i) => ({ ...v, dia: antigo[i + 100].dia }));
    const s = montarSerie(new Map([["BTC", antigo], ["NOVO", novo]]));
    expect(s).toHaveLength(400);
    expect(s[0].porSimbolo.has("NOVO")).toBe(false);
    expect(s[399].porSimbolo.has("NOVO")).toBe(true);
    expect(s[399].porSimbolo.has("BTC")).toBe(true);
  });

  it("os dias saem em ordem cronológica", () => {
    const s = montarSerie(new Map([["BTC", velas(400)]]));
    for (let i = 1; i < s.length; i++) expect(s[i].dia > s[i - 1].dia).toBe(true);
  });
});

/**
 * O ENCANAMENTO INTEIRO, de ponta a ponta, sobre série sintética.
 *
 * ⚠️ Isto NÃO mede o mercado — mede que as peças se encaixam: aquecimento,
 * fatiamento, escolha no treino, avaliação no teste e veredito. Um walk-forward
 * que devolve zero dobras, ou que devolve dobras com indicador `null` em todo
 * dia, sairia daqui como "inconclusiva" e pareceria um resultado de mercado.
 */
describe("encanamento completo (série sintética, sem rede)", () => {
  /** Passeio determinístico com deriva — sem `Math.random`, que deixaria o
   *  teste instável e a falha impossível de reproduzir. */
  function serieSintetica(n: number, deriva: number): VelaBruta[] {
    let semente = 42, preco = 100;
    return Array.from({ length: n }, (_, i) => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      const choque = ((semente / 2147483648) - 0.5) * 4;
      preco = Math.max(1, preco * (1 + (deriva + choque) / 100));
      return {
        dia: new Date(Date.UTC(2019, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
        alta: preco * 1.02, baixa: preco * 0.98, fecha: preco,
      };
    });
  }

  it("produz dobras suficientes e um veredito legível", () => {
    const serie = montarSerie(new Map([
      ["BTC", serieSintetica(1400, 0.08)],
      ["ETH", serieSintetica(1400, 0.05)],
      ["SOL", serieSintetica(1400, -0.03)],
    ]));
    expect(serie.length).toBeGreaterThan(1300);

    const wf = rodarWalkForward(
      serie,
      (treino) => escolherRisco(treino),
      (params, teste) => rodarTendencia(teste, params).retornoPct,
      { treinoDias: 365, testeDias: 120 },
    );

    expect(wf.dobras.length).toBeGreaterThanOrEqual(MIN_DOBRAS);
    expect(wf.dobrasIlegiveis).toBe(0);
    expect(wf.foraPorDia).not.toBeNull();
    expect(wf.dentroPorDia).not.toBeNull();

    const v = vereditoWalkForward(wf);
    expect(["verde", "morta", "empate", "inconclusiva"]).toContain(v.status);
    expect(v.texto).toContain("dobra");
  });

  /**
   * ⚠️ O motor TEM que operar nesta série — se não operar, o teste acima
   * passaria medindo o nada, que é a armadilha da assertiva vazia de novo.
   *
   * ⚠️ E A CONTAGEM BAIXA É O PONTO, NÃO UM DEFEITO. A primeira versão deste
   * teste exigia mais de 5 trades e falhou com 2 em 1.400 dias. Dois trades
   * segurados por quase quatro anos é EXATAMENTE a hipótese que este motor
   * existe para testar: baixa frequência amortiza o pedágio. Exigir muitos
   * trades seria exigir que ele desmentisse a própria tese.
   *
   * Por isso a asserção que vale é a EXPOSIÇÃO — ficar posicionado a maior
   * parte do tempo com pouquíssimas trocas.
   */
  it("opera pouco e segura muito — a propriedade de baixa frequência", () => {
    const serie = montarSerie(new Map([["BTC", serieSintetica(1400, 0.08)]]));
    const r = rodarTendencia(serie, PARAMS_PADRAO);
    expect(r.trades.length).toBeGreaterThanOrEqual(1);
    expect(r.custoPct).toBeGreaterThan(0);
    /**
     * Poucas trocas, muito tempo na rua: a assinatura da família.
     *
     * ⚠️ O piso é 30% e não 50% porque o AQUECIMENTO come a janela: as
     * primeiras 200 velas não têm EMA longa e são inoperáveis por construção
     * — 14% do total antes de qualquer decisão. Medido aqui: ~46%.
     */
    expect(r.exposicaoPct).toBeGreaterThan(30);
    expect(r.trades.length).toBeLessThan(serie.length / 100);
  });
});
