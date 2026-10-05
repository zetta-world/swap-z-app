/**
 * LEITURA PAGINADA — para quando a resposta pode passar de `db-max-rows` (CE-12/CE-14).
 *
 * ⚠️ O PostgREST corta TODA resposta em `db-max-rows` (1000 no hospedado). Uma
 * soma, contagem ou agregado feito no app sobre uma leitura não paginada vira,
 * em silêncio, a soma das primeiras 1.000 linhas: foi o caso da receita do
 * admin, da cota do Pilot e das velas da bancada.
 *
 * ⚠️ A ORDEM TEM DE SER TOTAL (coluna única, como `id`): página por offset sobre
 * ordem com empate pode pular ou repetir linha entre páginas. Quem chama monta a
 * consulta com `.order(<coluna única>)`; aqui só se aplica o `range`.
 *
 * O offset avança pelo que VOLTOU (não pelo tamanho pedido) e a leitura só para
 * na página vazia: um servidor com `max-rows` menor que a página não encerra a
 * leitura cedo. `teto` é freio de sanidade e o corte é DECLARADO (`truncado`).
 */
export interface LeituraPaginada<T> {
  linhas: T[];
  erro: string | null;
  /** `true` quando o teto parou a leitura antes do fim — quem mostra o número tem de dizer isso. */
  truncado: boolean;
  paginas: number;
}

export async function lerTodasAsPaginas<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opcoes: { pagina?: number; teto?: number } = {},
): Promise<LeituraPaginada<T>> {
  const pagina = opcoes.pagina ?? 1000;
  const teto = opcoes.teto ?? 200_000;
  const linhas: T[] = [];
  let paginas = 0;
  while (linhas.length < teto) {
    paginas++;
    const de = linhas.length;
    const { data, error } = await montar(de, de + pagina - 1);
    if (error) return { linhas: [], erro: error.message.slice(0, 200), truncado: false, paginas };
    const vieram = data ?? [];
    if (vieram.length === 0) return { linhas, erro: null, truncado: false, paginas };
    linhas.push(...vieram);
  }
  return { linhas: linhas.slice(0, teto), erro: null, truncado: true, paginas };
}
