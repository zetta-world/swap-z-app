/**
 * O QUE O PLANO VAI CUSTAR EM TAXA — e o que ele JÁ custou.
 *
 * ⚠️⚠️ POR QUE ESTE MÓDULO EXISTE (26/08).
 *
 * A tela do DCA pede orçamento, valor por ciclo e número de ciclos, e mostra
 * de volta exatamente os números que o dono digitou. A taxa da corretora não
 * aparece em lugar nenhum — nem antes de criar o plano, nem depois de ele
 * rodar. Num plano de $10 × 90 ciclos, 0,2% por ordem são **$1,80**: 1,8% do
 * orçamento evaporando sem nunca ter sido escrito na tela.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ DCA É **UMA PERNA**, NÃO IDA E VOLTA — e este é o erro que eu quase fiz.
 *
 * `lib/zion/custo.ts` exporta `CUSTO_IDA_E_VOLTA_PCT` e é ele que quase todo
 * consumidor do laboratório quer, porque lá se fala de trades que abriram E
 * fecharam. Um plano de DCA **só compra**. Cobrar ida e volta aqui dobraria a
 * taxa projetada, e seria a MESMA ambiguidade que aquele arquivo foi escrito
 * para matar em 16/08 — um `0.2` que significa "o ciclo inteiro" num arquivo e
 * "cada perna" no outro.
 *
 * Por isso importamos o PRIMITIVO (`CUSTO_POR_PERNA_PCT`) e multiplicamos por
 * um número de pernas que está escrito com nome. Quem quiser projetar a venda
 * um dia soma a perna de saída aqui, à vista.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O QUE ESTE NÚMERO **NÃO** COBRE, e a tela tem de dizer junto.
 *
 *  1. **Derrapagem.** Não está aqui porque não foi medida para estes pares.
 *     `lib/cex/taxa-gateio.ts` já avisa que 0,2% mal cobre a taxa, sobrando
 *     ~zero para impacto de preço. A arbitragem morreu exatamente disso: 4.085
 *     sondagens de livro deram líquido teórico +0,451% e REAL −0,629%.
 *  2. **A nossa taxa efetiva.** 0,2% é a mediana PUBLICADA da Gate.io em 10
 *     pares (medida em 15/08). Nível VIP e desconto por pontos só aparecem em
 *     consulta autenticada. É estimativa, e a tela diz "estimado".
 *  3. **Taxa de saque/rede.** DCA compra e mantém na corretora; sacar é outra
 *     decisão, com outro custo.
 *
 * É por isso que existe `compararComRealizado()`. Projeção que ninguém confere
 * é promessa; ao lado do que a corretora cobrou de verdade, vira aferição.
 */

import { CUSTO_POR_PERNA_PCT } from "@/lib/zion/custo";

/**
 * DCA compra e para. Está aqui como número nomeado pela mesma razão que o
 * `PERNAS_POR_CICLO` do laboratório: foi um `2` implícito que sumiu de metade
 * do sistema e cobrou meia taxa por semanas.
 */
export const PERNAS_DO_DCA = 1;

/** A taxa que um ciclo de DCA paga, em %. */
export const TAXA_DO_CICLO_PCT = CUSTO_POR_PERNA_PCT * PERNAS_DO_DCA;

export type MotivoSemProjecao =
  | "orcamento_invalido"
  | "por_ciclo_invalido"
  | "ciclos_invalido"
  | "nao_cabe_nenhum_ciclo";

export interface Projecao {
  ok: true;
  /** A alíquota usada, em % por ordem. Vai para a tela — o número não pode
   *  viver só aqui dentro, senão mudá-lo em produção não avisa ninguém. */
  taxaPct: number;
  /** Quantos ciclos o orçamento realmente paga (pode ser menos que o pedido). */
  ciclosQueVaoRodar: number;
  /** ⚠️ `true` quando o último ciclo é PARCIAL — o resto do orçamento que
   *  ainda passa do mínimo da corretora. `tetoDoCiclo` compra esse resto. */
  ultimoCicloParcial: boolean;
  /** O que o plano vai desembolsar de fato, somando os ciclos que cabem. */
  gastoPrevistoUsd: number;
  /** Taxa de um ciclo cheio. O parcial paga menos, e por isso não é `total/n`. */
  taxaPorCicloUsd: number;
  taxaTotalUsd: number;
  /** ⚠️ O NÚMERO QUE MUDA A DECISÃO. "$1,80" não diz nada sozinho; "1,8% do
   *  seu orçamento" diz. */
  pctDoOrcamento: number;
}

export type ResultadoProjecao = Projecao | { ok: false; motivo: MotivoSemProjecao };

/**
 * Projeta a taxa do plano inteiro.
 *
 * ⚠️ A CONTA DOS CICLOS ESPELHA `tetoDoCiclo`, DE PROPÓSITO. Multiplicar
 * `porCiclo × ciclosTotal` seria mais simples e estaria ERRADO sempre que o
 * orçamento não fosse múltiplo exato do valor por ciclo: o plano para quando o
 * orçamento acaba (`orcamento_esgotado`), não quando a contagem acaba. Projetar
 * taxa sobre ciclos que nunca vão rodar infla o custo e desencoraja um plano
 * que na verdade é mais barato.
 *
 * ⚠️ E O ÚLTIMO CICLO PARCIAL COMPRA. `tetoDoCiclo` faz
 * `min(porCiclo, restanteOrcamento, ...)` e só recusa se o resultado ficar
 * abaixo do mínimo da corretora. Ignorar essa sobra subestimaria o gasto.
 *
 * ⚠️ OS TETOS DIÁRIO E DE PLATAFORMA NÃO ENTRAM AQUI. Eles mudam QUANDO o
 * plano gasta, não QUANTO no total — um ciclo adiado por teto diário volta na
 * janela seguinte. A taxa acompanha o total, então a projeção sobrevive a eles.
 */
export function projetarTaxa(p: {
  orcamentoTotalUsd: number;
  porCicloUsd: number;
  ciclosTotal: number;
  /** Mínimo da corretora. Abaixo dele a sobra não vira ordem. */
  minimoUsd?: number;
  /** Só para teste e para o dia em que a alíquota vier medida da conta. */
  taxaPct?: number;
}): ResultadoProjecao {
  const finitoPositivo = (n: number) => Number.isFinite(n) && n > 0;

  if (!finitoPositivo(p.orcamentoTotalUsd)) return { ok: false, motivo: "orcamento_invalido" };
  if (!finitoPositivo(p.porCicloUsd))       return { ok: false, motivo: "por_ciclo_invalido" };
  if (!finitoPositivo(p.ciclosTotal) || !Number.isInteger(p.ciclosTotal)) {
    return { ok: false, motivo: "ciclos_invalido" };
  }

  const taxaPct  = finitoPositivo(p.taxaPct ?? NaN) ? (p.taxaPct as number) : TAXA_DO_CICLO_PCT;
  const minimo   = Number.isFinite(p.minimoUsd) && (p.minimoUsd as number) > 0 ? (p.minimoUsd as number) : 0;

  const cabemCheios   = Math.floor(p.orcamentoTotalUsd / p.porCicloUsd);
  const ciclosCheios  = Math.min(p.ciclosTotal, cabemCheios);
  const sobra         = p.orcamentoTotalUsd - ciclosCheios * p.porCicloUsd;
  // Só existe ciclo parcial se ainda houver contagem sobrando E a sobra passar
  // do mínimo. Um plano de 3 ciclos com orçamento para 10 não compra o resto.
  const ultimoCicloParcial = ciclosCheios < p.ciclosTotal && sobra >= minimo && sobra > 0;

  const ciclosQueVaoRodar = ciclosCheios + (ultimoCicloParcial ? 1 : 0);
  if (ciclosQueVaoRodar <= 0) return { ok: false, motivo: "nao_cabe_nenhum_ciclo" };

  const gastoPrevistoUsd = ciclosCheios * p.porCicloUsd + (ultimoCicloParcial ? sobra : 0);
  const taxaTotalUsd     = gastoPrevistoUsd * (taxaPct / 100);

  return {
    ok: true,
    taxaPct,
    ciclosQueVaoRodar,
    ultimoCicloParcial,
    gastoPrevistoUsd,
    taxaPorCicloUsd: p.porCicloUsd * (taxaPct / 100),
    taxaTotalUsd,
    pctDoOrcamento: (taxaTotalUsd / p.orcamentoTotalUsd) * 100,
  };
}

export interface Aferição {
  /** Ciclos com taxa REGISTRADA. Ciclos antigos não têm a coluna preenchida. */
  ciclosMedidos: number;
  /** Ciclos executados que NÃO têm taxa registrada. ⚠️ Sem este número, uma
   *  medição feita sobre 2 de 40 ciclos pareceria a medição do plano inteiro. */
  ciclosSemRegistro: number;
  taxaRealUsd: number;
  gastoRealUsd: number;
  /** A alíquota que a corretora cobrou de fato, em %. `null` quando não há
   *  gasto medido — dividir por zero devolveria `Infinity` na tela. */
  taxaRealPct: number | null;
  /** Positivo = a corretora cobrou MAIS que o projetado. `null` sem medição. */
  desvioPontos: number | null;
}

/**
 * Confronta a projeção com o que a corretora cobrou.
 *
 * ⚠️ COMPARA ALÍQUOTA COM ALÍQUOTA, NUNCA TOTAL COM TOTAL. Um plano no ciclo 3
 * de 90 pagou uma fração do total projetado, e "projetado $1,80 / real $0,06"
 * pareceria uma economia enorme quando não é nada — é só um plano no começo.
 * A pergunta honesta é "a alíquota que eu assumi é a que estão cobrando?", e
 * essa não depende de quantos ciclos já rodaram.
 *
 * ⚠️ E CICLO SEM TAXA REGISTRADA NÃO ENTRA COMO ZERO. Ele sai contado à parte.
 * Somar zero por ausência é a mesma família do `expired ≠ win/loss` do
 * flywheel: faria a alíquota real despencar por falta de dado, e a tela leria
 * isso como "a corretora está cobrando barato".
 */
export function compararComRealizado(
  ciclos: ReadonlyArray<{ custoUsd: number | null; taxaUsd: number | null }>,
  projecao: Projecao,
): Aferição {
  let ciclosMedidos = 0, ciclosSemRegistro = 0, taxaRealUsd = 0, gastoRealUsd = 0;

  for (const c of ciclos) {
    const gasto = Number(c.custoUsd);
    if (!Number.isFinite(gasto) || gasto <= 0) continue; // ciclo que não comprou
    /**
     * ⚠️ `null` TEM DE SAIR ANTES DO `Number()`, e este foi um defeito real
     * desta função — pego pelo teste que existe para ele.
     *
     * `Number(null)` é **0**, que é finito e não-negativo. A guarda seguinte
     * deixava passar, e o ciclo sem registro virava "ciclo medido, taxa zero" —
     * precisamente o que o comentário logo acima promete que não acontece.
     */
    if (c.taxaUsd === null || c.taxaUsd === undefined) { ciclosSemRegistro += 1; continue; }
    const taxa = Number(c.taxaUsd);
    if (!Number.isFinite(taxa) || taxa < 0) { ciclosSemRegistro += 1; continue; }
    ciclosMedidos += 1;
    taxaRealUsd   += taxa;
    gastoRealUsd  += gasto;
  }

  const taxaRealPct = gastoRealUsd > 0 ? (taxaRealUsd / gastoRealUsd) * 100 : null;
  return {
    ciclosMedidos, ciclosSemRegistro, taxaRealUsd, gastoRealUsd, taxaRealPct,
    desvioPontos: taxaRealPct === null ? null : taxaRealPct - projecao.taxaPct,
  };
}

export interface PrecoMedio {
  /** Ciclos que realmente compraram — com quantidade E gasto. */
  ciclosContados: number;
  quantidadeTotal: number;
  gastoTotalUsd: number;
  /** O preço médio de entrada. `null` sem quantidade — e `null` é o que a tela
   *  mostra como "—", nunca como zero. Preço zero é uma afirmação. */
  precoMedioUsd: number | null;
}

/**
 * O preço médio de entrada do plano.
 *
 * ⚠️ É `gasto / quantidade`, NÃO a média dos preços dos ciclos. A média
 * aritmética dos preços só coincide quando todo ciclo comprou o mesmo valor —
 * e o último ciclo é justamente o parcial. Média simples daria um break-even
 * que não existe, e é sobre ele que o dono decide se está no lucro.
 *
 * ⚠️ A TAXA NÃO ENTRA AQUI, e é decisão, não esquecimento. O preço médio
 * responde "por quanto eu comprei"; o custo total com taxa responde outra
 * pergunta e tem função própria. Enfiar a taxa no preço médio faria o
 * break-even da tela divergir do preço que a corretora mostra no extrato.
 */
export function precoMedio(
  ciclos: ReadonlyArray<{ quantidade: number | null; custoUsd: number | null }>,
): PrecoMedio {
  let ciclosContados = 0, quantidadeTotal = 0, gastoTotalUsd = 0;

  for (const c of ciclos) {
    const q = Number(c.quantidade), g = Number(c.custoUsd);
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!Number.isFinite(g) || g <= 0) continue;
    ciclosContados  += 1;
    quantidadeTotal += q;
    gastoTotalUsd   += g;
  }

  return {
    ciclosContados, quantidadeTotal, gastoTotalUsd,
    precoMedioUsd: quantidadeTotal > 0 ? gastoTotalUsd / quantidadeTotal : null,
  };
}
