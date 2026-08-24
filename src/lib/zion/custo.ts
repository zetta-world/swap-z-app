/**
 * O CUSTO DE EXECUÇÃO — uma constante, dois significados, e meia taxa a menos.
 *
 * ⚠️⚠️ O DEFEITO (achado em 15/08, consertado em 16/08).
 *
 * `BACKTEST_COST_PCT ?? 0.2` era lido em quatorze lugares com DOIS significados
 * incompatíveis, e nada no nome dizia qual:
 *
 *     paper/engine.ts       const netPct = grossPct - COST_PCT;      ida e volta
 *     tournament/route.ts   gross - ROUND_TRIP_COST_PCT              ida e volta
 *     cull.ts               a.sum / a.resolved - COST_PCT            ida e volta
 *
 *     lab/tendencia.ts      a.pesoPct * (custoPct/100) * 2           POR PERNA
 *     zion/benchmarks.ts    equity *= 1 - (costPct/100) * pernas     POR PERNA
 *
 * O mesmo 0,2 significava "o ciclo inteiro custa 0,2%" num arquivo e "cada
 * perna custa 0,2%, então o ciclo custa 0,4%" no outro. Duas medições do mesmo
 * laboratório, com o mesmo número, cobrando o dobro uma da outra.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ E A CORRETORA DECIDIU QUEM ESTAVA CERTO.
 *
 * A consulta pública à Gate.io (`lib/cex/taxa-gateio.ts`, 10 pares, mediana)
 * devolveu **0,2% POR ORDEM**. Uma ida e volta são duas ordens: **0,4%**.
 *
 * Logo a família "ida e volta = 0,2%" cobrava **metade da taxa real** — em
 * `paper/engine.ts`, que move o caixa das carteiras; no torneio, que ordena as
 * mesas; no `cull.ts`, que DESLIGA mesa por expectância negativa. Toda mesa
 * parecia 0,2 ponto por trade melhor do que é.
 *
 * ⚠️ O CONSERTO NÃO É TROCAR O NÚMERO, É TIRAR A AMBIGUIDADE. Um `0.4` digitado
 * em catorze arquivos volta a divergir na primeira vez que alguém mexer num só.
 * Aqui existe UM primitivo — o custo por perna — e todo o resto é derivado dele
 * com nome que não deixa confundir: quem escreve `CUSTO_IDA_E_VOLTA_PCT` não
 * consegue achar que está cobrando uma perna.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O QUE ESTE MÓDULO **NÃO** COBRE, e é importante que doa.
 *
 * O primitivo é a taxa MEDIDA da corretora, e só ela. Não há derrapagem aqui,
 * porque derrapagem não foi medida em lugar nenhum — nem no lado CEX nem no
 * DEX. O `compararCusto` já dizia isso com todas as letras: com taxa de 0,2% e
 * orçamento de 0,2% por perna, **sobra ZERO** para impacto de preço.
 *
 * Então os resultados continuam OTIMISTAS, agora por uma margem menor e
 * conhecida, em vez de otimistas pelo dobro da taxa e por motivo nenhum. Somar
 * um "buffer de derrapagem" chutado aqui trocaria um erro medido por um palpite
 * — e este laboratório não inventa número nem para o lado conservador.
 *
 * ⚠️ AS ARBITRAGENS NÃO PASSAM POR AQUI, de propósito. `ARB_COST_PCT` (0,4 =
 * duas pernas taker) e `ARB2_COST_PCT` (0,45 = ciclo de quatro pernas) já
 * nascem com o ciclo embutido e já estavam certos. Trazê-los para cá seria
 * mexer no que funciona para arrumar o que não funcionava.
 */

/**
 * O PRIMITIVO: quanto custa UMA ordem, em %.
 *
 * ⚠️ 0,2 não é chute — é a mediana publicada da Gate.io em 10 pares, medida em
 * 15/08 e gravada em `platform_events` como `lab_custo_cex`. O env continua se
 * chamando `BACKTEST_COST_PCT` porque é o que está configurado em produção;
 * renomear a variável de ambiente e o código no mesmo dia trocaria um defeito
 * conhecido por um deploy quebrado.
 */
export const CUSTO_POR_PERNA_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);

/** Entrar e sair são duas ordens. Está aqui como número nomeado porque foi
 *  exatamente este `2` implícito que sumiu de metade do sistema. */
export const PERNAS_POR_CICLO = 2;

/**
 * O custo de um trade COMPLETO — entrar e sair.
 *
 * ⚠️ É ESTE que quase todo consumidor quer. Expectância por trade, líquido de
 * posição de papel, veredito de corte: todos falam de trades que abriram E
 * fecharam. Usar o custo de uma perna ali é a metade que faltava.
 */
export const CUSTO_IDA_E_VOLTA_PCT = CUSTO_POR_PERNA_PCT * PERNAS_POR_CICLO;

/**
 * Custo de uma estratégia com número arbitrário de pernas.
 *
 * ⚠️ Serve para quem NÃO é ida-e-volta simples: uma grade que gira, um
 * rebalanceamento que troca N posições. Escrever `pernas × custo` na mão em
 * cada arquivo é como a divergência começou.
 *
 * Pernas negativas ou não-finitas devolvem 0: cobrar custo negativo criaria
 * lucro do nada, e é melhor uma medição sem custo — visivelmente boa demais —
 * do que uma com custo invertido, que parece plausível.
 */
export function custoDePernas(pernas: number): number {
  if (!Number.isFinite(pernas) || pernas <= 0) return 0;
  return CUSTO_POR_PERNA_PCT * pernas;
}

/**
 * ⚠️ A FRONTEIRA NO LEDGER — 16/08, e quem ler média que cruze isto está
 * misturando duas réguas.
 *
 * `paper_positions.pnl_pct` é gravado LÍQUIDO no instante do fechamento. As
 * posições fechadas antes desta data carregam o custo antigo (0,2% pelo ciclo
 * inteiro); as de depois carregam 0,4%. Nada no banco distingue as duas — a
 * coluna tem o mesmo nome e o mesmo tipo.
 *
 * As medições que recalculam a partir do bruto (torneio, backtest, cull) não
 * têm esse problema: elas aplicam o custo na leitura, então a série inteira
 * muda junto e continua coerente. O problema é só do que foi CONGELADO.
 *
 * Está exportado para que quem construir uma média longa de `pnl_pct` possa
 * cortar aqui — e para que a data não viva só num comentário.
 */
export const FRONTEIRA_CUSTO_ISO = "2026-08-16T00:00:00.000Z";
