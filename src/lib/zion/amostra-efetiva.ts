/**
 * AMOSTRA EFETIVA — quantas IDEIAS distintas existem dentro de N trades.
 *
 * ⚠️ O CASO QUE ORIGINOU ISTO (15/08).
 *
 * O torneio marcou `+1,53% por trade` na janela de 24h, com 4 decididos, 75% de
 * acerto e profit factor 5,07. Os quatro trades eram:
 *
 *   HEIMDALL  DOT  sell_safe        TRENDING_DOWN   −1,72   02:30
 *   VÖLUNDR   OP   range_reversion  RANGING         +3,08   04:30
 *   VÖLUNDR   OP   range_reversion  RANGING         +2,82   06:00
 *   SKAÐI     OP   range_reversion  RANGING         +2,82   06:00
 *
 * **Três dos quatro são o mesmo símbolo, o mesmo playbook e o mesmo regime**, e
 * os dois últimos foram criados no MESMO segundo e resolveram no MESMO minuto,
 * com resultado idêntico. Não são três observações do mundo: são **um
 * movimento do OP, capturado três vezes**.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ E O QUE A CORRELAÇÃO ESTRAGA NÃO É A MÉDIA — É A CONFIANÇA.
 *
 * Isto importa e é fácil de errar. Somar três trades correlacionados e dividir
 * por três continua dando uma média legítima daquilo que aconteceu. O que
 * **não** é legítimo é dizer "tenho três observações": elas não se confirmam,
 * elas se repetem.
 *
 * Por isso a amostra efetiva entra no PISO DE AMOSTRA e no aviso, e **não** no
 * cálculo da expectância. Mexer na média seria consertar a coisa errada e
 * introduzir um viés novo; o defeito está em quantas vezes o mundo falou, não
 * no que ele disse.
 *
 * ⚠️ E O LABORATÓRIO JÁ SABIA DISSO. A `carteira_verde` teve 94 dias virarem
 * amostra EFETIVA 4 por correlação, em 08/08. O torneio nunca aplicou a mesma
 * correção — é a invariante nº 31 na terceira aparição: a lição existe num
 * painel e não viaja sozinha para o outro.
 */

/** O mínimo que se precisa saber de um trade para agrupá-lo. */
export interface TradeCorrelacionavel {
  symbol: string | null | undefined;
  /** O playbook. Em `zion_suggestions` ele viaja na coluna `kind`. */
  kind: string | null | undefined;
  /** Instante da resolução, em ms. */
  resolvidoEmMs: number;
}

/**
 * ⚠️ A JANELA, E POR QUE ELA EXISTE.
 *
 * Dois trades de OP `range_reversion` resolvidos com três DIAS de diferença são
 * observações independentes — o mercado teve tempo de mudar de ideia entre um e
 * outro. Resolvidos na mesma manhã, são o mesmo movimento.
 *
 * 24h é convenção, não medição, e por isso está exposta: quem quiser medir com
 * outra janela muda e VÊ que mudou. Ela é generosa de propósito — errar para o
 * lado de "isto é uma ideia só" atrasa uma medalha; errar para o outro lado
 * entrega a medalha a uma coincidência.
 */
export const JANELA_CLUSTER_MS = 24 * 3_600_000;

/**
 * Quantas ideias distintas há em `trades`.
 *
 * Dois trades pertencem à mesma ideia quando compartilham símbolo E playbook E
 * resolveram a menos de `janelaMs` um do outro. O encadeamento é por VIZINHO
 * ordenado no tempo, não por distância ao primeiro: uma sequência que anda de
 * 12 em 12 horas é uma ideia que se arrastou, não várias.
 *
 * ⚠️ SEM SÍMBOLO OU SEM PLAYBOOK, O TRADE É UMA IDEIA PRÓPRIA. Agrupar o que
 * não se consegue identificar seria AFIRMAR correlação sem prova — e este
 * laboratório não inventa nem para o lado conservador. Na prática
 * `zion_suggestions` sempre tem os dois; se um dia faltar, o número sobe e a
 * causa é dado ruim, não mercado.
 */
export function nEfetivo(
  trades: readonly TradeCorrelacionavel[],
  janelaMs: number = JANELA_CLUSTER_MS,
): number {
  if (trades.length === 0) return 0;

  const porChave = new Map<string, number[]>();
  let soltos = 0;

  for (const t of trades) {
    const sym = (t.symbol ?? "").trim();
    const kind = (t.kind ?? "").trim();
    if (!sym || !kind || !Number.isFinite(t.resolvidoEmMs)) { soltos++; continue; }
    const chave = `${sym.toUpperCase()}|${kind}`;
    const arr = porChave.get(chave) ?? [];
    arr.push(t.resolvidoEmMs);
    porChave.set(chave, arr);
  }

  let ideias = soltos;
  for (const tempos of porChave.values()) {
    tempos.sort((a, b) => a - b);
    ideias++;                                     // a primeira sempre abre uma
    for (let i = 1; i < tempos.length; i++) {
      if (tempos[i] - tempos[i - 1] > janelaMs) ideias++;
    }
  }
  return ideias;
}

/**
 * A frase que a tela usa quando o bruto e o efetivo divergem.
 *
 * ⚠️ Devolve string vazia quando são iguais — nesse caso repetir o número seria
 * ruído, e um aviso que aparece sempre é um aviso que ninguém lê.
 */
export function porQueEfetivoMenor(bruto: number, efetivo: number): string {
  if (efetivo >= bruto) return "";
  return `${bruto} trades decididos, mas ${efetivo} ideia(s) distinta(s) — `
    + "trades do mesmo símbolo, mesmo playbook e mesma janela contam como UM. "
    + "A média continua valendo; o que não vale é tratá-los como confirmações "
    + "independentes.";
}

/**
 * ⚠️⚠️ A CORRELAÇÃO ENTRE MESAS — o buraco no meu próprio conserto (16/08).
 *
 * O `nEfetivo` acima foi escrito em 15/08 e é aplicado POR MESA. No dia
 * seguinte, medindo a coorte, apareceu o caso que ele não pega:
 *
 *     UNI · sell_safe · 14/08
 *       kimi_scan     +5,83   resolvido 11:30
 *       mistral_scan  +7,04   resolvido 12:00
 *       radar         +4,93   resolvido 12:00
 *
 * Três mesas diferentes, um movimento do UNI. Como cada uma tem UM trade, cada
 * uma marca "1 ideia" — e o painel apresenta **três confirmações
 * independentes** de que `sell_safe` funciona. São uma.
 *
 * Na janela de 7 dias inteira: **46 decididos, 23 ideias distintas.** Metade.
 *
 * ⚠️ O ALGORITMO ESTAVA CERTO; ERRADO ERA O QUE EU DAVA A ELE. Por isso aqui
 * não há função nova — há a MESMA `nEfetivo` recebendo a coorte inteira. Um
 * segundo algoritmo para o mesmo conceito seria uma segunda definição de
 * "ideia", e duas definições divergem, é só questão de tempo.
 *
 * ⚠️ E O DONO DISCORDOU DE UM PONTO, COM RAZÃO: as três não são cópias. Entrada,
 * alvo, stop e confiança eram diferentes nas três — cada mesa montou a própria
 * geometria, e a concordância na ENTRADA é sinal bom, não ruim. O que não muda
 * é a contagem de evidência: se o UNI tivesse subido 1,9%, as três perdiam
 * juntas. Independência de raciocínio e independência de RESULTADO são coisas
 * diferentes, e é a segunda que decide quantas vezes o mundo falou.
 */
export function porQueCoorteMenor(bruto: number, efetivo: number): string {
  if (efetivo >= bruto) return "";
  return `${bruto} trades decididos na coorte, mas ${efetivo} ideia(s) distinta(s) — `
    + "mesas diferentes pegando o MESMO movimento contam como uma. A média por "
    + "trade continua valendo; o que não vale é ler concordância entre mesas "
    + "como confirmação independente.";
}
