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
