/**
 * O REGIME E O PEDÁGIO — as três invariantes que faltavam no Celeiro.
 *
 * Ver `docs/PLANO-CELEIRO-AMBICIOSO.md`.
 *
 * ⚠️⚠️ O ERRO QUE ESTE MÓDULO EXISTE PARA IMPEDIR (22/08).
 *
 * O Maker de Faixa rodou 29 posições e ficou **negativo acertando 65,5%**. O
 * extrato mostrou por quê:
 *
 *     preço      +3,1557   (+0,1088 por operação)
 *     taxa       −3,3750   (−0,0563 × 2 pernas)
 *     líquido    −0,2339
 *
 * O trade médio ganhava $0,1088 de preço e pagava $0,1125 de pedágio. **Ele
 * perdia por construção** — alvo de 0,6% contra ida-e-volta de 0,225%, ou seja
 * 37% do alvo comido antes de o preço se mexer.
 *
 * ⚠️ E AUMENTAR O TAMANHO NÃO CONSERTA: a taxa é proporcional ao nocional.
 * Dobrar a posição dobra ganho e pedágio na mesma medida. O que muda a razão é
 * o TAMANHO DO MOVIMENTO por operação — swing, não escalpe.
 */

/** Custo de UMA perna, em % do nocional. */
export const TAXA_POR_PERNA_PCT = Number(process.env.CELEIRO_TAXA_PERNA_PCT ?? 0.1125);

/** O pedágio de ida e volta — duas pernas, sempre. */
export const PEDAGIO_IDA_E_VOLTA_PCT = TAXA_POR_PERNA_PCT * 2;

/**
 * Quantas vezes o alvo precisa valer o pedágio.
 *
 * ⚠️ SEIS NÃO É GOSTO, É A CONTA AO CONTRÁRIO. Com múltiplo 6 o pedágio fica em
 * ~17% do alvo bruto; com 3, em 33%; com 2, em 50%. O Maker morreu operando com
 * múltiplo **2,7** — e ainda assim acertando 65% das vezes. Abaixo de ~5 o
 * agente precisa de uma taxa de acerto que nenhuma mesa desta casa jamais teve.
 */
export const MULTIPLO_DO_PEDAGIO = Number(process.env.CELEIRO_MULTIPLO_PEDAGIO ?? 6);

export interface VeredictoDeAlvo {
  passa: boolean;
  alvoMinimoPct: number;
  /** Que fração do alvo bruto o pedágio consome (0 a 1). */
  fatiaDoPedagio: number;
  porque: string;
}

/**
 * ⚠️⚠️ A INVARIANTE I1. Um alvo que não cobre o pedágio com folga é uma aposta
 * em que a casa leva antes de a moeda cair. Isto não é opinião sobre estratégia:
 * é aritmética, e é a guarda que teria impedido o erro inteiro.
 */
export function alvoLimpaOPedagio(
  alvoPct: number,
  multiplo: number = MULTIPLO_DO_PEDAGIO,
): VeredictoDeAlvo {
  const alvoMinimoPct = PEDAGIO_IDA_E_VOLTA_PCT * multiplo;
  const fatiaDoPedagio = alvoPct > 0 ? PEDAGIO_IDA_E_VOLTA_PCT / alvoPct : 1;

  if (!(alvoPct > 0)) {
    return { passa: false, alvoMinimoPct, fatiaDoPedagio: 1, porque: "alvo não positivo" };
  }
  if (alvoPct < alvoMinimoPct) {
    return {
      passa: false, alvoMinimoPct, fatiaDoPedagio,
      porque: `alvo de ${alvoPct.toFixed(2)}% deixa ${(fatiaDoPedagio * 100).toFixed(0)}% `
        + `para o pedágio (mínimo ${alvoMinimoPct.toFixed(2)}%) — foi assim que o `
        + "Maker de Faixa perdeu acertando 65%",
    };
  }
  return {
    passa: true, alvoMinimoPct, fatiaDoPedagio,
    porque: `alvo de ${alvoPct.toFixed(2)}% deixa só ${(fatiaDoPedagio * 100).toFixed(0)}% `
      + "para o pedágio",
  };
}

/* ──────────────── I2 — O STOP FORA DO RUÍDO DO ATIVO ──────────── */

export interface VeredictoDeStop {
  stopPct: number;
  /** `false` = não deu para medir a volatilidade; ficou o declarado. */
  medido: boolean;
  porque: string;
}

/**
 * Quantas amplitudes médias de vela o stop precisa ter de distância.
 *
 * ⚠️ 3 NÃO É PALPITE, É O QUE O BTC JÁ TINHA. Com stop fixo de 1,2% e amplitude
 * de 0,32%/vela, o BTC operava a 3,75 amplitudes — e foi o menos chicoteado dos
 * três (17,1% das janelas de 1,5h tocam 1,2%, contra 39,6% do SOL). O número
 * iguala os ativos NA UNIDADE QUE IMPORTA, que é o ruído deles, não o preço.
 */
export const MULTIPLO_DO_RUIDO = Number(process.env.CELEIRO_MULTIPLO_DO_RUIDO ?? 3);

/** Teto duro: stop largo demais transforma uma perda em várias. */
export const STOP_TETO_PCT = Number(process.env.CELEIRO_STOP_TETO_PCT ?? 6);

/**
 * ⚠️⚠️ A INVARIANTE I2 — O STOP TEM QUE FICAR FORA DO RUÍDO.
 *
 * A CICATRIZ (23/08): as três primeiras entradas decididas do Celeiro morreram
 * no stop, todas no SOL, todas em exatamente −1,200% e exatamente 1,5h. Uma
 * vendeu SOL a 93,63; uma hora e meia depois duas COMPRARAM a 96,24 — vendeu o
 * fundo e comprou o topo, e as três pagaram pedágio para descobrir isso.
 *
 * Medido em 3 dias de velas de 5m, janelas de 1,5h:
 *
 *     SOL   39,6% das janelas tocam ±1,2%   mediana do maior movimento 1,02%
 *     ETH   24,2%                                                     0,80%
 *     BTC   17,1%                                                     0,58%
 *
 * O stop era 1,2% para TODOS. No SOL isso fica a um passo da mediana do ruído:
 * 4 em cada 10 janelas o tocam sem tendência nenhuma.
 *
 * ⚠️ E O PROJETO JÁ MEDIA ESSA VOLATILIDADE — usava em `alavancagemCoerente`
 * para dimensionar a ALAVANCA, e mantinha o stop fixo. O risco estava medido e
 * não era aplicado onde decide o resultado.
 *
 * ⚠️⚠️ POR QUE ISTO PAGA, e a razão NÃO é "menos stops". Num passeio sem
 * tendência, QUALQUER par alvo/stop tem valor esperado exatamente zero — alargar
 * o stop troca "erra menos vezes" por "perde mais quando erra", e as duas coisas
 * se cancelam. O que não se cancela é o PEDÁGIO: ele é cobrado por ida-e-volta,
 * então saída decidida por ruído é pedágio pago numa moeda. Menos viagens
 * inúteis é a única economia real aqui.
 *
 * ⚠️ POR ISSO É PISO, NUNCA TETO. Só ALARGA o stop declarado, nunca aperta.
 * Apertar o do BTC seria mudança sem medição atrás — e a medição que existe diz
 * respeito a quem está apertado demais, não a quem está folgado.
 */
export function stopPorVolatilidade(
  volatilidadePct: number | null,
  stopDeclaradoPct: number,
  multiplo: number = MULTIPLO_DO_RUIDO,
  tetoPct: number = STOP_TETO_PCT,
): VeredictoDeStop {
  if (volatilidadePct == null || !(volatilidadePct > 0)) {
    return {
      stopPct: stopDeclaradoPct, medido: false,
      porque: `volatilidade não medida — fica o stop declarado de ${stopDeclaradoPct.toFixed(2)}%`,
    };
  }

  const pedido = volatilidadePct * multiplo;

  if (pedido <= stopDeclaradoPct) {
    return {
      stopPct: stopDeclaradoPct, medido: true,
      porque: `ruído de ${volatilidadePct.toFixed(2)}%/vela pede ${pedido.toFixed(2)}% — `
        + `o declarado de ${stopDeclaradoPct.toFixed(2)}% já está fora dele`,
    };
  }

  if (pedido > tetoPct) {
    return {
      stopPct: tetoPct, medido: true,
      porque: `ruído de ${volatilidadePct.toFixed(2)}%/vela pediria ${pedido.toFixed(2)}%, `
        + `acima do teto de ${tetoPct.toFixed(2)}% — ativo volátil demais para este alvo`,
    };
  }

  return {
    stopPct: pedido, medido: true,
    porque: `stop alargado de ${stopDeclaradoPct.toFixed(2)}% para ${pedido.toFixed(2)}% `
      + `= ${multiplo}× o ruído de ${volatilidadePct.toFixed(2)}%/vela`,
  };
}

/* ─────────────────────────── O REGIME ─────────────────────────── */

export type Estado = "alta" | "baixa" | "sangrando" | "sem_sinal";

export interface Vela { fechamento: number; maxima: number; minima: number }

export interface Regime {
  estado: Estado;
  /** Retorno da janela, em %. `null` quando não deu para medir. */
  tendenciaPct: number | null;
  /** Volatilidade da janela (amplitude média por vela), em %. */
  volatilidadePct: number | null;
  /** O pior movimento CONTRA já visto na janela, em % — insumo da alavancagem. */
  piorContraPct: number | null;
  porque: string;
}

/** Abaixo disto o mercado está de lado — não é tendência para nenhum lado. */
export const TENDENCIA_MINIMA_PCT = Number(process.env.CELEIRO_TENDENCIA_MIN_PCT ?? 1.5);

/**
 * Acima disto o mercado está SANGRANDO e ninguém opera.
 *
 * ⚠️ "SANGRANDO" É DIFERENTE DE "BAIXA", e a distinção é o que separa operar
 * vendido de ser atropelado. Baixa é tendência — dá para vender. Sangrando é
 * queda desordenada com a volatilidade explodindo: o stop não segura porque o
 * preço pula por cima dele, e a liquidação chega antes do alvo.
 */
export const VOLATILIDADE_DE_SANGRIA_PCT = Number(process.env.CELEIRO_VOL_SANGRIA_PCT ?? 3.5);

/**
 * Lê o estado do mercado a partir das velas — MEDIDO, nunca previsto.
 *
 * ⚠️⚠️ A DIFERENÇA QUE EU TINHA CONFUNDIDO. Medi que LLM PREVENDO direção fica
 * de −6,7 a −30,4 pp abaixo de uma moeda, em 3.300 decisões — e daí escrevi
 * "nenhum agente aposta em direção". Foi generalização errada: **seguir
 * tendência medida não é prever direção**, é reagir a um estado observável.
 *
 * A prova estava no próprio repositório: a #324 mediu que o filtro de tendência
 * PAGA, e paga 5,5× mais quando a posição cresce. Eu auditei aquilo e não liguei
 * os pontos.
 */
export function lerRegime(velas: readonly Vela[]): Regime {
  const boas = velas.filter(
    (v) => Number.isFinite(v.fechamento) && v.fechamento > 0
        && Number.isFinite(v.maxima) && Number.isFinite(v.minima),
  );
  if (boas.length < 10) {
    return {
      estado: "sem_sinal", tendenciaPct: null, volatilidadePct: null, piorContraPct: null,
      porque: `${boas.length} velas legíveis — série curta demais para ler estado`,
    };
  }

  const inicio = boas[0].fechamento;
  const fim = boas[boas.length - 1].fechamento;
  const tendenciaPct = ((fim - inicio) / inicio) * 100;

  const volatilidadePct = boas.reduce(
    (s, v) => s + ((v.maxima - v.minima) / v.fechamento) * 100, 0,
  ) / boas.length;

  /**
   * ⚠️ O PIOR MOVIMENTO CONTRA é o maior recuo pico-a-vale da janela — não o
   * desvio padrão. Alavancagem morre no pior caso, não no caso médio, e a média
   * esconde exatamente o evento que liquida.
   */
  let pico = boas[0].fechamento, piorContraPct = 0;
  for (const v of boas) {
    if (v.fechamento > pico) pico = v.fechamento;
    const queda = ((pico - v.minima) / pico) * 100;
    if (queda > piorContraPct) piorContraPct = queda;
  }

  if (volatilidadePct >= VOLATILIDADE_DE_SANGRIA_PCT) {
    return {
      estado: "sangrando", tendenciaPct, volatilidadePct, piorContraPct,
      porque: `volatilidade de ${volatilidadePct.toFixed(2)}% por vela — o stop não `
        + "segura porque o preço pula por cima dele. Ninguém opera aqui.",
    };
  }
  if (Math.abs(tendenciaPct) < TENDENCIA_MINIMA_PCT) {
    return {
      estado: "sem_sinal", tendenciaPct, volatilidadePct, piorContraPct,
      porque: `mercado andou ${tendenciaPct.toFixed(2)}% na janela — de lado, sem lado para tomar`,
    };
  }
  return {
    estado: tendenciaPct > 0 ? "alta" : "baixa",
    tendenciaPct, volatilidadePct, piorContraPct,
    porque: `${tendenciaPct > 0 ? "alta" : "baixa"} de ${Math.abs(tendenciaPct).toFixed(2)}% `
      + `com volatilidade de ${volatilidadePct.toFixed(2)}% por vela`,
  };
}

export type Lado = "buy" | "sell";

export interface Permissao {
  opera: boolean;
  lado: Lado | null;
  porque: string;
}

/**
 * ⚠️⚠️ A INVARIANTE I2. O regime decide SE opera e DE QUE LADO.
 *
 * ⚠️ SPOT NÃO VENDE. Sem futuros não há como lucrar na queda acumulando USDT —
 * em spot, "vender na baixa" é apenas sair. Escrever a regra sem essa distinção
 * deixaria uma armadilha pronta para o primeiro agente de spot que tentasse.
 */
export function permite(r: Regime, podeVender: boolean): Permissao {
  if (r.estado === "sangrando") {
    return { opera: false, lado: null, porque: r.porque };
  }
  if (r.estado === "sem_sinal") {
    return { opera: false, lado: null, porque: r.porque };
  }
  if (r.estado === "alta") {
    return { opera: true, lado: "buy", porque: `${r.porque} — compra` };
  }
  if (!podeVender) {
    return {
      opera: false, lado: null,
      porque: `${r.porque} — este agente é spot e não vende: na baixa ele fica de fora`,
    };
  }
  return { opera: true, lado: "sell", porque: `${r.porque} — vende` };
}

/* ─────────────────────── A ALAVANCAGEM ─────────────────────── */

/**
 * Folga exigida entre a liquidação e o pior movimento contra medido.
 *
 * ⚠️ 2× SIGNIFICA: o preço teria de andar contra o DOBRO do pior que já andou
 * na janela para liquidar. Com folga 1 a liquidação fica exatamente no pior caso
 * já visto — e "exatamente no pior caso já visto" é onde o próximo pior caso
 * acontece.
 */
export const FOLGA_DA_LIQUIDACAO = Number(process.env.CELEIRO_FOLGA_LIQUIDACAO ?? 2);

export interface Alavancagem {
  /** Quantas vezes o capital. `1` = sem alavancagem. */
  vezes: number;
  liquidaEmPct: number;
  porque: string;
}

/**
 * ⚠️⚠️ A INVARIANTE I3. "Sem suicídio" precisa de número, senão é só palavra.
 *
 * Alavancagem coerente não é um teto fixo — é a alavancagem cuja liquidação fica
 * mais longe que o pior movimento contrário JÁ OBSERVADO, com folga. Se o pior
 * repique contra foi 8%, alavancar até liquidar em 10% é suicídio com outro nome.
 *
 * ⚠️ E ELA PODE DEVOLVER 1× SEMPRE. Se o pior movimento medido nunca deixa
 * folga, o agente opera sem alavanca — isso é RESULTADO, não falha. Forçar uma
 * alavanca mínima seria escolher o apetite em vez da conta.
 */
export function alavancagemCoerente(
  piorContraPct: number | null,
  tetoDuro: number,
  folga: number = FOLGA_DA_LIQUIDACAO,
): Alavancagem {
  if (piorContraPct == null || !(piorContraPct > 0)) {
    return {
      vezes: 1, liquidaEmPct: 100,
      porque: "pior movimento contra não medido — sem alavanca, porque a conta que "
        + "a dimensiona não existe",
    };
  }

  /**
   * A margem some quando o preço anda `100/alavanca` % contra. Exigir que isso
   * seja maior que `piorContra × folga` dá o teto.
   */
  const distanciaExigida = piorContraPct * folga;
  const porConta = Math.floor(100 / distanciaExigida);
  const vezes = Math.max(1, Math.min(tetoDuro, porConta));

  return {
    vezes,
    liquidaEmPct: 100 / vezes,
    porque: vezes === 1
      ? `pior movimento contra de ${piorContraPct.toFixed(2)}% exige ${distanciaExigida.toFixed(1)}% `
        + "de distância — não sobra espaço para alavancar"
      : `${vezes}× liquida em ${(100 / vezes).toFixed(1)}%, contra um pior movimento `
        + `medido de ${piorContraPct.toFixed(2)}% (folga ${folga}×)`,
  };
}
