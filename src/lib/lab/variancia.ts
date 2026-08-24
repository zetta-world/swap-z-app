/**
 * PRÊMIO DE RISCO DE VARIÂNCIA — o que se ganha VENDENDO volatilidade.
 *
 * ⚠️⚠️ A HIPÓTESE DO MAPA ESTÁ MAL FORMULADA, E ESTE ARQUIVO EXISTE POR ISSO.
 *
 * O registro diz: "IV do BTC roda 50-80% ao ano contra 15-20% do S&P — é o
 * prêmio mais gordo e estruturalmente persistente deste mercado".
 *
 * Isso compara o PREÇO do seguro, não o lucro de vendê-lo. Quem vende opção não
 * ganha a IV: ganha **IV menos a volatilidade que de fato aconteceu**. BTC com
 * IV 60% realizando 55% embolsa 5 pontos. S&P com IV 18% realizando 13%
 * embolsa os mesmos 5.
 *
 * A gordura é PROPORCIONAL. A borda pode não ser maior — só está denominada num
 * número maior. É "bruto × líquido" de novo, na variável mais fácil de
 * confundir do mapa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AQUI A MEDIANA MENTE, E É A INVERSÃO DE TUDO QUE ESTE LABORATÓRIO FEZ.
 *
 * Venda de volatilidade tem mediana positiva quase sempre — na maioria das
 * janelas o prêmio entra inteiro. A MÉDIA é arrastada pelas poucas explosões.
 *
 * Em todo o resto do repo eu briguei PELA mediana contra a média, e `stats.ts`
 * nasceu de um erro de mediana. Aqui é ao contrário: reportar a mediana seria
 * repetir aquele erro invertido. O que decide é a MÉDIA, com a cauda ao lado —
 * e a mediana aparece só para mostrar o tamanho da diferença entre as duas,
 * que é a própria assimetria do negócio.
 */
import type { LabStatus } from "./registry";

/**
 * Volatilidade realizada anualizada, de retornos logarítmicos diários.
 *
 * ⚠️ NÃO É O ATR QUE JÁ EXISTE. `calcATR` mede amplitude média verdadeira —
 * quanto o preço ANDA dentro do dia. Volatilidade é o desvio padrão dos
 * RETORNOS, que é a grandeza que a opção precifica. Usar ATR aqui daria um
 * número com a mesma unidade e significado diferente, que é o pior tipo de
 * substituição.
 *
 * ⚠️ SEM MÉDIA SUBTRAÍDA, de propósito. A convenção de precificação de opção
 * (e do próprio DVOL) é desvio em torno de ZERO, não da média amostral. Subtrair
 * a média da janela embutiria a tendência do período na medida de risco e
 * deixaria a comparação contra a implícita torta — para menos, sempre.
 */
export function volRealizadaAnualPct(fechamentos: number[]): number | null {
  if (fechamentos.length < 3) return null;
  const logs: number[] = [];
  for (let i = 1; i < fechamentos.length; i++) {
    const a = fechamentos[i - 1], b = fechamentos[i];
    if (!(a > 0) || !(b > 0)) continue;
    logs.push(Math.log(b / a));
  }
  if (logs.length < 2) return null;
  const soma2 = logs.reduce((s, r) => s + r * r, 0);
  return Math.sqrt(soma2 / logs.length) * Math.sqrt(365) * 100;
}

export interface PontoVrp {
  /** Dia UTC em que a implícita foi observada. */
  dia: string;
  /** DVOL daquele dia — o que o mercado cobrava por 30 dias de seguro. */
  implicitaPct: number;
  /** O que de fato aconteceu nos 30 dias SEGUINTES. */
  realizadaPct: number;
  /** implícita − realizada. Positivo = quem vendeu ganhou. */
  vrpPct: number;
}

/**
 * ⚠️⚠️ O ALINHAMENTO É PARA A FRENTE, e errar isso dá um número plausível.
 *
 * DVOL do dia D é a implícita de 30 dias: ela prevê D..D+30. Comparar com a
 * realizada de D−30..D confrontaria previsão com passado — mede a persistência
 * da volatilidade, não o prêmio de quem vendeu.
 *
 * É a mesma armadilha do alinhamento por posição da Fase 4.5, com outra roupa:
 * as duas séries existem, as duas se sobrepõem, e casá-las errado não levanta
 * nenhum erro.
 *
 * ⚠️ E OS ÚLTIMOS `janelaDias` NÃO TÊM RESPOSTA AINDA. Eles saem da conta em
 * vez de virar zero ou de reaproveitar dado curto: janela incompleta contada
 * como completa é exatamente como a medição de funding de 04/08 virou 1,4%.
 */
export function construirVrp(
  implicitaPorDia: Map<string, number>,
  fechamentoPorDia: Map<string, number>,
  janelaDias = 30,
): { pontos: PontoVrp[]; semFuturo: number } {
  const dias = [...fechamentoPorDia.keys()].sort();
  const indice = new Map(dias.map((d, i) => [d, i]));
  const pontos: PontoVrp[] = [];
  let semFuturo = 0;

  for (const [dia, iv] of [...implicitaPorDia.entries()].sort()) {
    const i = indice.get(dia);
    if (i == null) continue;
    const janela = dias.slice(i, i + janelaDias + 1);
    // Futuro incompleto não vira ponto — vira contagem declarada.
    if (janela.length < janelaDias + 1) { semFuturo++; continue; }
    const rv = volRealizadaAnualPct(janela.map((d) => fechamentoPorDia.get(d)!));
    if (rv == null) continue;
    pontos.push({
      dia, implicitaPct: iv, realizadaPct: rv,
      vrpPct: Number((iv - rv).toFixed(4)),
    });
  }
  return { pontos, semFuturo };
}

/**
 * ⚠️⚠️ JANELA NEGATIVA NÃO É EPISÓDIO NEGATIVO (09/08).
 *
 * A rodada de 09/08 devolveu 28,2% de janelas negativas — 245 dias de 870. Soa
 * como "quase um terço das vezes dá prejuízo", e não é isso.
 *
 * As doze piores janelas armazenadas eram 21/05, 22/05, 23/05 … 01/06:
 * consecutivas. Com janela de 30 dias deslizando dia a dia, UM mês ruim aparece
 * TRINTA vezes. Os 245 dias negativos são um punhado de episódios, não 245
 * eventos.
 *
 * É a inflação de amostra da Fase 4 pela terceira vez — lá o mesmo emissor em
 * seis cadeias, depois o mesmo mês contado trinta vezes na amostra, agora o
 * mesmo mês contado trinta vezes na FREQUÊNCIA. A fração continua sendo
 * reportada, porque ela responde "que parte do tempo o vendedor esteve
 * perdendo"; o episódio responde "quantas vezes isso começou", que é a pergunta
 * de quem precisa aguentar o tranco.
 *
 * Corridas consecutivas na série ORDENADA por dia. Um dia positivo no meio
 * quebra o episódio de propósito: emendar por cima de uma trégua inventaria um
 * evento contínuo que não houve.
 */
export function contarEpisodios(pontos: PontoVrp[], negativo = true): number {
  const ordenados = [...pontos].sort((a, b) => a.dia.localeCompare(b.dia));
  let episodios = 0, dentro = false;
  for (const p of ordenados) {
    const bate = negativo ? p.vrpPct < 0 : p.vrpPct >= 0;
    if (bate && !dentro) episodios++;
    dentro = bate;
  }
  return episodios;
}

/**
 * As N piores janelas da série INTEIRA.
 *
 * ⚠️ EXISTE PORQUE A TELA MENTIA (09/08). A rota guardava `pontos.slice(-120)`
 * — os últimos 120 dias — e o painel ordenava ESSE recorte por prêmio,
 * anunciando "as 30 PIORES janelas, não as últimas". Eram as 30 piores DOS
 * ÚLTIMOS 120: a pior armazenada era −10,6 e a pior de verdade, −46,1, nunca
 * chegava à tela.
 *
 * Numa fase cujo argumento inteiro é "a cauda é o que decide", eu construí a
 * tela que esconde a cauda. Recorte por recência com rótulo de recorte por
 * severidade é a mesma família de "dois estados, uma aparência" — só que aqui o
 * estado escondido é justamente o que o painel diz mostrar.
 */
export function pioresJanelas(pontos: PontoVrp[], n = 40): PontoVrp[] {
  return [...pontos].sort((a, b) => a.vrpPct - b.vrpPct).slice(0, n);
}

export interface ResumoVrp {
  n: number;
  /** ⚠️ O QUE DECIDE. Ver a nota do topo: aqui a média manda, não a mediana. */
  mediaPct: number;
  /** Só para mostrar o tamanho da assimetria contra a média. */
  medianaPct: number;
  /** Fração de janelas em que quem vendeu PERDEU. */
  fracaoNegativa: number;
  /**
   * ⚠️ QUANTAS VEZES A SANGRIA COMEÇOU — ver `contarEpisodios`. Com janelas
   * sobrepostas, a fração conta o mesmo mês ruim trinta vezes; o episódio conta
   * uma. As duas respondem perguntas diferentes e as duas saem.
   */
  episodiosNegativos: number;
  /** A pior janela — a cauda que decide se dá para segurar a posição. */
  piorPct: number;
  /** A média das 5% piores. Uma cauda só pode ser sorte; a cauda inteira, não. */
  cauda5Pct: number;
  implicitaMediaPct: number;
  realizadaMediaPct: number;
}

export function resumirVrp(pontos: PontoVrp[]): ResumoVrp | null {
  if (pontos.length === 0) return null;
  const vs = pontos.map((p) => p.vrpPct).sort((a, b) => a - b);
  const n = vs.length;
  const media = vs.reduce((s, v) => s + v, 0) / n;
  const mediana = n % 2 ? vs[(n - 1) / 2] : (vs[n / 2 - 1] + vs[n / 2]) / 2;
  /**
   * ⚠️ PELO MENOS UM PONTO NA CAUDA. Com n pequeno, `ceil(n*0.05)` pode dar 0 e
   * a média de lista vazia vira NaN — que na tela viraria "—" e passaria por
   * "sem cauda", quando o certo é "a pior que existe".
   */
  const k = Math.max(1, Math.ceil(n * 0.05));
  const cauda = vs.slice(0, k);
  return {
    n,
    mediaPct: Number(media.toFixed(4)),
    medianaPct: Number(mediana.toFixed(4)),
    fracaoNegativa: vs.filter((v) => v < 0).length / n,
    episodiosNegativos: contarEpisodios(pontos),
    piorPct: vs[0],
    cauda5Pct: Number((cauda.reduce((s, v) => s + v, 0) / cauda.length).toFixed(4)),
    implicitaMediaPct: Number((pontos.reduce((s, p) => s + p.implicitaPct, 0) / n).toFixed(2)),
    realizadaMediaPct: Number((pontos.reduce((s, p) => s + p.realizadaPct, 0) / n).toFixed(2)),
  };
}

/**
 * ⚠️ PISO DE JANELAS INDEPENDENTES, não de pontos.
 *
 * Janelas diárias de 30 dias se sobrepõem 29/30: 300 pontos contêm ~10 janelas
 * independentes. Contar 300 como amostra seria a inflação de amostra da Fase 4
 * outra vez — lá era o mesmo emissor em seis cadeias, aqui é o mesmo mês contado
 * trinta vezes.
 */
export function janelasIndependentes(n: number, janelaDias = 30): number {
  return Math.floor(n / janelaDias);
}

export const MIN_JANELAS_INDEPENDENTES = 8;

export interface VereditoVrp {
  readable: boolean;
  status: LabStatus;
  verdict: string;
}

export function vereditoVrp(r: ResumoVrp | null, janelaDias = 30): VereditoVrp {
  if (!r) {
    return {
      readable: false, status: "inconclusiva",
      verdict: "nenhuma janela com implícita E futuro completo — inconclusivo, que não é "
        + "o mesmo que reprovado.",
    };
  }
  const indep = janelasIndependentes(r.n, janelaDias);
  const base = `${r.n} janelas diárias ≈ ${indep} independentes · implícita média `
    + `${r.implicitaMediaPct.toFixed(1)}% contra realizada ${r.realizadaMediaPct.toFixed(1)}%`;

  if (indep < MIN_JANELAS_INDEPENDENTES) {
    return {
      readable: false, status: "inconclusiva",
      verdict: `${base} — só ${indep} janelas independentes, abaixo do piso de `
        + `${MIN_JANELAS_INDEPENDENTES}. Janelas diárias de ${janelaDias} dias se sobrepõem `
        + `${janelaDias - 1}/${janelaDias}: contar as ${r.n} como amostra seria contar o mesmo `
        + "mês trinta vezes. INCONCLUSIVO.",
    };
  }

  /**
   * ⚠️ A MÉDIA JULGA, e a mediana entra só para expor a assimetria. Ver a nota
   * do topo: é a inversão deliberada da regra do resto do laboratório.
   */
  const assimetria = r.medianaPct - r.mediaPct;
  const nota = `média ${r.mediaPct.toFixed(2)} ponto${Math.abs(r.mediaPct) === 1 ? "" : "s"}`
    + ` · mediana ${r.medianaPct.toFixed(2)} (${assimetria > 0 ? "+" : ""}${assimetria.toFixed(2)} `
    + `de diferença — é a cauda puxando a média para baixo) · pior janela `
    + `${r.piorPct.toFixed(2)} · média das 5% piores ${r.cauda5Pct.toFixed(2)} · `
    + `${Math.round(r.fracaoNegativa * 100)}% das janelas deram prejuízo, mas em apenas `
    + `${r.episodiosNegativos} EPISÓDIO${r.episodiosNegativos === 1 ? "" : "S"} distinto`
    + `${r.episodiosNegativos === 1 ? "" : "s"} — com janela deslizante, um mês ruim aparece `
    + "trinta vezes";

  if (r.mediaPct <= 0) {
    return {
      readable: true, status: "morta",
      verdict: `${base} — o prêmio de variância é ${r.mediaPct.toFixed(2)}: vender volatilidade `
        + `NÃO paga neste histórico, por mais gorda que a implícita pareça. ${nota}`,
    };
  }
  return {
    readable: true, status: "verde",
    verdict: `${base} — o prêmio existe: ${nota}. ⚠️ Isto mede o PRÊMIO, não a estratégia: `
      + "o custo de execução da opção e o teto de alta da coberta ainda não entraram.",
  };
}
