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

/**
 * ⚠️⚠️ LEITURA PAGINADA POR CHAVE — a que soma dinheiro usa esta (RM-12, audit remediation).
 *
 * `lerTodasAsPaginas` pagina por OFFSET. Com a tabela mudando durante a leitura,
 * uma linha inserida ou apagada ANTES do offset desloca as páginas seguintes:
 * uma linha é lida duas vezes ou nenhuma. Com `ORDER BY id` sobre UUID (aleatório)
 * isso acontece com qualquer inserção, não só com as do fim.
 *
 * Por chave (`chave > última vista`, ordenado pela chave ÚNICA) cada linha que
 * existia no início e continua existindo no fim é lida EXATAMENTE uma vez —
 * inserção concorrente não desloca nada. Uma linha inserida durante a leitura
 * pode entrar ou não (depende de onde a chave dela cai), e uma apagada pode já
 * ter sido lida.
 *
 * ⚠️ AINDA NÃO É LEDGER-GRADE: não é um retrato num instante só. Número de
 * tesouraria/contabilidade/receita oficial/conciliação tem de vir de UMA
 * instrução SQL agregada (ou de uma transação com snapshot), não de leituras
 * paginadas — isto é para painel. Ver o relatório do round (§13, §22).
 */
export async function lerTodasPorChave<T extends Record<string, unknown>>(
  montar: (depoisDe: string | null, limite: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  chave: keyof T & string,
  opcoes: { pagina?: number; teto?: number } = {},
): Promise<LeituraPaginada<T>> {
  const pagina = opcoes.pagina ?? 1000;
  const teto = opcoes.teto ?? 200_000;
  const linhas: T[] = [];
  let paginas = 0;
  let depoisDe: string | null = null;
  while (linhas.length < teto) {
    paginas++;
    let r: { data: T[] | null; error: { message: string } | null };
    try {
      r = await montar(depoisDe, pagina);
    } catch (e) {
      return { linhas: [], erro: (e instanceof Error ? e.message : "exceção sem mensagem").slice(0, 200), truncado: false, paginas };
    }
    if (r.error) return { linhas: [], erro: r.error.message.slice(0, 200), truncado: false, paginas };
    const vieram = r.data ?? [];
    if (vieram.length === 0) return { linhas, erro: null, truncado: false, paginas };
    const ultima = vieram[vieram.length - 1][chave];
    if (ultima == null) return { linhas: [], erro: `chave '${chave}' ausente na página — leitura por chave impossível`, truncado: false, paginas };
    // ⚠️ A chave TEM de andar: um servidor que ignorasse o filtro repetiria a mesma página para sempre.
    // Comparação por IGUALDADE, não `<=`: a ordem do texto no Postgres segue a collation, que pode
    // discordar da ordem de string do JS (endereços base58 com maiúsculas e minúsculas).
    if (depoisDe != null && (String(ultima) === depoisDe || String(vieram[0][chave]) === depoisDe)) {
      return { linhas: [], erro: `a chave '${chave}' não avançou (${String(ultima)}) — ordem ou filtro ignorados`, truncado: false, paginas };
    }
    linhas.push(...vieram);
    depoisDe = String(ultima);
  }
  return { linhas: linhas.slice(0, teto), erro: null, truncado: true, paginas };
}
