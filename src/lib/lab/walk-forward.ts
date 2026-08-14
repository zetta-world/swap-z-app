/**
 * WALK-FORWARD — separar ESCOLHER de MEDIR.
 *
 * ⚠️ POR QUE ISTO EXISTE (14/08).
 *
 * Toda medição direcional deste laboratório até hoje escolheu parâmetro e mediu
 * resultado no MESMO dado. Isso não é fraude nem descuido — é o modo natural de
 * medir, e é exatamente por isso que engana: quanto mais parâmetros você tenta,
 * melhor fica o número, e nada na tela distingue "achei uma regra" de "decorei
 * o passado".
 *
 * A auditoria externa de 14/08 apontou o buraco. Nós já o tínhamos anotado como
 * `P2.10` no `PLANO-ACAO-REVIEWS.md`, com status ⏸️ e a justificativa "gasta
 * token + é coleta de dados". Alguém de fora achar a mesma coisa lendo só o
 * código quer dizer que o adiamento já durou demais.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O DESENHO:
 *
 *   [═══ treino ═══][═ teste ═]
 *                   [═══ treino ═══][═ teste ═]
 *                                   [═══ treino ═══][═ teste ═]
 *
 * O parâmetro sai do treino. O número que vale sai SÓ do teste. As fatias de
 * teste são encadeadas e **nunca se sobrepõem**.
 *
 * ⚠️ E A TRAVA PRINCIPAL É ESTRUTURAL, NÃO DOCUMENTAL. `escolher` recebe a
 * fatia de treino e mais nada — não recebe a série inteira nem os índices. Um
 * comentário pedindo "cuidado para não olhar o futuro" seria obedecido até o
 * dia em que alguém com pressa passasse a série completa "só para conferir uma
 * coisa". Aqui não há o que passar.
 */

/**
 * Piso de dobras. UMA dobra não é walk-forward — é um backtest com nome novo,
 * e é o disfarce mais fácil de vestir. Abaixo disto o veredito é
 * `inconclusiva`, nunca `verde`.
 */
export const MIN_DOBRAS = 3;

export interface Dobra {
  /** 0, 1, 2… na ordem do tempo. */
  indice: number;
  /** Fatia de treino, meio-aberta: `[ini, fim)`. */
  treinoIni: number;
  treinoFim: number;
  /** Fatia de teste, meio-aberta: `[ini, fim)`. Nunca toca a da dobra vizinha. */
  testeIni: number;
  testeFim: number;
}

export interface OpcoesDobras {
  /** Quantos períodos o treino enxerga. */
  treinoDias: number;
  /** Quantos períodos o teste mede — e também o passo entre dobras. */
  testeDias: number;
}

/**
 * Fatia a série em dobras encadeadas.
 *
 * ⚠️ O PASSO É IGUAL À FATIA DE TESTE, e isso não é uma escolha de conveniência
 * — é o que garante que as fatias de teste sejam DISJUNTAS por construção. Com
 * passo menor elas se sobrepõem, o mesmo dia entra em duas dobras, e a amostra
 * infla sem que nada na tela mude. É a invariante nº 26 (dois registros
 * carregando a informação de um) na forma de calendário.
 */
export function montarDobras(total: number, opts: OpcoesDobras): Dobra[] {
  const { treinoDias, testeDias } = opts;
  if (!Number.isFinite(total) || total <= 0) return [];
  if (!(treinoDias > 0) || !(testeDias > 0)) return [];

  const dobras: Dobra[] = [];
  let testeIni = treinoDias;
  while (testeIni + testeDias <= total) {
    dobras.push({
      indice: dobras.length,
      treinoIni: testeIni - treinoDias,
      treinoFim: testeIni,
      testeIni,
      testeFim: testeIni + testeDias,
    });
    testeIni += testeDias;
  }
  return dobras;
}

/** O que a escolha de parâmetro devolve: o parâmetro e como ele foi no treino. */
export interface Escolha<P> {
  params: P;
  /** Retorno do PERÍODO de treino, em %, com esses parâmetros. */
  resultadoPct: number;
}

export interface ResultadoDobra<P> {
  dobra: Dobra;
  params: P;
  /** Retorno do período de treino, em %. */
  dentroPct: number;
  /** Retorno do período de teste, em %, com os MESMOS parâmetros. */
  foraPct: number;
  /** As duas taxas acima normalizadas por dia — ver `porDia`. */
  dentroPorDia: number;
  foraPorDia: number;
}

export interface WalkForward<P> {
  dobras: ResultadoDobra<P>[];
  /** Dobras que a função de avaliação não conseguiu medir (número não-finito). */
  dobrasIlegiveis: number;
  /** Taxa diária média DENTRO da amostra. `null` sem dobra legível. */
  dentroPorDia: number | null;
  /** Taxa diária média FORA. É o número que vale. */
  foraPorDia: number | null;
  /**
   * Retorno FORA composto ao longo de todas as fatias de teste, em %.
   * Composto, não somado: as fatias são consecutivas no tempo.
   */
  foraCompostoPct: number | null;
  /** `foraPorDia − dentroPorDia`, em pontos de taxa diária. */
  degradacaoPorDia: number | null;
  /** Quantas dobras deram retorno positivo fora. */
  dobrasPositivas: number;
  /** Fração de dobras positivas fora — 0 a 1. `null` sem dobra legível. */
  consistencia: number | null;
  /** `dobras.length >= MIN_DOBRAS`. Abaixo disto nada é conclusivo. */
  suficiente: boolean;
}

/**
 * Converte o retorno de um período para taxa por dia, geometricamente.
 *
 * ⚠️ POR QUE NORMALIZAR. O treino é mais longo que o teste (é o desenho: você
 * aprende em muito e testa em pouco). Comparar "+9% em 360 dias" com "+2% em 90
 * dias" pelo número cru diz que o treino foi 4,5× melhor, quando as duas taxas
 * são quase iguais. Sem esta conversão, TODA leitura de degradação seria um
 * artefato do tamanho das janelas.
 *
 * ⚠️ E É GEOMÉTRICA, não divisão. Retorno compõe; dividir por dias trataria
 * −50% em 100 dias como −0,5%/dia, que ao compor daria −39%, não −50%.
 *
 * Perda total (−100%) devolve `null`: não existe taxa diária que leve a zero em
 * tempo finito, e devolver `-Infinity` contaminaria toda média adiante.
 */
export function porDia(retornoPct: number, dias: number): number | null {
  if (!Number.isFinite(retornoPct) || !(dias > 0)) return null;
  const fator = 1 + retornoPct / 100;
  if (!(fator > 0)) return null;
  return (Math.pow(fator, 1 / dias) - 1) * 100;
}

/**
 * Roda o walk-forward.
 *
 * ⚠️ `escolher` RECEBE SÓ A FATIA DE TREINO. Ele não recebe a série completa,
 * nem índices, nem a fatia de teste — não há como olhar o futuro sem mudar a
 * assinatura, e mudar a assinatura é uma decisão visível em revisão. Esta é a
 * única razão de o módulo existir; se ela fosse um pedido em prosa, o módulo
 * seria só um laço com nome bonito.
 *
 * ⚠️ DOBRA ILEGÍVEL NÃO VIRA ZERO. Se a avaliação devolve um número não-finito
 * (dados faltando, série curta demais, divisão degenerada), a dobra é
 * DESCARTADA e contada em `dobrasIlegiveis`. Tratar como 0% seria gravar
 * "mediu e deu neutro" onde o correto é "não mediu" — invariante nº 6.
 */
export function rodarWalkForward<T, P>(
  serie: readonly T[],
  escolher: (treino: readonly T[]) => Escolha<P>,
  avaliar: (params: P, teste: readonly T[]) => number,
  opts: OpcoesDobras,
): WalkForward<P> {
  const dobras = montarDobras(serie.length, opts);
  const out: ResultadoDobra<P>[] = [];
  let ilegiveis = 0;

  for (const d of dobras) {
    const treino = serie.slice(d.treinoIni, d.treinoFim);
    const teste = serie.slice(d.testeIni, d.testeFim);

    let escolha: Escolha<P>;
    let fora: number;
    try {
      escolha = escolher(treino);
      fora = avaliar(escolha.params, teste);
    } catch {
      ilegiveis++;
      continue;
    }

    const dentroPD = porDia(escolha.resultadoPct, treino.length);
    const foraPD = porDia(fora, teste.length);
    if (!Number.isFinite(escolha.resultadoPct) || !Number.isFinite(fora)
        || dentroPD === null || foraPD === null) {
      ilegiveis++;
      continue;
    }

    out.push({
      dobra: d, params: escolha.params,
      dentroPct: escolha.resultadoPct, foraPct: fora,
      dentroPorDia: dentroPD, foraPorDia: foraPD,
    });
  }

  if (out.length === 0) {
    return {
      dobras: out, dobrasIlegiveis: ilegiveis,
      dentroPorDia: null, foraPorDia: null, foraCompostoPct: null,
      degradacaoPorDia: null, dobrasPositivas: 0, consistencia: null,
      suficiente: false,
    };
  }

  const media = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const dentroPD = media(out.map((r) => r.dentroPorDia));
  const foraPD = media(out.map((r) => r.foraPorDia));

  // Composto, não somado: as fatias de teste são consecutivas no tempo, então o
  // capital que sai de uma entra na seguinte. Somar +10% e +10% daria 20% onde
  // o dinheiro fez 21%.
  const foraComposto = (out.reduce((f, r) => f * (1 + r.foraPct / 100), 1) - 1) * 100;
  const positivas = out.filter((r) => r.foraPct > 0).length;

  return {
    dobras: out,
    dobrasIlegiveis: ilegiveis,
    dentroPorDia: dentroPD,
    foraPorDia: foraPD,
    foraCompostoPct: Number.isFinite(foraComposto) ? foraComposto : null,
    degradacaoPorDia: foraPD - dentroPD,
    dobrasPositivas: positivas,
    consistencia: positivas / out.length,
    suficiente: out.length >= MIN_DOBRAS,
  };
}

/**
 * O veredito de um walk-forward, no vocabulário do laboratório.
 *
 * ⚠️ DEGRADAÇÃO NÃO É REPROVAÇÃO. Cair de 18% para 12% é o retrato de uma
 * estratégia viva: o treino sempre favorece quem o escolheu. Cair de 18% para
 * −2% é o ajuste morrendo ao ar livre. A régua olha o SINAL do resultado fora e
 * a CONSISTÊNCIA entre dobras — não o tamanho da queda.
 *
 * ⚠️ E CONSISTÊNCIA É EXIGIDA JUNTO COM O SINAL. Uma dobra enorme carregando
 * cinco negativas dá média positiva e não é estratégia: é uma janela de sorte
 * cercada de perdas. Metade das dobras positivas é o piso — abaixo disso o
 * número positivo é notícia sobre UMA janela, não sobre a regra.
 */
export function vereditoWalkForward<P>(
  wf: WalkForward<P>,
): { status: "verde" | "morta" | "empate" | "inconclusiva"; texto: string } {
  if (wf.dobras.length === 0) {
    return {
      status: "inconclusiva",
      texto: `nenhuma dobra legível (${wf.dobrasIlegiveis} descartada(s)) — série curta `
        + "demais para treino + teste, ou a avaliação não conseguiu medir",
    };
  }
  const n = wf.dobras.length;
  const fora = wf.foraPorDia ?? 0;
  const dentro = wf.dentroPorDia ?? 0;
  const cons = wf.consistencia ?? 0;
  const base = `${n} dobra(s) · dentro ${dentro.toFixed(4)}%/dia · fora `
    + `${fora.toFixed(4)}%/dia · ${wf.dobrasPositivas}/${n} positivas`;

  if (!wf.suficiente) {
    return {
      status: "inconclusiva",
      texto: `${base} — abaixo do piso de ${MIN_DOBRAS} dobras. Uma ou duas dobras não são `
        + "walk-forward: são um backtest com nome novo.",
    };
  }
  if (fora <= 0) {
    return {
      status: "morta",
      texto: `${base} — fora da amostra é NEGATIVO. O que o treino encontrou não sobreviveu `
        + "ao ar livre.",
    };
  }
  if (cons < 0.5) {
    return {
      status: "empate",
      texto: `${base} — positivo na média e positivo em MENOS DE METADE das dobras. Média `
        + "puxada por poucas janelas boas é notícia sobre elas, não sobre a regra.",
    };
  }
  return {
    status: "verde",
    texto: `${base} — positivo fora da amostra e em pelo menos metade das dobras. `
      + `Degradação de ${(wf.degradacaoPorDia ?? 0).toFixed(4)} ponto(s) por dia é esperada: `
      + "o treino sempre favorece quem o escolheu.",
  };
}
