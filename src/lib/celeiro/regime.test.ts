import { describe, it, expect } from "vitest";
import {
  alvoLimpaOPedagio, lerRegime, permite, alavancagemCoerente, stopPorVolatilidade,
  PEDAGIO_IDA_E_VOLTA_PCT, MULTIPLO_DO_PEDAGIO,
  TENDENCIA_MINIMA_PCT, VOLATILIDADE_DE_SANGRIA_PCT, FOLGA_DA_LIQUIDACAO,
  MULTIPLO_DO_RUIDO, STOP_TETO_PCT,
  type Vela,
} from "@/lib/celeiro/regime";

/**
 * AS TRÊS INVARIANTES QUE FALTAVAM — e o cadáver que as exigiu.
 *
 * ⚠️⚠️ O Maker de Faixa rodou 29 posições e ficou NEGATIVO acertando 65,5%:
 * preço +3,1557 contra taxa −3,3750. O trade médio ganhava $0,1088 e pagava
 * $0,1125 de pedágio. Perdia por CONSTRUÇÃO, com alvo de 0,6% contra
 * ida-e-volta de 0,225%.
 *
 * Nenhum backtest tinha dito isso. Estes testes existem para que a aritmética
 * reprove antes de o dinheiro provar.
 */

function vela(f: number, amplitudePct = 0.5): Vela {
  return { fechamento: f, maxima: f * (1 + amplitudePct / 200), minima: f * (1 - amplitudePct / 200) };
}
/** Série de n velas indo de `de` até `ate`, com amplitude fixa. */
function serie(n: number, de: number, ate: number, amp = 0.5): Vela[] {
  return Array.from({ length: n }, (_, i) => vela(de + ((ate - de) * i) / (n - 1), amp));
}

describe("o alvo tem de limpar o pedágio", () => {
  /**
   * ⚠️⚠️ O CASO DO CADÁVER, FIXADO. O genoma do Maker tinha `alvoPct: 0.6` e o
   * pedágio é 0,225% — múltiplo 2,7. Este teste exige que aquela configuração
   * seja RECUSADA, e é a guarda que teria impedido o erro inteiro.
   */
  it("recusa o alvo que matou o Maker de Faixa", () => {
    const v = alvoLimpaOPedagio(0.6);
    expect(v.passa).toBe(false);
    expect(v.fatiaDoPedagio).toBeCloseTo(0.225 / 0.6, 6);   // 37,5% do alvo
    expect(v.porque).toContain("acertando 65%");
  });

  it("aprova o alvo que deixa folga", () => {
    const minimo = PEDAGIO_IDA_E_VOLTA_PCT * MULTIPLO_DO_PEDAGIO;
    expect(alvoLimpaOPedagio(minimo).passa).toBe(true);
    expect(alvoLimpaOPedagio(minimo * 1.5).passa).toBe(true);
  });

  /**
   * ⚠️ A FRAÇÃO DO PEDÁGIO É O NÚMERO QUE ENSINA, e ela não depende do tamanho
   * da posição — só da razão alvo/pedágio. Por isso "aumentar a aposta" não
   * conserta: a taxa é proporcional ao nocional.
   */
  it("a fatia do pedágio independe do tamanho, só do alvo", () => {
    expect(alvoLimpaOPedagio(0.45).fatiaDoPedagio).toBeCloseTo(0.5, 6);
    expect(alvoLimpaOPedagio(2.25).fatiaDoPedagio).toBeCloseTo(0.1, 6);
  });

  it("alvo não positivo reprova sem dividir por zero", () => {
    expect(alvoLimpaOPedagio(0).passa).toBe(false);
    expect(alvoLimpaOPedagio(-1).fatiaDoPedagio).toBe(1);
  });
});

describe("a leitura do regime", () => {
  /** ⚠️ Série curta é AUSÊNCIA de leitura, não "de lado". */
  it("série curta devolve sem_sinal, e não um estado inventado", () => {
    const r = lerRegime(serie(5, 100, 110));
    expect(r.estado).toBe("sem_sinal");
    expect(r.tendenciaPct).toBeNull();
    expect(r.porque).toContain("curta demais");
  });

  it("alta e baixa são lidas pelo sinal da tendência", () => {
    expect(lerRegime(serie(30, 100, 110)).estado).toBe("alta");
    expect(lerRegime(serie(30, 110, 100)).estado).toBe("baixa");
  });

  it("movimento pequeno é sem_sinal, não tendência fraca", () => {
    const r = lerRegime(serie(30, 100, 100.5));
    expect(Math.abs(r.tendenciaPct ?? 0)).toBeLessThan(TENDENCIA_MINIMA_PCT);
    expect(r.estado).toBe("sem_sinal");
  });

  /**
   * ⚠️⚠️ "SANGRANDO" VENCE "BAIXA", e a ordem importa. Baixa é tendência — dá
   * para vender. Sangrando é queda desordenada: o stop não segura porque o preço
   * pula por cima dele. A série abaixo tem tendência de baixa CLARA e ainda
   * assim não pode ser operada.
   */
  it("volatilidade alta vira sangrando, mesmo com tendência clara", () => {
    const violenta = serie(30, 120, 100, VOLATILIDADE_DE_SANGRIA_PCT * 2);
    const r = lerRegime(violenta);
    expect(r.tendenciaPct).toBeLessThan(-TENDENCIA_MINIMA_PCT);   // é baixa
    expect(r.estado).toBe("sangrando");                            // e ainda assim
    expect(r.porque).toContain("pula por cima");
  });

  /**
   * ⚠️ O PIOR MOVIMENTO CONTRA É PICO-A-VALE, não desvio padrão. Alavancagem
   * morre no pior caso; a média esconde exatamente o evento que liquida.
   */
  it("mede o pior recuo pico-a-vale, não a média", () => {
    // sobe até 110, despenca para 99, volta — o pior contra é ~10%.
    const v = [...serie(15, 100, 110, 0.2), ...serie(15, 110, 99, 0.2)];
    const r = lerRegime(v);
    expect(r.piorContraPct).toBeGreaterThan(9);
    expect(r.piorContraPct).toBeLessThan(12);
  });
});

describe("quem pode operar, e de que lado", () => {
  const alta = lerRegime(serie(30, 100, 110));
  const baixa = lerRegime(serie(30, 110, 100));
  const sangria = lerRegime(serie(30, 120, 100, VOLATILIDADE_DE_SANGRIA_PCT * 2));

  it("na alta, os dois compram", () => {
    expect(permite(alta, false)).toMatchObject({ opera: true, lado: "buy" });
    expect(permite(alta, true)).toMatchObject({ opera: true, lado: "buy" });
  });

  /**
   * ⚠️⚠️ SPOT NÃO VENDE. Sem futuros não há como lucrar na queda acumulando
   * USDT — em spot, "vender na baixa" é apenas sair. Escrever a regra sem o lado
   * deixaria armadilha pronta para o primeiro agente de spot que tentasse.
   */
  it("na baixa, só quem pode vender opera", () => {
    const spot = permite(baixa, false);
    expect(spot.opera).toBe(false);
    expect(spot.porque).toContain("não vende");

    expect(permite(baixa, true)).toMatchObject({ opera: true, lado: "sell" });
  });

  it("sangrando, ninguém opera — nem quem pode vender", () => {
    expect(permite(sangria, true).opera).toBe(false);
    expect(permite(sangria, false).opera).toBe(false);
  });
});

describe("a alavancagem coerente", () => {
  /**
   * ⚠️⚠️ ELA SAI DO PIOR CASO MEDIDO, não de um teto de apetite. Com pior
   * movimento contra de 8% e folga 2×, a liquidação precisa ficar além de 16% —
   * o que dá 6×. Pedir 20× com esse histórico é suicídio com outro nome.
   */
  it("dimensiona pelo pior movimento medido", () => {
    const a = alavancagemCoerente(8, 20, 2);
    expect(a.vezes).toBe(6);
    expect(a.liquidaEmPct).toBeCloseTo(100 / 6, 6);
    expect(a.porque).toContain("8.00%");
  });

  /** Mercado calmo permite mais — e o teto duro ainda manda. */
  it("respeita o teto duro mesmo quando a conta permitiria mais", () => {
    const semTeto = alavancagemCoerente(1, 100, 2);
    expect(semTeto.vezes).toBe(50);
    const comTeto = alavancagemCoerente(1, 5, 2);
    expect(comTeto.vezes).toBe(5);
  });

  /**
   * ⚠️ PODE DEVOLVER 1× E ISSO É RESULTADO, NÃO FALHA. Se o pior movimento não
   * deixa folga, o agente opera sem alavanca. Forçar um mínimo seria escolher o
   * apetite em vez da conta.
   */
  it("mercado violento devolve 1×, sem forçar alavanca", () => {
    const a = alavancagemCoerente(60, 20, 2);
    expect(a.vezes).toBe(1);
    expect(a.porque).toContain("não sobra espaço");
  });

  /** Sem medição não há alavanca — `inconclusivo ≠ aprovado`, aplicado ao risco. */
  it("pior movimento não medido devolve 1×", () => {
    expect(alavancagemCoerente(null, 20).vezes).toBe(1);
    expect(alavancagemCoerente(0, 20).porque).toContain("não medido");
  });

  /**
   * ⚠️ A FOLGA IMPORTA, e o teste prova com o mesmo histórico. Com folga 1 a
   * liquidação fica EXATAMENTE no pior caso já visto — que é onde o próximo
   * pior caso acontece.
   */
  it("folga maior reduz a alavanca, com o mesmo histórico", () => {
    expect(alavancagemCoerente(10, 50, 1).vezes).toBe(10);
    expect(alavancagemCoerente(10, 50, 2).vezes).toBe(5);
    expect(FOLGA_DA_LIQUIDACAO).toBeGreaterThanOrEqual(2);
  });
});

/**
 * I2 — O STOP FORA DO RUÍDO, e o cadáver que a exigiu.
 *
 * ⚠️ As três primeiras entradas decididas do Celeiro morreram no stop, todas no
 * SOL, todas em exatamente −1,200% e exatamente 1,5h. Uma vendeu SOL a 93,63;
 * uma hora e meia depois duas COMPRARAM a 96,24 — vendeu o fundo, comprou o
 * topo, e as três pagaram pedágio para descobrir isso.
 *
 * Medido em 3 dias de velas de 5m, janelas de 1,5h:
 *
 *     SOL   39,6% tocam ±1,2%   mediana do maior movimento 1,02%   0,98%/vela
 *     ETH   24,2%                                          0,80%   ~0,55%/vela
 *     BTC   17,1%                                          0,58%   0,32%/vela
 */
describe("I2 — o stop tem que ficar fora do ruído do ativo", () => {
  it("ALARGA quando o ruído engole o stop declarado — o caso do SOL", () => {
    // 0,98%/vela × 3 = 2,94%, bem acima do 1,2% que morreu três vezes.
    const r = stopPorVolatilidade(0.98, 1.2);
    expect(r.medido).toBe(true);
    expect(r.stopPct).toBeCloseTo(2.94, 6);
    expect(r.porque).toMatch(/alargado/);
  });

  /**
   * ⚠️ O PAR QUE DISTINGUE PISO DE SUBSTITUIÇÃO. Com o BTC a conta pede 0,96%,
   * que é MENOS que o declarado — e o declarado tem que ficar. Se alguém trocar
   * o piso por substituição, este teste cai e o do SOL continua passando.
   */
  it("NÃO APERTA quando o declarado já está fora do ruído — o caso do BTC", () => {
    const r = stopPorVolatilidade(0.32, 1.2);
    expect(r.medido).toBe(true);
    expect(r.stopPct).toBe(1.2);
    expect(r.porque).toMatch(/já está fora/);
  });

  it("respeita o teto: ativo volátil demais não vira stop gigante", () => {
    const r = stopPorVolatilidade(5, 1.2);        // 5 × 3 = 15%, acima do teto
    expect(r.stopPct).toBe(STOP_TETO_PCT);
    expect(r.porque).toMatch(/teto/);
  });

  it("sem volatilidade medida devolve o DECLARADO e diz que não mediu", () => {
    // ⚠️ Não inventa stop a partir de ausência de dado — e marca `medido:false`
    // para a diferença entre "medi e deu isso" e "não medi" não sumir na tela.
    for (const v of [null, 0, -1, Number.NaN]) {
      const r = stopPorVolatilidade(v as number | null, 1.2);
      expect(r.stopPct).toBe(1.2);
      expect(r.medido).toBe(false);
    }
  });

  it("o múltiplo é declarado e vale pelo menos 2 amplitudes", () => {
    expect(MULTIPLO_DO_RUIDO).toBeGreaterThanOrEqual(2);
    expect(stopPorVolatilidade(1, 0.5, 4).stopPct).toBeCloseTo(4, 6);
  });
});
