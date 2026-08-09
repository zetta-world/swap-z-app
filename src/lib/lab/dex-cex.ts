/**
 * DEX ↔ CEX — a última arbitragem do mapa, medida com a régua que matou a
 * primeira.
 *
 * ⚠️ POR QUE ESTA PODE SER DIFERENTE, e por que a suspeita não basta.
 *
 * A arbitragem CEX↔CEX foi reprovada por VELOCIDADE: o spread entre CEXes vive
 * milissegundos e a mesa olha a cada minuto. O DEX não tem esse problema — o
 * preço on-chain só muda quando um bloco fecha, então existe uma janela lenta
 * POR CONSTRUÇÃO.
 *
 * Só que "existe janela" e "sobra dinheiro na janela" são coisas diferentes, e
 * a segunda é a que esta fase mede.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ A MESMA RÉGUA DOS DOIS LADOS, E ELA JÁ REPROVOU UMA MESA.
 *
 * O lado CEX usa `vwapBuy`/`vwapSell` — o andador de livro que produziu as
 * 4.085 medições em que a borda teórica de +0,451% virou −0,629% real. O lado
 * DEX usa cotação da LI.FI para o MESMO notional, com taxa, impacto e gás
 * dentro.
 *
 * Isso não é detalhe de implementação. Se eu medisse o DEX com régua nova,
 * qualquer resultado positivo seria suspeito de vir da régua, não do mercado.
 *
 * ⚠️ E O QUE ESTA FASE NÃO RESPONDE: quem FICA com a borda. MEV compete no
 * mesmo bloco e chega antes por construção. Tudo aqui é TETO, não captura.
 */

import { vwapBuy, vwapSell, type Level } from "@/lib/zion/arb-realism";
import { median } from "@/lib/zion/stats";

/**
 * Taxa de tomador na CEX, em %. Palpite DECLARADO, na faixa do varejo sem tier.
 * O lado DEX não precisa disto: a taxa da poça já está dentro da cotação.
 */
export const TAXA_CEX_PCT = Number(process.env.DEXCEX_TAXA_CEX_PCT ?? 0.1);

/** Um preço executável — de qualquer lado, medido para o MESMO notional. */
export interface PrecoExecutavel {
  /** Preço médio de COMPRA daquele notional (o que se paga por unidade). */
  compraMedio: number;
  /** Preço médio de VENDA daquele notional (o que se recebe por unidade). */
  vendaMedio: number;
  /** O notional foi preenchido inteiro? Preenchimento parcial mente a favor. */
  completo: boolean;
}

/**
 * O preço executável de uma CEX, andando o livro pelo notional.
 *
 * ⚠️ NÃO É O TOPO DO LIVRO. O topo é o preço de UMA unidade; a mesa quer operar
 * $N e para isso ela ANDA o livro. Comparar topo de CEX com cotação de DEX (que
 * já tem impacto) enviesaria contra o DEX — e o contrário, a favor.
 */
export function precoCex(asks: Level[], bids: Level[], notionalUsd: number): PrecoExecutavel | null {
  const compra = vwapBuy(asks, notionalUsd);
  if (!(compra.avgPrice > 0) || !(compra.baseFilled > 0)) return null;
  const venda = vwapSell(bids, compra.baseFilled);
  if (!(venda.avgPrice > 0)) return null;
  return {
    compraMedio: compra.avgPrice,
    vendaMedio: venda.avgPrice,
    completo: compra.fullyFilled && venda.fullyFilled,
  };
}

/**
 * O preço executável de um DEX, a partir de DUAS cotações reais.
 *
 * `usdcParaToken`: quantos tokens saem de `notionalUsd` de USDC (define a
 * compra). `tokenParaUsdc`: quantos dólares saem daquele mesmo tanto de token
 * (define a venda). As duas cotações já trazem taxa da poça, impacto e gás.
 *
 * ⚠️ IDA E VOLTA DE VERDADE, não uma cotação espelhada. Poça com liquidez
 * assimétrica cobra diferente nos dois sentidos, e assumir simetria inventaria
 * metade da medição.
 */
export function precoDex(
  notionalUsd: number, tokensRecebidos: number, usdRecebidoDeVolta: number,
  gasEntradaUsd = 0, gasSaidaUsd = 0,
): PrecoExecutavel | null {
  if (!(notionalUsd > 0) || !(tokensRecebidos > 0) || !(usdRecebidoDeVolta > 0)) return null;
  return {
    /**
     * ⚠️ O GÁS ENTRA NO PREÇO, e ele é pago FORA do token.
     *
     * A cotação devolve quantos tokens saem de $N de USDC — e o gás sai do
     * bolso em moeda nativa, por fora. Quem entrou gastou $N + gás para receber
     * aqueles tokens; quem sai recebe o valor MENOS o gás da segunda perna.
     *
     * Deixar o gás de fora daria um preço executável que ninguém executa, que é
     * a família de erro que a Fase 4 já pegou: custo fixo esquecido vira borda
     * que não existe. Aqui ele é pequeno em L2 e não é zero.
     */
    compraMedio: (notionalUsd + gasEntradaUsd) / tokensRecebidos,
    vendaMedio: (usdRecebidoDeVolta - gasSaidaUsd) / tokensRecebidos,
    // Cotação de agregador não devolve preenchimento parcial: ou ela existe ou
    // não. `true` aqui é "a cotação fechou", não "a poça é infinita".
    completo: true,
  };
}

/**
 * ⚠️ O QUE FICA DE FORA DA LISTA DE PARES, e o repo tem cicatriz dos dois.
 *
 * WBTC — é BTC EMBRULHADO, não BTC. A diferença entre os dois é o basis de
 * custódia do embrulhador, que é um negócio próprio com risco próprio.
 * Chamá-lo de arbitragem mediria a taxa do custodiante e daria o nome errado.
 *
 * MATIC/POL — o repo JÁ TEM a cicatriz: o padrão "MATIC→POL" está documentado
 * em `arbiter.ts` como a fonte de spreads falsos que o filtro de mediana existe
 * para matar. Um ticker em migração cota o cadáver de um lado e o vivo do
 * outro. Não entra.
 */
export const PARES_EXCLUIDOS = ["WBTC", "MATIC", "POL"] as const;

export interface Sentido {
  /** "dex→cex" = compra no DEX, vende na CEX. */
  rota: "dex→cex" | "cex→dex";
  /** Borda bruta antes das taxas de CEX, em %. */
  brutaPct: number;
  /** Depois da taxa de tomador da CEX nas duas pontas que a envolvem. */
  liquidaPct: number;
}

/**
 * As duas direções, calculadas separadamente.
 *
 * ⚠️ NÃO É SIMÉTRICO, e supor que é seria inventar metade do resultado. Comprar
 * no DEX e vender na CEX usa o preço de COMPRA do DEX contra o de VENDA da CEX;
 * o inverso usa os outros dois. Poça e livro cobram diferente em cada sentido.
 *
 * ⚠️ A TAXA DE CEX ENTRA UMA VEZ — só há UMA perna de CEX em cada rota. Cobrar
 * duas seria a conta de quatro pernas do funding aplicada onde há duas.
 */
export function sentidos(dex: PrecoExecutavel, cex: PrecoExecutavel): Sentido[] {
  const dexParaCex = ((cex.vendaMedio - dex.compraMedio) / dex.compraMedio) * 100;
  const cexParaDex = ((dex.vendaMedio - cex.compraMedio) / cex.compraMedio) * 100;
  return [
    { rota: "dex→cex", brutaPct: dexParaCex, liquidaPct: dexParaCex - TAXA_CEX_PCT },
    { rota: "cex→dex", brutaPct: cexParaDex, liquidaPct: cexParaDex - TAXA_CEX_PCT },
  ];
}

export interface LinhaDexCex {
  symbol: string;
  cadeia: string;
  venueCex: string;
  notionalUsd: number;
  /** O melhor dos dois sentidos, pelo líquido. */
  melhorRota: Sentido["rota"];
  brutaPct: number;
  liquidaPct: number;
  /** O outro sentido, para a assimetria ficar visível. */
  outraRotaPct: number;
  precoDexCompra: number;
  precoDexVenda: number;
  precoCexCompra: number;
  precoCexVenda: number;
  /** O livro da CEX cobriu o notional inteiro? */
  livroCompleto: boolean;
}

export function melhorSentido(ss: Sentido[]): Sentido {
  return ss.reduce((a, b) => (b.liquidaPct > a.liquidaPct ? b : a));
}

export interface VereditoDexCex {
  readable: boolean;
  status: "verde" | "cinza" | "morta";
  verdict: string;
}

/**
 * ⚠️ PISO DE SÍMBOLOS. Um par com borda é um par, não um terreno. Mesma trava
 * do `MIN_ROBUSTOS` do funding e do `MIN_PRODUTOS` do rendimento.
 */
export const MIN_SIMBOLOS = 4;

export function vereditoDexCex(
  linhas: LinhaDexCex[], minSimbolos = MIN_SIMBOLOS,
): VereditoDexCex {
  const usaveis = linhas.filter((l) => l.livroCompleto);
  const parciais = linhas.length - usaveis.length;

  if (usaveis.length === 0) {
    return {
      readable: false, status: "cinza",
      verdict: linhas.length === 0
        ? "nenhum par com cotação de DEX E livro de CEX — inconclusivo, que não é reprovado."
        : `nenhum dos ${linhas.length} pares teve livro fundo o bastante para o notional — `
          + "preenchimento parcial mente a favor, então nenhum vira número. INCONCLUSIVO.",
    };
  }
  if (usaveis.length < minSimbolos) {
    return {
      readable: false, status: "cinza",
      verdict: `só ${usaveis.length} par(es) com livro completo, abaixo do piso de `
        + `${minSimbolos} — um par com borda é um par, não um terreno. INCONCLUSIVO.`,
    };
  }

  /**
   * ⚠️ A MEDIANA MANDA AQUI, como no censo de profundidade. Um par com poça
   * quebrada ou livro corrompido puxaria a média e descreveria um mercado que
   * ninguém opera. (Diferente da Fase 5, onde a cauda ERA o negócio — aqui ela
   * é ruído de dado.)
   */
  const mediana = median(usaveis.map((l) => l.liquidaPct)) ?? 0;
  const positivos = usaveis.filter((l) => l.liquidaPct > 0).length;
  const ressalva = parciais > 0
    ? ` ⚠️ ${parciais} par(es) fora por livro raso — não entraram em nenhuma conta.`
    : "";
  const tetoMev = " ⚠️ Isto é TETO, não captura: MEV compete no mesmo bloco e chega "
    + "antes por construção.";

  if (mediana <= 0) {
    return {
      readable: true, status: "morta",
      verdict: `${usaveis.length} pares · mediana da borda líquida ${mediana.toFixed(3)}% — `
        + `negativa DEPOIS de taxa, impacto e gás, com o mesmo notional dos dois lados. `
        + `${positivos} de ${usaveis.length} ficaram positivos. A janela de bloco existe e não `
        + `sobra dinheiro nela.${ressalva}`,
    };
  }
  return {
    readable: true, status: "verde",
    verdict: `${usaveis.length} pares · mediana da borda líquida +${mediana.toFixed(3)}% depois `
      + `de taxa, impacto e gás · ${positivos} de ${usaveis.length} positivos.${ressalva}${tetoMev}`,
  };
}
