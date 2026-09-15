/**
 * Fetch EVERY row of a query by paginating in fixed-size chunks.
 *
 * PostgREST (Supabase) silently caps any select at max-rows (default 1000) —
 * no error, just a truncated result. The flywheel's honesty depends on
 * aggregating the WHOLE ledger: the day zion_suggestions crossed 1000 rows,
 * expectancy/win-rate/tournament would silently freeze on an arbitrary
 * 1000-row subset (money-path audit A1).
 *
 * The caller passes a page FACTORY (PostgREST builders are single-use, so a
 * fresh builder per page) that MUST apply a stable `.order()` — paginating an
 * unordered select can skip or duplicate rows between pages.
 *
 * ⚠️⚠️ E ELE TRUNCAVA EM SILÊNCIO NO PRÓPRIO CAMINHO DE ERRO — achado A30 da
 * auditoria externa. O defeito que este módulo existe para impedir, entrando
 * pela porta que ele mesmo construiu.
 *
 * A versão anterior desestruturava só `{ data }` e fazia:
 *
 *     if (!data || data.length === 0) break;
 *
 * Um erro na página 3 de 7 devolve `data: null` — e isso era indistinguível do
 * fim dos dados. A função retornava as duas primeiras páginas COMO SE FOSSEM A
 * TABELA INTEIRA, sem erro e sem sinal, e quem chamou agregou um livro parcial
 * acreditando que estava completo.
 *
 * ⚠️ E O TRUNCAMENTO NÃO É NEUTRO. As consultas ordenam por `created_at`
 * ascendente, então o que sobra são as linhas MAIS ANTIGAS: todo agregado
 * regride em silêncio ao comportamento inicial das mesas, que é justamente o
 * pior. São 32 pontos de uso, entre eles o portão de lançamento, o `cull` que
 * MATA mesas com veredito permanente, a expectancy, o torneio e a vitrine.
 *
 * ⚠️ POR QUE LANÇAR, e não devolver o que veio. `CLAUDE.md` manda o caminho de
 * dinheiro falhar FECHADO e o flywheel ser HONESTO. Número parcial apresentado
 * como completo é a desonestidade exata que a casa proíbe — e quem já tem
 * `try/catch` segue no caminho best-effort dele, agora sabendo que não sabe.
 */
export async function selectAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    /** ⚠️ Opcional no tipo só para o `cru()` do DCA; o PostgREST sempre manda. */
    error?: { message?: string } | null;
  }>,
  chunkSize = 1000,
  maxRows = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += chunkSize) {
    const { data, error } = await page(from, Math.min(from + chunkSize, maxRows) - 1);
    if (error) {
      throw new Error(
        `selectAllRows: a pagina ${from}-${from + chunkSize - 1} falhou apos ${out.length} linha(s). `
        + `Devolver o parcial diria "isto e a tabela inteira" sobre um pedaco. `
        + `Causa: ${error.message ?? "sem mensagem"}`,
      );
    }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < chunkSize) break;
  }
  return out;
}
