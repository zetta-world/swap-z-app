/**
 * A POSIÇÃO DO CELEIRO — abrir, acompanhar, fechar, e anotar ONDE foi o dinheiro.
 *
 * ⚠️⚠️ POR QUE ESTE MÓDULO PRECISOU EXISTIR (21/08).
 *
 * Os agentes tinham `decidir()`, `deveCotar()`, `portaoDeSobrevivencia()` — o
 * **"devo?"**. Nenhum tinha o **"faz e anota"**. Eram cabeça sem mão: código
 * que julga e não opera, importado por nada além dos próprios testes. Chamar
 * aquilo de agente construído foi vender demais.
 *
 * ⚠️ A INVARIANTE QUE MANDA AQUI: a soma dos lançamentos de uma posição TEM de
 * bater com o dinheiro que ela realmente moveu. Se `taxa + derrapagem + preco`
 * não reproduz o P&L, a decomposição vira decoração — e o Investigador
 * raciocinaria sobre uma conta que não fecha, que é pior que não ter conta.
 * `conferir()` existe para isso e o teste a exercita nos dois lados.
 */

/** Cada perna de corretagem, em % do nocional. */
export const TAXA_POR_PERNA_PCT = Number(process.env.CELEIRO_TAXA_PERNA_PCT ?? 0.1125);

export type Lado = "buy" | "sell";

export interface Abertura {
  agente: string;
  simbolo: string;
  lado: Lado;
  /** Nocional em USD — o tamanho que passou pelo portão de profundidade. */
  usd: number;
  precoEntrada: number;
  alvo: number;
  stop: number;
  /** Quanto a profundidade encareceu, em % — vem do portão. */
  derrapagemPct: number;
  /** Depois disto a posição fecha por tempo, custe o que custar. */
  horasLimite: number;
  /**
   * Quantas vezes o NOCIONAL excede a margem. 1 = sem alavanca.
   *
   * ⚠️ É daqui que sai a liquidação: um movimento contrário de 100/alavanca %
   * zera a margem. Sem este campo a posição alavancada era imortal — e o
   * `aposentaQuando` do Alavancado de Tendência fala em "uma liquidação apagar
   * o ganho de semanas", condição que nunca poderia disparar.
   */
  alavanca?: number;
}

/** Um lançamento a gravar: causa e valor assinado. */
export interface Lancamento {
  causa: "taxa" | "derrapagem" | "preco";
  usdt: number;
}

/**
 * Os lançamentos da ABERTURA — uma perna de corretagem e a derrapagem medida.
 *
 * ⚠️ SÓ UMA PERNA AQUI. A outra sai no fechamento. Cobrar as duas na entrada
 * faria toda posição viva parecer pior do que é, e uma posição que ainda não
 * fechou não pagou a saída.
 *
 * ⚠️ A DERRAPAGEM É LINHA PRÓPRIA, nunca embutida no preço de entrada. Embutir
 * esconderia a causa: o extrato diria "o preço andou contra" quando o que houve
 * foi o livro cobrar caro. Foi não separar causas que impediu a arena antiga de
 * explicar como uma mesa acerta 70% e perde dinheiro.
 */
export function lancamentosDaAbertura(a: Abertura): Lancamento[] {
  const out: Lancamento[] = [
    { causa: "taxa", usdt: -(a.usd * TAXA_POR_PERNA_PCT / 100) },
  ];
  if (a.derrapagemPct > 0) {
    out.push({ causa: "derrapagem", usdt: -(a.usd * a.derrapagemPct / 100) });
  }
  return out;
}

export type MotivoDeSaida = "alvo" | "stop" | "tempo" | "liquidacao";

export interface Fechamento {
  precoSaida: number;
  motivo: MotivoDeSaida;
}

/**
 * O movimento de preço da posição, em % — assinado pelo LADO.
 *
 * ⚠️ VENDIDO GANHA QUANDO CAI. Usar sempre `(saida−entrada)` inverteria o sinal
 * de toda posição vendida, e o extrato mostraria lucro como prejuízo. O
 * Investigador então proporia mutações para consertar um vazamento que não
 * existe — e o A/B mediria a mudança errada.
 */
export function movimentoPct(lado: Lado, precoEntrada: number, precoSaida: number): number {
  if (!(precoEntrada > 0) || !(precoSaida > 0)) return 0;
  const bruto = (precoSaida - precoEntrada) / precoEntrada * 100;
  return lado === "buy" ? bruto : -bruto;
}

/** Os lançamentos do FECHAMENTO: o movimento e a segunda perna. */
export function lancamentosDoFechamento(a: Abertura, f: Fechamento): Lancamento[] {
  const mov = movimentoPct(a.lado, a.precoEntrada, f.precoSaida);
  return [
    { causa: "preco", usdt: a.usd * mov / 100 },
    { causa: "taxa", usdt: -(a.usd * TAXA_POR_PERNA_PCT / 100) },
  ];
}

/**
 * A posição deve fechar agora?
 *
 * ⚠️ STOP É CONFERIDO ANTES DO ALVO. Numa vela que tocou os dois, assumir o alvo
 * seria contar como ganho um caminho que pode ter passado pelo stop primeiro —
 * o viés otimista clássico de backtest, que infla resultado sem nenhum erro
 * aparecer. Na dúvida, o pior caso.
 */
export function deveFechar(
  a: Abertura,
  precoAtual: number,
  horasAbertas: number,
): Fechamento | null {
  if (!(precoAtual > 0)) return null;

  /**
   * ⚠️⚠️ A LIQUIDAÇÃO SÓ PRECEDE O STOP SE ESTIVER MAIS PERTO DA ENTRADA.
   *
   * Aqui a regra é o CONTRÁRIO da de alvo-vs-stop logo abaixo. Lá, uma vela que
   * tocou os dois é ambígua e assumimos o pior. Aqui não há ambiguidade: o stop
   * é uma ordem no livro, e se ele está mais perto, o preço passou por ele
   * ANTES de chegar na liquidação. Reportar liquidação nesse caso inventaria
   * perda de margem inteira onde houve perda de stop.
   *
   * Com alavanca de 10× a liquidação fica a 10% e o stop a ~2%: o stop ganha
   * sempre, e é assim que tem que ser. A liquidação existe para quando a conta
   * da alavanca e a do stop se cruzarem — aí ela é o desfecho verdadeiro.
   */
  const vezes = a.alavanca ?? 1;
  if (vezes > 1) {
    /**
     * ⚠️⚠️ A LIQUIDAÇÃO VEM ANTES DOS 100/ALAVANCA %, E A TAXA É O MOTIVO.
     *
     * O ingênuo é "10× liquida a 10%". Mas 10% do nocional é a margem INTEIRA,
     * e as duas pernas de corretagem ainda seriam cobradas por cima — a conta
     * fecharia em −$204,50 contra uma margem de $200, e a banca ficaria
     * devendo. Corretora nenhuma permite isso: elas liquidam antes, exatamente
     * para caber a taxa.
     *
     * Com a derrapagem entrando junto, a perda da liquidação é EXATAMENTE a
     * margem — nunca um centavo a mais. O teste trava esse valor.
     */
    const fracaoAdversa =
      1 / vezes
      - (TAXA_POR_PERNA_PCT * 2) / 100
      - Math.max(0, a.derrapagemPct) / 100;
    const precoDeLiquidacao = a.lado === "buy"
      ? a.precoEntrada * (1 - fracaoAdversa)
      : a.precoEntrada * (1 + fracaoAdversa);
    const liquidaAntes =
      Math.abs(precoDeLiquidacao - a.precoEntrada) < Math.abs(a.stop - a.precoEntrada);
    if (liquidaAntes) {
      const tocou = a.lado === "buy"
        ? precoAtual <= precoDeLiquidacao
        : precoAtual >= precoDeLiquidacao;
      if (tocou) return { precoSaida: precoDeLiquidacao, motivo: "liquidacao" };
    }
  }

  const tocouStop = a.lado === "buy" ? precoAtual <= a.stop : precoAtual >= a.stop;
  if (tocouStop) return { precoSaida: a.stop, motivo: "stop" };

  const tocouAlvo = a.lado === "buy" ? precoAtual >= a.alvo : precoAtual <= a.alvo;
  if (tocouAlvo) return { precoSaida: a.alvo, motivo: "alvo" };

  /**
   * ⚠️ POR TEMPO SAI NO PREÇO CORRENTE, não no alvo nem no stop. É o único dos
   * três em que o preço de saída não foi escolhido por nós — e fingir o
   * contrário inventaria resultado.
   */
  if (horasAbertas >= a.horasLimite) return { precoSaida: precoAtual, motivo: "tempo" };
  return null;
}

/**
 * Confere que a decomposição reproduz o dinheiro movido.
 *
 * ⚠️⚠️ É A GUARDA DA CONTABILIDADE INTEIRA. Se a soma das causas não bate com o
 * P&L real, o extrato mente — e tudo que se apoia nele (ranking, comparação com
 * o controle, o Investigador) passa a raciocinar sobre ficção. Vale quebrar o
 * agente em vez de gravar uma conta que não fecha.
 */
export function conferir(a: Abertura, f: Fechamento): {
  bate: boolean; somaDosLancamentos: number; esperado: number; porque: string;
} {
  const lancs = [...lancamentosDaAbertura(a), ...lancamentosDoFechamento(a, f)];
  const somaDosLancamentos = lancs.reduce((s, l) => s + l.usdt, 0);

  const mov = movimentoPct(a.lado, a.precoEntrada, f.precoSaida);
  const esperado = a.usd * mov / 100
    - a.usd * (TAXA_POR_PERNA_PCT * 2) / 100
    - a.usd * Math.max(0, a.derrapagemPct) / 100;

  const bate = Math.abs(somaDosLancamentos - esperado) < 1e-9;
  return {
    bate, somaDosLancamentos, esperado,
    porque: bate
      ? "a decomposição reproduz o dinheiro movido"
      : `soma ${somaDosLancamentos.toFixed(8)} ≠ esperado ${esperado.toFixed(8)} — `
        + "o extrato mentiria e tudo que se apoia nele raciocinaria sobre ficção",
  };
}
