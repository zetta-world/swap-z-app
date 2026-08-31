/**
 * A leitura da profundidade — lógica pura, longe do componente.
 *
 * ⚠️ SEPARADA DO `.tsx` DE PROPÓSITO: o vitest deste repo roda em
 * `environment: "node"` e não parseia JSX, então nada que more num componente
 * pode ser testado por chamada — só por varredura de texto. Regra que vale além
 * deste arquivo: **conta que decide número não mora em componente.**
 */

/**
 * O melhor `buyAmount` da lista de cotações — ou `null` quando não deu para ler.
 *
 * ⚠️ `null` E NÃO ZERO. Zero aqui viraria "impacto de 100%", que a tela pintaria
 * como uma pool intransitável — uma afirmação forte construída sobre uma
 * resposta vazia. `null` mantém o `—`, que é a leitura honesta de "não medi".
 *
 * ⚠️ E PEGA O MAIOR, não o primeiro. A rota já ordena por `rankQuotes`, mas a
 * ordenação dela pondera prazo e taxa; para IMPACTO o que interessa é quanto se
 * recebe, e depender da ordem alheia é acoplar duas decisões que não são a
 * mesma.
 */
export function melhorBuyAmount(body: unknown): number | null {
  const lista = (body as { quotes?: Array<{ buyAmount?: string }> } | null)?.quotes;
  if (!Array.isArray(lista) || lista.length === 0) return null;
  let melhor: number | null = null;
  for (const q of lista) {
    const n = Number(q?.buyAmount);
    if (Number.isFinite(n) && n > 0 && (melhor === null || n > melhor)) melhor = n;
  }
  return melhor;
}

/**
 * ⚠️⚠️ A PERGUNTA INVERTIDA — e é a que o trader realmente tem.
 *
 * A matriz responde *"qual o impacto de $50k?"*. Ninguém chega na tela com essa
 * pergunta. A pergunta é **"até quanto eu consigo executar sem pagar caro?"**, e
 * ela nunca esteve na tela porque exige inverter a tabela.
 *
 * ⚠️ INTERPOLA NO LOG DO TAMANHO, não linearmente. As faixas são 1k, 10k, 50k,
 * 250k, 1M — uma progressão geométrica. Interpolar linearmente entre 50k e 250k
 * jogaria o ponto de corte para perto do 250k em quase todos os casos, e o
 * número sairia sistematicamente otimista.
 */
export interface TamanhoExecutavel {
  /** O maior tamanho, em USD, abaixo do teto de bps. `null` = indeterminado. */
  usd: number | null;
  /** O que a tela diz. Nunca afirma além do que foi medido. */
  texto: string;
}

export const TETO_BPS_PADRAO = 30;

export function tamanhoExecutavel(
  linhas: ReadonlyArray<{ size: number; buyBps: number | null; sellBps: number | null }>,
  tetoBps: number = TETO_BPS_PADRAO,
): TamanhoExecutavel {
  /**
   * O pior dos dois lados: quem executa paga o lado que estiver pior.
   *
   * ⚠️ `Math.max(2, NaN)` É NaN — a primeira versão fazia
   * `Math.max(buyBps ?? NaN, sellBps ?? NaN)` e DESCARTAVA a faixa inteira
   * quando só um lado tinha sido medido. Perder metade da informação por causa
   * da outra metade é o oposto do que este módulo deveria fazer, e foi o teste
   * de "faixa com um lado só" que pegou.
   */
  const pontos = linhas
    .map((l) => {
      const medidos = [l.buyBps, l.sellBps].filter((b): b is number => b !== null && Number.isFinite(b));
      return { size: l.size, bps: medidos.length > 0 ? Math.max(...medidos) : null };
    })
    .filter((p): p is { size: number; bps: number } => p.bps !== null && p.size > 0)
    .sort((a, b) => a.size - b.size);

  if (pontos.length === 0) {
    return { usd: null, texto: "profundidade não medida — sem ela não dá para dizer o tamanho" };
  }

  /**
   * ⚠️ ATRAVESSOU JÁ NA MENOR FAIXA: o teto é apertado para esta pool, e dizer
   * um número interpolado abaixo da menor medição seria extrapolar para fora do
   * que foi medido.
   */
  if (pontos[0].bps > tetoBps) {
    return {
      usd: null,
      texto: `mesmo $${(pontos[0].size / 1000).toFixed(0)}k já custa `
        + `${pontos[0].bps.toFixed(0)}bps — acima do teto de ${tetoBps}bps`,
    };
  }

  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1], b = pontos[i];
    if (b.bps <= tetoBps) continue;
    /**
     * ⚠️ A INTERPOLAÇÃO É EM log(tamanho) — ver a nota do cabeçalho. E o
     * resultado é ARREDONDADO PARA BAIXO ao milhar: um número com precisão de
     * dólar sugeriria uma exatidão que uma interpolação entre duas medições não
     * tem.
     */
    const t = (tetoBps - a.bps) / (b.bps - a.bps);
    const bruto = Math.exp(Math.log(a.size) + t * (Math.log(b.size) - Math.log(a.size)));
    const usd = Math.max(a.size, Math.floor(bruto / 1000) * 1000);
    return { usd, texto: `acima de ~$${(usd / 1000).toFixed(0)}k você paga mais de ${tetoBps}bps` };
  }

  /**
   * ⚠️ NUNCA ATRAVESSOU — e aqui NÃO se extrapola. A maior faixa medida é o que
   * se pode afirmar; dizer "aguenta $5M" a partir de uma medição que parou em
   * $1M seria inventar profundidade que ninguém viu.
   */
  const maior = pontos[pontos.length - 1];
  return {
    usd: maior.size,
    texto: `aguenta ao menos $${(maior.size / 1000).toFixed(0)}k dentro de ${tetoBps}bps `
      + "— acima disso não foi medido",
  };
}
