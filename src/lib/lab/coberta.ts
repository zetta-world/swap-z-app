/**
 * CALL COBERTA — Fase 5.2, e ela NÃO é medição.
 *
 * ⚠️⚠️ O PRÊMIO É MODELADO, NÃO OBSERVADO. Isto muda o que a fase pode afirmar.
 *
 * A 5.1 mediu o prêmio de variância com dado real: DVOL contra volatilidade
 * realizada, 870 janelas, +5,70 pontos. Aqui não dá para fazer o mesmo: DVOL é
 * ÍNDICE, não livro, e não existe histórico gratuito de preço de opção. Então a
 * call é precificada por Black-Scholes com a implícita observada.
 *
 * Preço de modelo não é preço de mercado. O que sai daqui é SIMULAÇÃO, e a
 * palavra tem que aparecer na tela — a mesma regra que separou "gás medido" de
 * "unidades declaradas" na Fase 4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ PARA QUE LADO O ERRO DO MODELO APONTA — porque declarar "é modelo" sem
 * dizer a direção é declarar metade.
 *
 * 1. SORRISO. Usamos a implícita DO DINHEIRO (DVOL) para strikes FORA do
 *    dinheiro. No BTC, call fora do dinheiro costuma negociar com implícita
 *    MAIOR que a do dinheiro. Então o prêmio simulado é MENOR que o de mercado:
 *    o erro é CONSERVADOR para a coberta.
 *
 * 2. CAUDA. Black-Scholes assume lognormal, e o BTC não é: a cauda de alta é
 *    mais gorda que o modelo supõe. Para quem VENDE call, essa é exatamente a
 *    cauda que dói. O modelo, portanto, SUBESTIMA o risco — erro OTIMISTA para
 *    a coberta.
 *
 * Os dois erros apontam para lados opostos e não se cancelam de forma
 * conhecida. Por isso o resultado só pode ser lido como ORDEM DE GRANDEZA, e o
 * veredito recusa aprovar por margem estreita.
 *
 * ⚠️ E O QUE NÃO É MODELO: o retorno do BTC vem das velas reais. "Quantas vezes
 * o BTC subiu mais que o teto" é MEDIDO, e é o lado da conta que mais decide.
 */
import type { LabStatus } from "./registry";

/**
 * Distribuição normal acumulada — aproximação de Abramowitz-Stegun 26.2.17.
 * Erro < 7.5e-8, muito abaixo do que a incerteza do próprio modelo justifica.
 */
export function normalCdf(x: number): number {
  const sinal = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sinal * y);
}

/**
 * Preço de uma call europeia, Black-Scholes, em FRAÇÃO do preço à vista.
 *
 * ⚠️ TAXA LIVRE DE RISCO ZERO, declarada. Opção de 30 dias com juro de ~4% muda
 * o prêmio na terceira casa; embutir uma taxa daria falsa precisão a um número
 * que já é de modelo. Zero é escolha, não esquecimento.
 */
export function precoCall(
  spot: number, strike: number, volAnual: number, anos: number,
): number {
  if (!(spot > 0) || !(strike > 0) || !(volAnual > 0) || !(anos > 0)) return 0;
  const sig = volAnual * Math.sqrt(anos);
  const d1 = (Math.log(spot / strike) + (sig * sig) / 2) / sig;
  const d2 = d1 - sig;
  return (spot * normalCdf(d1) - strike * normalCdf(d2)) / spot;
}

/**
 * Os strikes, em fração do preço à vista.
 *
 * ⚠️ DECLARADOS ANTES DE VER O RESULTADO. Escolher o strike olhando qual saiu
 * melhor é fitar — e seria o mesmo defeito da sonda de orderbook que só media a
 * "melhor oportunidade aparente" e produziu 4.085 medições enviesadas.
 */
export const STRIKES = [1.0, 1.05, 1.1, 1.2] as const;

export interface JanelaCoberta {
  dia: string;
  /** Retorno de SEGURAR a moeda na janela, em %. É o denominador. */
  segurarPct: number;
  /** Prêmio recebido, em % do capital. MODELADO. */
  premioPct: number;
  /** Teto: acima disso o ganho é entregue. */
  tetoPct: number;
  /** Retorno da coberta = min(segurar, teto) + prêmio. */
  cobertaPct: number;
  /** A moeda passou do teto? Então a call foi exercida. */
  exercida: boolean;
}

/**
 * ⚠️ A CONTA, e ela é a definição da estratégia — não uma aproximação.
 *
 * Coberta = você TEM a moeda e VENDEU o direito de comprá-la ao teto. Se a
 * moeda fecha abaixo do teto, você fica com a moeda e com o prêmio. Se fecha
 * acima, entrega ao teto: o ganho para de subir ali, e o prêmio continua seu.
 *
 * `min(segurar, teto) + prêmio` é exatamente isso. Medir só o prêmio — o erro
 * que o Mapa do Lucro convidava — seria medir uma call DESCOBERTA e chamar de
 * coberta.
 */
export function janelaCoberta(
  dia: string, spot0: number, spotT: number, volAnual: number,
  strikeFrac: number, anos: number,
): JanelaCoberta {
  const segurarPct = ((spotT - spot0) / spot0) * 100;
  const tetoPct = (strikeFrac - 1) * 100;
  const premioPct = precoCall(spot0, spot0 * strikeFrac, volAnual, anos) * 100;
  return {
    dia, segurarPct, premioPct, tetoPct,
    cobertaPct: Number((Math.min(segurarPct, tetoPct) + premioPct).toFixed(4)),
    exercida: segurarPct > tetoPct,
  };
}

export interface ResumoCoberta {
  strikeFrac: number;
  n: number;
  /** ⚠️ A MÉDIA JULGA. Ver a nota do topo de `variancia.ts`: a mediana mente. */
  cobertaMediaPct: number;
  segurarMediaPct: number;
  /** Quanto a coberta ganhou (ou perdeu) contra segurar, em pontos. */
  vantagemPct: number;
  cobertaMedianaPct: number;
  segurarMedianaPct: number;
  /** Fração de janelas em que a coberta bateu segurar. */
  fracaoGanhou: number;
  /** Fração em que a call foi exercida — o teto mordeu. */
  fracaoExercida: number;
  premioMedioPct: number;
  piorCobertaPct: number;
  piorSegurarPct: number;
  /**
   * ⚠️ O RETORNO DE SEGURAR, ANUALIZADO — o que revela o regime da janela e
   * torna o resultado legível. Ver `regimeDaJanela`.
   */
  segurarAnualPct: number;
}

function media(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }
function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function resumirCoberta(
  js: JanelaCoberta[], strikeFrac: number, janelaDias = 30,
): ResumoCoberta | null {
  if (js.length === 0) return null;
  const cob = js.map((j) => j.cobertaPct);
  const seg = js.map((j) => j.segurarPct);
  return {
    strikeFrac,
    n: js.length,
    cobertaMediaPct: Number(media(cob).toFixed(4)),
    segurarMediaPct: Number(media(seg).toFixed(4)),
    vantagemPct: Number((media(cob) - media(seg)).toFixed(4)),
    cobertaMedianaPct: Number(mediana(cob).toFixed(4)),
    segurarMedianaPct: Number(mediana(seg).toFixed(4)),
    fracaoGanhou: js.filter((j) => j.cobertaPct > j.segurarPct).length / js.length,
    fracaoExercida: js.filter((j) => j.exercida).length / js.length,
    premioMedioPct: Number(media(js.map((j) => j.premioPct)).toFixed(4)),
    piorCobertaPct: Math.min(...cob),
    piorSegurarPct: Math.min(...seg),
    // Extrapolação declarada: o retorno da janela repetido 365/janelaDias vezes.
    segurarAnualPct: Number((media(seg) * (365 / janelaDias)).toFixed(4)),
  };
}

/**
 * ⚠️⚠️ O REGIME DA JANELA — a ressalva que faltava na tela (09/08).
 *
 * A rodada de 09/08 deu vantagem POSITIVA nos quatro tetos, e o motivo não está
 * na estratégia: **SEGURAR rendeu +0,86% por janela de 30 dias**, ~10,5% ao
 * ano. Em 2,5 anos o BTC andou quase de lado.
 *
 * Coberta ganha de segurar POR CONSTRUÇÃO em mercado lateral: o teto quase não
 * morde e o prêmio entra inteiro. Num ciclo de alta forte a mesma conta inverte
 * — o teto passa a morder na maioria das janelas e o prêmio não cobre o que
 * ficou para trás.
 *
 * Sem isto na tela, `+0,62` é lido como constante da estratégia quando é
 * condicional ao mercado que a janela pegou. É a mesma família da janela curta
 * do funding: o número está certo e a leitura, não.
 *
 * ⚠️ OS LIMIARES SÃO PALPITE DECLARADO, como o de 35% de períodos negativos do
 * funding. 15% ao ano separa "andou de lado" de "subiu"; abaixo de zero é
 * queda. Não medi essas fronteiras — declarei.
 */
export type RegimeJanela = "queda" | "lateral" | "alta";

export function regimeDaJanela(segurarAnualPct: number): RegimeJanela {
  if (segurarAnualPct < 0) return "queda";
  return segurarAnualPct < 15 ? "lateral" : "alta";
}

export const REGIME_TEXTO: Record<RegimeJanela, string> = {
  queda: "mercado em QUEDA — a coberta amortece com o prêmio, mas não protege: "
    + "o teto não morde e o prejuízo da moeda vem inteiro",
  lateral: "mercado LATERAL — e é exatamente onde a coberta ganha POR CONSTRUÇÃO: "
    + "o teto quase não morde e o prêmio entra inteiro. Num ciclo de alta forte a "
    + "mesma conta inverte",
  alta: "mercado em ALTA — o teto morde com frequência, e é o regime mais duro "
    + "para a coberta. Vantagem positiva aqui vale mais que em mercado lateral",
};

export interface VereditoCoberta {
  readable: boolean;
  status: LabStatus;
  verdict: string;
}

/**
 * ⚠️ MARGEM MÍNIMA PARA APROVAR, e ela existe por causa do modelo.
 *
 * O prêmio é de Black-Scholes com a implícita do dinheiro. Dois erros conhecidos
 * apontam para lados opostos (sorriso subestima o prêmio; cauda subestima o
 * risco) e não se cancelam de forma conhecida. Aprovar por 0,2 ponto seria
 * afirmar precisão que a simulação não tem.
 *
 * Um ponto percentual na janela de 30 dias é palpite DECLARADO — como o limiar
 * de 35% de períodos negativos do funding — e existe para o veredito não virar
 * ruído de modelo.
 */
export const MARGEM_MINIMA_PCT = 1;

export function vereditoCoberta(
  rs: ResumoCoberta[], margem = MARGEM_MINIMA_PCT,
): VereditoCoberta {
  const validos = rs.filter((r) => r.n > 0);
  if (validos.length === 0) {
    return {
      readable: false, status: "inconclusiva",
      verdict: "nenhuma janela com implícita, preço inicial e preço final — inconclusivo.",
    };
  }
  const melhor = validos.reduce((a, b) => (b.vantagemPct > a.vantagemPct ? b : a));
  const teto = `${Math.round((melhor.strikeFrac - 1) * 100)}%`;
  const base = `melhor teto: +${teto} · coberta ${melhor.cobertaMediaPct.toFixed(2)}% contra `
    + `${melhor.segurarMediaPct.toFixed(2)}% de SEGURAR, em ${melhor.n} janelas de 30 dias`;

  /**
   * ⚠️ A MEDIANA APARECE PORQUE ELA DIZ O CONTRÁRIO — e é o ponto da fase.
   *
   * A coberta bate segurar na MAIORIA das janelas (toda vez que a moeda não
   * dispara) e perde na média, porque as poucas altas grandes pagam a conta
   * inteira. Um painel que mostrasse "ganhou em 78% das janelas" venderia a
   * estratégia com um número verdadeiro e enganoso.
   */
  const contraste = `ganhou em ${Math.round(melhor.fracaoGanhou * 100)}% das janelas `
    + `(mediana ${melhor.cobertaMedianaPct.toFixed(2)} contra ${melhor.segurarMedianaPct.toFixed(2)}) `
    + `— e mesmo assim a MÉDIA ${melhor.vantagemPct > 0 ? "sobe" : "cai"} `
    + `${Math.abs(melhor.vantagemPct).toFixed(2)} ponto${Math.abs(melhor.vantagemPct) === 1 ? "" : "s"}: `
    + `o teto mordeu em ${Math.round(melhor.fracaoExercida * 100)}% das vezes, e é nelas que a `
    + `conta se decide. Prêmio médio ${melhor.premioMedioPct.toFixed(2)}%`;

  /**
   * ⚠️ A RESSALVA DE REGIME ENTRA EM TODA SAÍDA, inclusive nas que reprovam.
   * Um resultado negativo em mercado de alta também é condicional — e alguém
   * lendo "reprovado" sem isso descartaria a estratégia pelo motivo errado.
   */
  const regime = regimeDaJanela(melhor.segurarAnualPct);
  const ressalvaRegime = ` ⚠️ CONDICIONAL AO REGIME: nesta janela SEGURAR rendeu `
    + `${melhor.segurarAnualPct.toFixed(1)}%/ano — ${REGIME_TEXTO[regime]}. `
    + `O teto mordeu em ${Math.round(melhor.fracaoExercida * 100)}% das janelas; `
    + "em outro regime essa fração muda, e com ela o resultado.";

  if (melhor.vantagemPct <= 0) {
    return {
      readable: true, status: "morta",
      verdict: `${base} — travar a alta custa MAIS que o prêmio recebido. ${contraste}. `
        + `⚠️ SIMULAÇÃO: o prêmio é de modelo, não de livro.${ressalvaRegime}`,
    };
  }
  if (melhor.vantagemPct < margem) {
    return {
      readable: false, status: "inconclusiva",
      verdict: `${base} — a vantagem é ${melhor.vantagemPct.toFixed(2)} ponto, abaixo da margem `
        + `de ${margem} exigida para um prêmio MODELADO. O sorriso subestima o prêmio e a cauda `
        + `subestima o risco, para lados opostos: aprovar aqui seria afirmar precisão que a `
        + `simulação não tem. INCONCLUSIVO. ${contraste}.${ressalvaRegime}`,
    };
  }
  return {
    readable: true, status: "verde",
    verdict: `${base} — a coberta bate segurar por ${melhor.vantagemPct.toFixed(2)} pontos. `
      + `${contraste}. ⚠️ SIMULAÇÃO: prêmio de Black-Scholes com a implícita do dinheiro, `
      + `não preço de livro — e o custo de execução continua fora da conta.${ressalvaRegime}`,
  };
}
