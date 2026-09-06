/**
 * AS ESTRATÉGIAS DA CASA — o ponto de partida, e o cemitério.
 *
 * ⚠️⚠️ O QUE TORNA ISTO NOSSO E NÃO UM CATÁLOGO DE BACKTESTER (§6.5 do plano).
 *
 * Backtester é commodity. *"Esta perdeu 46,77% e aqui está o porquê"* não é —
 * e o argumento econômico é mais forte que o argumento honesto:
 *
 *   · custo marginal ZERO — as mesas já foram medidas e pagas;
 *   · nenhum concorrente tem, porque ninguém publica o que não funcionou;
 *   · ⚠️ **elas REDUZEM custo.** O cliente que lê "o pedágio comeu 67% do seu
 *     alvo" antes de rodar cinquenta backtests gasta menos CPU e abre menos
 *     suporte. A mesa morta é o professor mais barato que temos.
 *
 * ⚠️⚠️ E A MEDIÇÃO DA CASA NÃO É PREVISÃO PARA O CLIENTE. Cada número aqui saiu
 * de UMA janela, com UM par de parâmetros, nas NOSSAS mesas. Pôr isso ao lado
 * de um botão "clonar" convida a leitura errada — *"esta rende −46%"* — quando
 * o certo é *"esta rendeu −46% naquela janela, e aqui está o mecanismo"*. Por
 * isso `medicao` carrega SEMPRE a janela e o mecanismo, e nunca uma projeção.
 *
 * ⚠️ Este arquivo é PURO e sem i18n embutido: ele guarda parâmetros e CHAVES.
 * O texto vive no catálogo dos quatro idiomas, como todo o resto da tela.
 */

import type { EstrategiaDoCliente } from "@/lib/bancada/vocabulario";

export interface MedicaoDaCasa {
  /** Quando a casa mediu. ⚠️ Sempre visível: número sem janela é propaganda. */
  quando: string;
  /** O número que saiu, já em texto curto (ex.: "−46,77%"). */
  resultado: string;
  /** A chave i18n que explica O MECANISMO — por que aconteceu. */
  porqueKey: string;
}

export interface EstrategiaDaCasa {
  id: string;
  nomeKey: string;
  comoFuncionaKey: string;
  /** Já no vocabulário do cliente: o botão "usar" preenche o formulário. */
  params: EstrategiaDoCliente;
  /**
   * ⚠️ `false` = a casa APOSENTOU esta mesa. Ela continua clonável de
   * propósito: carregar uma estratégia morta e ver o portão recusá-la na hora,
   * com o número, ensina mais do que qualquer texto.
   */
  viva: boolean;
  /** `null` quando a casa nunca rodou esta configuração — e aí não se afirma nada. */
  medicao: MedicaoDaCasa | null;
}

export const ESTRATEGIAS_DA_CASA: EstrategiaDaCasa[] = [
  /**
   * ⚠️ A LÁPIDE MAIS CARA DESTA CASA. O Maker de Faixa acertou 70,4% das vezes
   * (n=27, p≈0,026) e PERDEU: com alvo de ±0,6% na Gate spot, o pedágio de
   * 0,40% entregava 121% do ganho de preço à corretora. Ele não morreu de
   * errar — morreu de aritmética.
   *
   * ⚠️ Carregá-la faz o portão recusar NA HORA, com o número. É o caso em que
   * a recusa é a aula.
   */
  {
    id: "maker_faixa_morto",
    nomeKey: "bancada.casaMakerNome",
    comoFuncionaKey: "bancada.casaMakerComo",
    viva: false,
    params: {
      entrada: { tipo: "canal", n: 20 }, direcao: "compra",
      alvoPct: 0.6, stopPct: 0.6, horasLimite: 24,
      praca: "spot_gate", papel: "taker",
    },
    medicao: { quando: "23/08/2026", resultado: "70,4% de acerto, e perdeu", porqueKey: "bancada.casaMakerPorque" },
  },

  /**
   * ⚠️ O MESMO MAKER, COM O BRACKET LARGO (#381). Alvo de ±1,5% na mesma praça
   * passa no portão — e a diferença entre esta linha e a de cima é toda a tese
   * da bancada: não foi a ideia que mudou, foi o tamanho do movimento.
   */
  {
    id: "maker_faixa_largo",
    nomeKey: "bancada.casaMakerLargoNome",
    comoFuncionaKey: "bancada.casaMakerLargoComo",
    viva: true,
    params: {
      entrada: { tipo: "canal", n: 20 }, direcao: "compra",
      alvoPct: 2.5, stopPct: 2.5, horasLimite: 24,
      praca: "futuros_gate", papel: "maker",
    },
    medicao: null,
  },

  {
    id: "grade_morta",
    nomeKey: "bancada.casaGradeNome",
    comoFuncionaKey: "bancada.casaGradeComo",
    viva: false,
    params: {
      entrada: { tipo: "media", n: 20 }, direcao: "compra",
      alvoPct: 1.0, stopPct: 8.0, horasLimite: 72,
      praca: "spot_gate", papel: "taker",
    },
    medicao: { quando: "31/08/2026", resultado: "−46,77%", porqueKey: "bancada.casaGradePorque" },
  },

  {
    id: "rotacao_morta",
    nomeKey: "bancada.casaRotacaoNome",
    comoFuncionaKey: "bancada.casaRotacaoComo",
    viva: false,
    params: {
      entrada: { tipo: "media", n: 50 }, direcao: "compra",
      alvoPct: 3.0, stopPct: 3.0, horasLimite: 168,
      praca: "spot_gate", papel: "taker",
    },
    medicao: { quando: "31/08/2026", resultado: "−1,61% por período", porqueKey: "bancada.casaRotacaoPorque" },
  },

  /**
   * As canônicas de `benchmarks.ts` — parâmetro de livro (50, 20, 14), NÃO
   * escolhido olhando estes dados. Ver a nota daquele arquivo: varrer parâmetro
   * procurando o melhor produz sobreajuste com cara de descoberta.
   */
  {
    id: "media_50",
    nomeKey: "bancada.casaMedia50Nome",
    comoFuncionaKey: "bancada.casaMedia50Como",
    viva: true,
    params: {
      entrada: { tipo: "media", n: 50 }, direcao: "compra",
      alvoPct: 4.0, stopPct: 2.5, horasLimite: 336,
      praca: "futuros_gate", papel: "taker",
    },
    medicao: null,
  },
  {
    id: "canal_20",
    nomeKey: "bancada.casaCanal20Nome",
    comoFuncionaKey: "bancada.casaCanal20Como",
    viva: true,
    params: {
      entrada: { tipo: "canal", n: 20 }, direcao: "compra",
      alvoPct: 5.0, stopPct: 3.0, horasLimite: 336,
      praca: "futuros_gate", papel: "taker",
    },
    medicao: null,
  },
  {
    id: "rsi_14",
    nomeKey: "bancada.casaRsi14Nome",
    comoFuncionaKey: "bancada.casaRsi14Como",
    viva: true,
    params: {
      entrada: { tipo: "rsi", n: 14, nivel: 30 }, direcao: "compra",
      alvoPct: 3.0, stopPct: 2.0, horasLimite: 168,
      praca: "futuros_gate", papel: "taker",
    },
    medicao: null,
  },
];

export function estrategiaDaCasa(id: string): EstrategiaDaCasa | null {
  return ESTRATEGIAS_DA_CASA.find((e) => e.id === id) ?? null;
}
