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
