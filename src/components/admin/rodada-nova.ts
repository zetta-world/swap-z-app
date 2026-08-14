/**
 * HÁ RODADA MAIS RECENTE QUE A DA TELA? — a decisão, pura e sem React.
 *
 * ⚠️ POR QUE ESTE AVISO EXISTE (14/08).
 *
 * Os painéis de medição são de BOTÃO. Não têm relógio de propósito: recarregar
 * sozinho dispararia medição de hora em hora, gastando API e gravando
 * `lab_runs` que ninguém pediu.
 *
 * O buraco que isso deixava: se o cron, outra aba ou outro dia produziu uma
 * rodada mais nova, a tela continua mostrando a antiga **sem dizer que é
 * antiga**. Número velho apresentado como número atual é a família de defeito
 * que este repositório persegue desde o começo — e aqui ela aparece na forma
 * mais inocente possível, um painel que simplesmente não sabe.
 *
 * A resposta certa não é recarregar. É AVISAR.
 */

/**
 * ⚠️ `vistoEmMs = 0` SIGNIFICA "A TELA AINDA NÃO MOSTROU NADA", e nesse caso
 * NÃO há aviso.
 *
 * Um painel recém-aberto, antes de o dono apertar o botão, não está
 * desatualizado — ele está vazio. Avisar ali diria "há algo mais recente que o
 * nada que você está vendo", que é verdade e é inútil: o botão já está na tela
 * dizendo a mesma coisa de um jeito melhor.
 */
export function temRodadaNova(
  ultimaPorSlug: Readonly<Record<string, string>>,
  slugs: readonly string[],
  vistoEmMs: number,
): { nova: boolean; quandoMs: number | null } {
  if (!(vistoEmMs > 0)) return { nova: false, quandoMs: null };

  let maisNova = 0;
  for (const s of slugs) {
    const iso = ultimaPorSlug[s];
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t > maisNova) maisNova = t;
  }
  if (!(maisNova > 0)) return { nova: false, quandoMs: null };

  /**
   * ⚠️ A FOLGA DE 5 SEGUNDOS NÃO É FRESCURA. `vistoEm` é marcado no relógio do
   * NAVEGADOR quando a resposta chega; `started_at` é o relógio do BANCO quando
   * a rodada começou. Os dois não são o mesmo relógio, e a rodada sempre começa
   * ANTES de a resposta chegar.
   *
   * Sem folga, a própria medição que o dono acabou de rodar se anunciaria como
   * "mais recente que a tela" — o aviso acusaria a si mesmo, toda vez, e em uma
   * semana ninguém mais olharia para ele.
   */
  const FOLGA_MS = 5_000;
  return maisNova > vistoEmMs + FOLGA_MS
    ? { nova: true, quandoMs: maisNova }
    : { nova: false, quandoMs: null };
}
